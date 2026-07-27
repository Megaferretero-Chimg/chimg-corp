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

    return NextResponse.json(
      {
        message: "Vacaciones programadas correctamente.",
        vacation: serializeVacationRecord(vacation),
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
