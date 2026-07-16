import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  applyPlannerScopeToEmployeeReferenceQuery,
  assertEmployeesInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import {
  buildMonthVacationQuery,
  normalizeVacationPayload,
  serializeVacationRecord,
} from "@/modules/planner/lib/planning/vacations";
import { Employee } from "@/modules/company/models";
import { VacationRequest } from "@/modules/planner/models";

async function hasOverlappingVacation({ employeeId, startDate, endDate, excludeId = "" }) {
  const query = {
    employee: employeeId,
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  return Boolean(await VacationRequest.exists(query));
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

    if (
      !hasAccessPermission(user, "planner.timeOff.view")
      && !hasAccessPermission(user, "planner.schedules.weekly.view")
    ) {
      return NextResponse.json({ error: "No tienes permiso para ver vacaciones." }, { status: 403 });
    }

    applyPlannerScopeToEmployeeReferenceQuery(query, plannerScope);

    const vacations = await VacationRequest.find(query)
      .sort({ startDate: 1, employeeName: 1 })
      .lean();

    return NextResponse.json({
      vacations: vacations.map(serializeVacationRecord),
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

    if (!hasAccessPermission(user, "planner.timeOff.manage")) {
      return NextResponse.json({ error: "No tienes permiso para gestionar vacaciones." }, { status: 403 });
    }

    const body = await request.json();
    const employeeId = String(body?.employeeId || "").trim();

    if (!employeeId) {
      throw new Error("Debes seleccionar un empleado.");
    }

    const plannerScope = await resolvePlannerEmployeeScope();
    assertEmployeesInPlannerScope([employeeId], plannerScope);

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
        vacation: serializeVacationRecord(vacation),
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
