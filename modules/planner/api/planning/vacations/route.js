import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  buildMonthVacationQuery,
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

export async function GET(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const { searchParams } = new URL(request.url);
    const query = buildMonthVacationQuery(searchParams.get("month"));

    const vacations = await VacationRequest.find(query)
      .sort({ startDate: 1, employeeName: 1 })
      .lean();

    return NextResponse.json({
      vacations: vacations.map(serializeVacationRequest),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron cargar las vacaciones." },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const body = await request.json();
    const employeeId = String(body?.employeeId || "").trim();

    if (!employeeId) {
      throw new Error("Debes seleccionar un empleado.");
    }

    const employee = await Employee.findById(employeeId).lean();
    const payload = normalizeVacationPayload(body, employee);
    const overlaps = await hasOverlappingVacation({
      employeeId,
      startDate: payload.startDate,
      endDate: payload.endDate,
    });

    if (overlaps) {
      return NextResponse.json(
        { error: "El empleado ya tiene vacaciones programadas dentro de ese rango." },
        { status: 409 },
      );
    }

    const vacation = await VacationRequest.create(payload);

    return NextResponse.json(
      {
        message: "Vacaciones programadas correctamente.",
        vacation: serializeVacationRequest(vacation),
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo registrar la vacacion." },
      { status: 400 },
    );
  }
}
