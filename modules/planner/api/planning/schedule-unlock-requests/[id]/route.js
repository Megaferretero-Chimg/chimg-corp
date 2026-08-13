import mongoose from "mongoose";
import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import AuditLog from "@/models/AuditLog";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  assertWorkGroupInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import {
  buildPlanningApprovalVersionKey,
  findActivePlanningApproval,
  getUnlockRequestWeekMonthKeys,
  serializeScheduleUnlockRequest,
  unlockRequestMatchesPlanningApproval,
} from "@/modules/planner/lib/planning/scheduleUnlockRequests";
import {
  ScheduleAssignment,
  ScheduleUnlockRequest,
} from "@/modules/planner/models";

export async function PATCH(request, context) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.updates.manage")) {
    return NextResponse.json(
      { error: "No tienes permiso para resolver solicitudes de desbloqueo." },
      { status: 403 },
    );
  }

  const params = await context.params;
  const requestId = String(params?.id || "").trim();

  if (!mongoose.isValidObjectId(requestId)) {
    return NextResponse.json({ error: "Solicitud de desbloqueo no valida." }, { status: 400 });
  }

  try {
    await connectToDatabase();

    const body = await request.json();
    const action = String(body?.action || "").trim().toLowerCase();
    const reviewNotes = String(body?.reviewNotes || "").trim();

    if (!["approve", "reject"].includes(action)) {
      throw new Error("Debes aprobar o rechazar la solicitud.");
    }

    if (reviewNotes.length > 500) {
      throw new Error("La nota de revisión no puede superar los 500 caracteres.");
    }

    const plannerScope = await resolvePlannerEmployeeScope();
    const reviewer = String(user?.employeeName || user?.username || user?.id || "SISTEMA").trim();
    const reviewerUser = String(user?.id || user?.username || "").trim();
    const reviewedAt = new Date();
    const session = await mongoose.startSession();
    let serializedRequest = null;
    let responseMessage = "";

    try {
      await session.withTransaction(async () => {
        const unlockRequest = await ScheduleUnlockRequest.findById(requestId).session(session);

        if (!unlockRequest) {
          const error = new Error("Solicitud de desbloqueo no encontrada.");

          error.statusCode = 404;
          throw error;
        }

        if (unlockRequest.status !== "pending") {
          const error = new Error("Esta solicitud ya fue resuelta.");

          error.statusCode = 409;
          throw error;
        }

        const groupId = unlockRequest.group?.toString?.() || "";

        assertWorkGroupInPlannerScope(groupId, plannerScope);

        const before = serializeScheduleUnlockRequest(unlockRequest.toObject());
        const auditDocuments = [];

        if (action === "approve") {
          const groupObjectId = new mongoose.Types.ObjectId(groupId);
          const targetMonthKeys = getUnlockRequestWeekMonthKeys(unlockRequest.weekStartKey);
          const assignments = await ScheduleAssignment.find({
            monthKey: { $in: targetMonthKeys },
            planningApprovals: {
              $elemMatch: {
                weekStartKey: unlockRequest.weekStartKey,
                groupId: groupObjectId,
                unlockedAt: null,
              },
            },
          }).session(session).lean();

          if (!assignments.length) {
            const error = new Error("La planificación ya está desbloqueada o no tiene una aprobación vigente.");

            error.statusCode = 409;
            throw error;
          }

          const activeApproval = findActivePlanningApproval(
            assignments,
            groupId,
            unlockRequest.weekStartKey,
          );

          if (
            !activeApproval
            || !unlockRequestMatchesPlanningApproval(unlockRequest, activeApproval)
          ) {
            const error = new Error(
              "Esta solicitud corresponde a una versión anterior. Envía una nueva solicitud para la versión aprobada actual.",
            );

            error.statusCode = 409;
            throw error;
          }

          const employeeIds = [...new Set(
            assignments
              .map((assignment) => assignment.employee?.toString?.() || "")
              .filter(Boolean),
          )];
          const unlockedVersionKeys = [...new Set(assignments.flatMap((assignment) =>
            (assignment.planningApprovals || [])
              .filter((approval) =>
                approval.weekStartKey === unlockRequest.weekStartKey
                && approval.groupId?.toString?.() === groupId
                && !approval.unlockedAt,
              )
              .map(buildPlanningApprovalVersionKey),
          ))];

          await ScheduleAssignment.updateMany(
            { _id: { $in: assignments.map((assignment) => assignment._id) } },
            {
              $set: {
                "planningApprovals.$[approval].unlockedAt": reviewedAt,
                "planningApprovals.$[approval].unlockedBy": reviewer,
                "planningApprovals.$[approval].unlockedByUser": reviewerUser,
                "planningApprovals.$[approval].unlockReason": unlockRequest.reason,
              },
            },
            {
              arrayFilters: [{
                "approval.weekStartKey": unlockRequest.weekStartKey,
                "approval.groupId": groupObjectId,
                "approval.unlockedAt": null,
              }],
              session,
            },
          );

          auditDocuments.push({
            actor: reviewer,
            action: "planningSchedule.version.unlock",
            entityType: "planningWorkGroup",
            entityId: groupId,
            entityLabel: `${unlockRequest.groupName} ${unlockRequest.weekStartKey}`,
            route: `/api/planner/planning/schedule-unlock-requests/${requestId}`,
            details: {
              source: "approved_unlock_request",
              unlockRequestId: requestId,
              weekStartKey: unlockRequest.weekStartKey,
              groupId,
              groupName: unlockRequest.groupName,
              unlockedAt: reviewedAt,
              unlockedByUser: reviewerUser,
              unlockReason: unlockRequest.reason,
              employeeIds,
              unlockedVersionKeys,
            },
          });
          responseMessage = "Solicitud aprobada y planificación desbloqueada.";
        } else {
          responseMessage = "Solicitud de desbloqueo rechazada.";
        }

        unlockRequest.status = action === "approve" ? "approved" : "rejected";
        unlockRequest.reviewedAt = reviewedAt;
        unlockRequest.reviewedBy = reviewer;
        unlockRequest.reviewedByUser = reviewerUser;
        unlockRequest.reviewNotes = reviewNotes;

        await unlockRequest.save({ session });

        serializedRequest = serializeScheduleUnlockRequest(unlockRequest.toObject());
        auditDocuments.push({
          actor: reviewer,
          action: action === "approve"
            ? "planningSchedule.unlockRequest.approve"
            : "planningSchedule.unlockRequest.reject",
          entityType: "scheduleUnlockRequest",
          entityId: requestId,
          entityLabel: `${unlockRequest.groupName} ${unlockRequest.weekStartKey}`,
          route: `/api/planner/planning/schedule-unlock-requests/${requestId}`,
          details: {
            groupId,
            groupName: unlockRequest.groupName,
            weekStartKey: unlockRequest.weekStartKey,
            reviewNotes,
            before,
            after: serializedRequest,
          },
        });

        await AuditLog.create(auditDocuments, { session, ordered: true });
      });
    } finally {
      await session.endSession();
    }

    return NextResponse.json({
      message: responseMessage,
      request: serializedRequest,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo resolver la solicitud de desbloqueo." },
      { status: error.statusCode || 400 },
    );
  }
}
