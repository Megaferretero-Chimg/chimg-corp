import { NextResponse } from "next/server";

import { createAuditLog } from "@/lib/audit";
import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  assertEmployeesInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import {
  serializeVacationRecord,
} from "@/modules/planner/lib/planning/vacations";
import { VacationRequest } from "@/modules/planner/models";

function actorFromUser(user) {
  return {
    actor: String(user?.employeeName || user?.username || user?.id || "SISTEMA").trim(),
    actorUser: String(user?.id || user?.username || "").trim(),
  };
}

export async function PATCH(request, context) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.timeOff.manage")) {
    return NextResponse.json(
      { error: "Solo los usuarios autorizados pueden modificar o resolver solicitudes de vacaciones." },
      { status: 403 },
    );
  }

  try {
    const params = await context.params;
    const vacationId = String(params?.id || "").trim();

    if (!vacationId) {
      return NextResponse.json({ error: "Debes indicar una vacacion valida." }, { status: 400 });
    }

    await connectToDatabase();

    const [body, plannerScope, currentVacation] = await Promise.all([
      request.json(),
      resolvePlannerEmployeeScope(),
      VacationRequest.findById(vacationId).lean(),
    ]);

    if (!currentVacation) {
      return NextResponse.json({ error: "Vacacion no encontrada." }, { status: 404 });
    }

    const currentEmployeeId = currentVacation.employee?.toString?.() || "";

    assertEmployeesInPlannerScope([currentEmployeeId], plannerScope);

    const action = String(body?.action || "").trim().toLowerCase();
    const { actor, actorUser } = actorFromUser(user);
    const currentStatus = ["pending", "approved", "rejected"].includes(currentVacation.status)
      ? currentVacation.status
      : "approved";
    let updatePayload;
    let auditAction;
    let message;

    if (!["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "Las solicitudes de vacaciones no se pueden editar." },
        { status: 400 },
      );
    }

    if (currentStatus !== "pending") {
      return NextResponse.json(
        {
          error: currentStatus === "approved"
            ? "Las vacaciones aprobadas solo se pueden eliminar."
            : "Las solicitudes rechazadas solo se pueden eliminar.",
        },
        { status: 409 },
      );
    }

    if (action === "approve") {
      updatePayload = {
        status: "approved",
        reviewedAt: new Date(),
        reviewedBy: actor,
        reviewedByUser: actorUser,
        reviewNotes: String(body?.reviewNotes || "").trim(),
      };
      auditAction = "vacation.request.approve";
      message = "Solicitud de vacaciones aprobada.";
    } else if (action === "reject") {
      updatePayload = {
        status: "rejected",
        coveredDateKeys: [],
        reviewedAt: new Date(),
        reviewedBy: actor,
        reviewedByUser: actorUser,
        reviewNotes: String(body?.reviewNotes || "").trim(),
      };
      auditAction = "vacation.request.reject";
      message = "Solicitud de vacaciones rechazada.";
    }

    const vacation = await VacationRequest.findOneAndUpdate({
      _id: vacationId,
      status: "pending",
    }, updatePayload, {
      new: true,
      runValidators: true,
    });

    if (!vacation) {
      return NextResponse.json(
        { error: "La solicitud ya fue resuelta y solo se puede eliminar." },
        { status: 409 },
      );
    }

    const serializedVacation = serializeVacationRecord(vacation);

    await createAuditLog({
      actor,
      action: auditAction,
      entityType: "vacationRequest",
      entityId: vacationId,
      entityLabel: `${vacation.employeeName || currentVacation.employeeName || ""} ${vacation.startDateKey} - ${vacation.endDateKey}`,
      route: `/api/planner/planning/vacations/${vacationId}`,
      details: {
        employeeId: vacation.employee?.toString?.() || currentEmployeeId,
        before: serializeVacationRecord(currentVacation),
        after: serializedVacation,
      },
    });

    return NextResponse.json({
      message,
      vacation: serializedVacation,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return NextResponse.json(
        { error: "El empleado ya tiene vacaciones registradas en ese rango de fechas." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: error.message || "No se pudo actualizar la vacacion." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request, context) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.timeOff.manage")) {
    return NextResponse.json(
      { error: "No tienes permiso para eliminar solicitudes de vacaciones." },
      { status: 403 },
    );
  }

  const params = await context.params;
  const vacationId = String(params?.id || "").trim();

  if (!vacationId) {
    return NextResponse.json({ error: "Debes indicar una vacacion valida." }, { status: 400 });
  }

  await connectToDatabase();

  const [vacation, plannerScope] = await Promise.all([
    VacationRequest.findById(vacationId).lean(),
    resolvePlannerEmployeeScope(),
  ]);

  if (!vacation) {
    return NextResponse.json({ error: "Vacacion no encontrada." }, { status: 404 });
  }

  const employeeId = vacation.employee?.toString?.() || "";

  assertEmployeesInPlannerScope([employeeId], plannerScope);
  await VacationRequest.findByIdAndDelete(vacationId);

  const { actor } = actorFromUser(user);

  await createAuditLog({
    actor,
    action: "vacation.request.delete",
    entityType: "vacationRequest",
    entityId: vacationId,
    entityLabel: `${vacation.employeeName || ""} ${vacation.startDateKey} - ${vacation.endDateKey}`,
    route: `/api/planner/planning/vacations/${vacationId}`,
    details: {
      employeeId,
      before: serializeVacationRecord(vacation),
      after: null,
    },
  });

  return NextResponse.json({ success: true });
}
