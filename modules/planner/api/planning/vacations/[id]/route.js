import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  normalizeVacationPayload,
  serializeVacationRecord,
} from "@/modules/planner/lib/planning/vacations";
import { Employee } from "@/modules/company/models";
import { VacationRequest } from "@/modules/planner/models";

async function findOverlappingVacation({ employeeId, startDateKey, endDateKey, excludeId = "" }) {
  const query = {
    employee: employeeId,
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

export async function PATCH(request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    const params = await context.params;
    const vacationId = String(params?.id || "").trim();

    if (!vacationId) {
      return NextResponse.json({ error: "Debes indicar una vacacion valida." }, { status: 400 });
    }

    await connectToDatabase();

    const body = await request.json();
    const employeeId = String(body?.employeeId || "").trim();
    const employee = await Employee.findById(employeeId).lean();
    const payload = normalizeVacationPayload(body, employee);
    const overlappingVacation = await findOverlappingVacation({
      employeeId,
      startDateKey: payload.startDateKey,
      endDateKey: payload.endDateKey,
      excludeId: vacationId,
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

    const vacation = await VacationRequest.findByIdAndUpdate(vacationId, payload, {
      new: true,
      runValidators: true,
    });

    if (!vacation) {
      return NextResponse.json({ error: "Vacacion no encontrada." }, { status: 404 });
    }

    return NextResponse.json({
      message: "Vacaciones actualizadas correctamente.",
      vacation: serializeVacationRecord(vacation),
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
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  const params = await context.params;
  const vacationId = String(params?.id || "").trim();

  if (!vacationId) {
    return NextResponse.json({ error: "Debes indicar una vacacion valida." }, { status: 400 });
  }

  await connectToDatabase();

  const vacation = await VacationRequest.findByIdAndDelete(vacationId);

  if (!vacation) {
    return NextResponse.json({ error: "Vacacion no encontrada." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
