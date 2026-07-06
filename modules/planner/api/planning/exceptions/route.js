import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  applyPlannerScopeToEmployeeReferenceQuery,
  assertEmployeesInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import {
  applyExceptionApprovalActor,
  canUserApproveExceptions,
  forcePendingExceptionPayload,
} from "@/modules/planner/lib/planning/exceptionApprovals";
import {
  buildMonthExceptionQuery,
  ATTENDANCE_MODES,
  EXCEPTION_RESOLUTIONS,
  EXCEPTION_TYPES,
  PAY_MODES,
  RESOLUTION_EFFECTS,
  normalizeExceptionPayload,
  serializeOperationalException,
} from "@/modules/planner/lib/planning/exceptions";
import { syncExceptionManualPunch } from "@/modules/planner/lib/planning/exceptionPunches";
import { Employee } from "@/modules/company/models";
import { OperationalException } from "@/modules/planner/models";

export async function GET(request) {
  try {
    await connectToDatabase();
    const plannerScope = await resolvePlannerEmployeeScope();

    if (!plannerScope.isAuthenticated) {
      return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = buildMonthExceptionQuery(searchParams.get("month"));
    const user = await getAuthenticatedUser();
    const canApproveExceptions = await canUserApproveExceptions(user);

    applyPlannerScopeToEmployeeReferenceQuery(query, plannerScope);

    const exceptions = await OperationalException.find(query)
      .sort({ date: -1, employeeName: 1 })
      .lean();

    return NextResponse.json({
      exceptions: exceptions.map(serializeOperationalException),
      options: {
        types: EXCEPTION_TYPES,
        resolutions: EXCEPTION_RESOLUTIONS,
        effects: RESOLUTION_EFFECTS,
        attendanceModes: ATTENDANCE_MODES,
        payModes: PAY_MODES,
        canApproveExceptions,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron cargar las excepciones." },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  try {
    await connectToDatabase();
    const plannerScope = await resolvePlannerEmployeeScope();

    if (!plannerScope.isAuthenticated) {
      return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
    }

    const body = await request.json();
    const employeeId = String(body?.employeeId || "").trim();

    if (!employeeId) {
      throw new Error("Debes seleccionar un empleado.");
    }

    assertEmployeesInPlannerScope([employeeId], plannerScope);

    const employee = await Employee.findById(employeeId).lean();
    const user = await getAuthenticatedUser();
    const canApproveExceptions = await canUserApproveExceptions(user);
    const registeredBy = user?.employeeName || user?.username || user?.id || "SISTEMA";
    const shouldResolveFromPlanner = body?.planningSource === "schedule_planner" && canApproveExceptions && body?.autoResolve !== false;
    const normalizedBody = shouldResolveFromPlanner
      ? applyExceptionApprovalActor(body, user)
      : forcePendingExceptionPayload(body);
    const payload = normalizeExceptionPayload({ ...normalizedBody, registeredBy }, employee);
    const exception = await OperationalException.create(payload);

    try {
      await syncExceptionManualPunch(exception);
    } catch (syncError) {
      await OperationalException.findByIdAndDelete(exception._id);
      throw syncError;
    }

    const savedException = await OperationalException.findById(exception._id).lean();

    return NextResponse.json(
      {
        message: "Excepcion registrada correctamente.",
        exception: serializeOperationalException(savedException),
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo registrar la excepcion." },
      { status: 400 },
    );
  }
}
