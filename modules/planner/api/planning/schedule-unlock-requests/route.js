import mongoose from "mongoose";
import { NextResponse } from "next/server";

import { createAuditLog } from "@/lib/audit";
import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  assertWorkGroupInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import {
  getUnlockRequestWeekMonthKeys,
  serializeScheduleUnlockRequest,
} from "@/modules/planner/lib/planning/scheduleUnlockRequests";
import {
  PlanningWorkGroup,
  ScheduleAssignment,
  ScheduleUnlockRequest,
} from "@/modules/planner/models";

function actorFromUser(user) {
  return {
    actor: String(user?.employeeName || user?.username || user?.id || "SISTEMA").trim(),
    actorUser: String(user?.id || user?.username || "").trim(),
  };
}

export async function GET(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (
    !hasAccessPermission(user, "planner.schedules.weekly.view")
    && !hasAccessPermission(user, "planner.updates.view")
  ) {
    return NextResponse.json(
      { error: "No tienes permiso para ver solicitudes de desbloqueo." },
      { status: 403 },
    );
  }

  try {
    await connectToDatabase();

    const { searchParams } = new URL(request.url);
    const plannerScope = await resolvePlannerEmployeeScope();
    const query = {};
    const status = String(searchParams.get("status") || "").trim();
    const monthKey = String(searchParams.get("month") || "").trim();
    const groupId = String(searchParams.get("groupId") || "").trim();
    const weekStartKey = String(searchParams.get("weekStartKey") || "").trim();

    if (["pending", "approved", "rejected"].includes(status)) query.status = status;
    if (/^\d{4}-\d{2}$/.test(monthKey)) query.monthKey = monthKey;
    if (/^\d{4}-\d{2}-\d{2}$/.test(weekStartKey)) query.weekStartKey = weekStartKey;

    if (groupId) {
      assertWorkGroupInPlannerScope(groupId, plannerScope);
      query.group = new mongoose.Types.ObjectId(groupId);
    } else if (!plannerScope.isCompanyWide) {
      query.group = { $in: plannerScope.workGroupIds || [] };
    }

    const requests = await ScheduleUnlockRequest.find(query)
      .sort({ requestedAt: -1 })
      .lean();

    return NextResponse.json({
      requests: requests.map(serializeScheduleUnlockRequest),
      capabilities: {
        canRequest: hasAccessPermission(user, "planner.schedules.manage"),
        canReview: hasAccessPermission(user, "planner.updates.manage"),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron cargar las solicitudes de desbloqueo." },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.schedules.manage")) {
    return NextResponse.json(
      { error: "No tienes permiso para solicitar el desbloqueo de planificaciones." },
      { status: 403 },
    );
  }

  try {
    await connectToDatabase();

    const body = await request.json();
    const groupId = String(body?.groupId || "").trim();
    const monthKey = String(body?.monthKey || "").trim();
    const weekStartKey = String(body?.weekStartKey || "").trim();
    const reason = String(body?.reason || "").trim();

    if (!mongoose.isValidObjectId(groupId)) {
      throw new Error("Debes seleccionar un grupo de trabajo valido.");
    }

    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      throw new Error("Debes indicar el mes de la planificación.");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartKey)) {
      throw new Error("Debes indicar la semana que deseas desbloquear.");
    }

    if (reason.length < 10) {
      throw new Error("Describe el motivo del desbloqueo con al menos 10 caracteres.");
    }

    if (reason.length > 500) {
      throw new Error("El motivo del desbloqueo no puede superar los 500 caracteres.");
    }

    const plannerScope = await resolvePlannerEmployeeScope();

    assertWorkGroupInPlannerScope(groupId, plannerScope);

    const groupObjectId = new mongoose.Types.ObjectId(groupId);
    const targetMonthKeys = getUnlockRequestWeekMonthKeys(weekStartKey);
    const [workGroup, hasActiveApproval, pendingRequest] = await Promise.all([
      PlanningWorkGroup.findById(groupId).lean(),
      ScheduleAssignment.exists({
        monthKey: { $in: targetMonthKeys },
        planningApprovals: {
          $elemMatch: {
            weekStartKey,
            groupId: groupObjectId,
            unlockedAt: null,
          },
        },
      }),
      ScheduleUnlockRequest.findOne({
        group: groupObjectId,
        weekStartKey,
        status: "pending",
      }).lean(),
    ]);

    if (!workGroup) {
      return NextResponse.json({ error: "Grupo de trabajo no encontrado." }, { status: 404 });
    }

    if (!hasActiveApproval) {
      return NextResponse.json(
        { error: "Esta planificación ya está desbloqueada o no tiene una aprobación vigente." },
        { status: 409 },
      );
    }

    if (pendingRequest) {
      return NextResponse.json(
        {
          error: "Ya existe una solicitud pendiente para esta semana.",
          request: serializeScheduleUnlockRequest(pendingRequest),
        },
        { status: 409 },
      );
    }

    const { actor, actorUser } = actorFromUser(user);
    const unlockRequest = await ScheduleUnlockRequest.create({
      group: groupObjectId,
      groupName: String(workGroup.name || "").trim().toUpperCase(),
      branchCode: String(workGroup.branchCode || "").trim().toUpperCase(),
      branchName: String(workGroup.branchName || "").trim().toUpperCase(),
      monthKey,
      weekStartKey,
      reason,
      status: "pending",
      requestedBy: actor,
      requestedByUser: actorUser,
    });
    const serializedRequest = serializeScheduleUnlockRequest(unlockRequest);

    await createAuditLog({
      actor,
      action: "planningSchedule.unlockRequest.create",
      entityType: "scheduleUnlockRequest",
      entityId: unlockRequest._id.toString(),
      entityLabel: `${unlockRequest.groupName} ${weekStartKey}`,
      route: "/api/planner/planning/schedule-unlock-requests",
      details: {
        groupId,
        groupName: unlockRequest.groupName,
        monthKey,
        weekStartKey,
        reason,
        after: serializedRequest,
      },
    });

    return NextResponse.json(
      {
        message: "Solicitud de desbloqueo enviada para revisión.",
        request: serializedRequest,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error?.code === 11000) {
      return NextResponse.json(
        { error: "Ya existe una solicitud pendiente para esta semana." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: error.message || "No se pudo registrar la solicitud de desbloqueo." },
      { status: 400 },
    );
  }
}
