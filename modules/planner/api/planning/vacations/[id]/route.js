import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  normalizeVacationPayload,
  serializeVacationRequest,
} from "@/modules/planner/lib/planning/vacations";
import { Employee } from "@/modules/company/models";
import { VacationRequest } from "@/modules/planner/models";

async function hasOverlappingVacation({ employeeId, startDate, endDate, excludeId = "" }) {
  const query = {
    employee: employeeId,
    status: "scheduled",
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  return Boolean(await VacationRequest.exists(query));
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
    const overlaps = await hasOverlappingVacation({
      employeeId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      excludeId: vacationId,
    });

    if (overlaps) {
      return NextResponse.json(
        { error: "El empleado ya tiene vacaciones programadas dentro de ese rango." },
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
      vacation: serializeVacationRequest(vacation),
    });
  } catch (error) {
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

  const vacation = await VacationRequest.findByIdAndUpdate(
    vacationId,
    { $set: { status: "cancelled" } },
    { new: true },
  );

  if (!vacation) {
    return NextResponse.json({ error: "Vacacion no encontrada." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
