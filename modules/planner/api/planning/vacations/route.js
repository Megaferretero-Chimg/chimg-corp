import { NextResponse } from "next/server";

import { createAuditLog } from "@/lib/audit";
import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  applyPlannerScopeToEmployeeReferenceQuery,
  assertEmployeesInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import {
  APPROVED_VACATION_STATUS_QUERY,
  buildMonthVacationQuery,
  isVacationRequestOwner,
  normalizeVacationPayload,
  serializeVacationRecord,
} from "@/modules/planner/lib/planning/vacations";
import { Employee } from "@/modules/company/models";
import { VacationRequest } from "@/modules/planner/models";

async function findOverlappingVacation({ employeeId, startDateKey, endDateKey, excludeId = "" }) {
  const query = {
    employee: employeeId,
    status: { $ne: "rejected" },
    startDateKey: { $lte: endDateKey },
    endDateKey: { $gte: startDateKey },
  };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  return VacationRequest.findOne(query)
    .select({ startDateKey: 1, endDateKey: 1 })
    .lean();
}

export async function GET(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const { searchParams } = new URL(request.url);
    const query = buildMonthVacationQuery(searchParams.get("month"));
    const plannerScope = await resolvePlannerEmployeeScope();
    const canViewVacationRequests = hasAccessPermission(user, "planner.timeOff.view");
    const canManageVacationRequests = hasAccessPermission(user, "planner.timeOff.manage");

    if (
      !canViewVacationRequests
      && !hasAccessPermission(user, "planner.schedules.weekly.view")
    ) {
      return NextResponse.json({ error: "No tienes permiso para ver vacaciones." }, { status: 403 });
    }

    applyPlannerScopeToEmployeeReferenceQuery(query, plannerScope);

    if (searchParams.get("includeRequests") !== "true" || !canViewVacationRequests) {
      query.status = APPROVED_VACATION_STATUS_QUERY;
    }

    const vacations = await VacationRequest.find(query)
      .sort({ startDate: 1, employeeName: 1 })
      .lean();

    return NextResponse.json({
      vacations: vacations.map((vacation) => {
        const serializedVacation = serializeVacationRecord(vacation);

        return {
          ...serializedVacation,
          canDelete: canManageVacationRequests || (
            serializedVacation.status === "pending"
            && isVacationRequestOwner(vacation, user)
          ),
        };
      }),
      capabilities: {
        canRequest: canViewVacationRequests,
        canManage: canManageVacationRequests,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron cargar las vacaciones." },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const canRequestVacation = hasAccessPermission(user, "planner.timeOff.view");
    const canManageVacation = hasAccessPermission(user, "planner.timeOff.manage");

    if (!canRequestVacation) {
      return NextResponse.json({ error: "No tienes permiso para solicitar vacaciones." }, { status: 403 });
    }

    const body = await request.json();
    const employeeId = String(body?.employeeId || "").trim();

    if (!employeeId) {
      throw new Error("Debes seleccionar un empleado.");
    }

    const plannerScope = await resolvePlannerEmployeeScope();
    assertEmployeesInPlannerScope([employeeId], plannerScope);

    const employee = await Employee.findById(employeeId).lean();
    const actor = String(user?.employeeName || user?.username || user?.id || "SISTEMA").trim();
    const actorUser = String(user?.id || user?.username || "").trim();
    const payload = {
      ...normalizeVacationPayload(body, employee),
      status: canManageVacation ? "approved" : "pending",
      requestedBy: actor,
      requestedByUser: actorUser,
      ...(canManageVacation ? {
        reviewedAt: new Date(),
        reviewedBy: actor,
        reviewedByUser: actorUser,
      } : {}),
    };
    const overlappingVacation = await findOverlappingVacation({
      employeeId,
      startDateKey: payload.startDateKey,
      endDateKey: payload.endDateKey,
    });

    if (overlappingVacation) {
      return NextResponse.json(
        {
          error: `El empleado ya tiene vacaciones registradas del `
            + `${overlappingVacation.startDateKey} al ${overlappingVacation.endDateKey}.`,
        },
        { status: 409 },
      );
    }

    const vacation = await VacationRequest.create(payload);
    const serializedVacation = serializeVacationRecord(vacation);

    await createAuditLog({
      actor,
      action: canManageVacation ? "vacation.create.approved" : "vacation.request.create",
      entityType: "vacationRequest",
      entityId: vacation._id.toString(),
      entityLabel: `${employee.fullName || employeeId} ${payload.startDateKey} - ${payload.endDateKey}`,
      route: "/api/planner/planning/vacations",
      details: {
        employeeId,
        employeeName: employee.fullName || "",
        status: payload.status,
        after: serializedVacation,
      },
    });

    return NextResponse.json(
      {
        message: canManageVacation
          ? "Vacaciones programadas correctamente."
          : "Solicitud de vacaciones registrada para revisión.",
        vacation: serializedVacation,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error?.code === 11000) {
      return NextResponse.json(
        { error: "El empleado ya tiene vacaciones registradas en ese rango de fechas." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: error.message || "No se pudo registrar la vacacion." },
      { status: 400 },
    );
  }
}
