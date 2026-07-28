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

function actorFromUser(user) {
  return {
    actor: String(user?.employeeName || user?.username || user?.id || "SISTEMA").trim(),
    actorUser: String(user?.id || user?.username || "").trim(),
  };
}

function overlapResponse(vacation) {
  return NextResponse.json(
    {
      error: `El empleado ya tiene vacaciones registradas del `
        + `${vacation.startDateKey} al ${vacation.endDateKey}.`,
    },
    { status: 409 },
  );
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
    let updatePayload;
    let auditAction;
    let message;

    if (action === "approve") {
      const employee = await Employee.findById(currentEmployeeId).lean();
      const normalizedPayload = normalizeVacationPayload({
        startDateKey: currentVacation.startDateKey,
        endDateKey: currentVacation.endDateKey,
        notes: currentVacation.notes,
      }, employee);
      const overlappingVacation = await findOverlappingVacation({
        employeeId: currentEmployeeId,
        startDateKey: normalizedPayload.startDateKey,
        endDateKey: normalizedPayload.endDateKey,
        excludeId: vacationId,
      });

      if (overlappingVacation) return overlapResponse(overlappingVacation);

      updatePayload = {
        ...normalizedPayload,
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
    } else {
      const employeeId = String(body?.employeeId || "").trim();

      if (!employeeId) {
        throw new Error("Debes seleccionar un empleado.");
      }

      assertEmployeesInPlannerScope([employeeId], plannerScope);

      const employee = await Employee.findById(employeeId).lean();
      const normalizedPayload = normalizeVacationPayload(body, employee);
      const currentStatus = ["pending", "approved", "rejected"].includes(currentVacation.status)
        ? currentVacation.status
        : "approved";

      if (currentStatus !== "rejected") {
        const overlappingVacation = await findOverlappingVacation({
          employeeId,
          startDateKey: normalizedPayload.startDateKey,
          endDateKey: normalizedPayload.endDateKey,
          excludeId: vacationId,
        });

        if (overlappingVacation) return overlapResponse(overlappingVacation);
      }

      updatePayload = {
        ...normalizedPayload,
        status: currentStatus,
        ...(currentStatus === "rejected" ? { coveredDateKeys: [] } : {}),
      };
      auditAction = "vacation.request.update";
      message = currentStatus === "approved"
        ? "Vacaciones actualizadas correctamente."
        : "Solicitud de vacaciones actualizada correctamente.";
    }

    const vacation = await VacationRequest.findByIdAndUpdate(vacationId, updatePayload, {
      new: true,
      runValidators: true,
    });
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
