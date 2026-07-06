import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  assertEmployeesInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import {
  applyExceptionApprovalActor,
  canUserApproveExceptions,
} from "@/modules/planner/lib/planning/exceptionApprovals";
import {
  normalizeExceptionPayload,
  serializeOperationalException,
} from "@/modules/planner/lib/planning/exceptions";
import { deleteExceptionManualPunch, syncExceptionManualPunch } from "@/modules/planner/lib/planning/exceptionPunches";
import { Employee } from "@/modules/company/models";
import { OperationalException } from "@/modules/planner/models";

export async function PATCH(request, context) {
  try {
    const params = await context.params;
    const exceptionId = String(params?.id || "").trim();

    if (!exceptionId) {
      return NextResponse.json({ error: "Debes indicar una excepcion valida." }, { status: 400 });
    }

    await connectToDatabase();
    const plannerScope = await resolvePlannerEmployeeScope();

    if (!plannerScope.isAuthenticated) {
      return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
    }

    const body = await request.json();
    const employeeId = String(body?.employeeId || "").trim();
    const user = await getAuthenticatedUser();
    const currentException = await OperationalException.findById(exceptionId).lean();
    const canApproveExceptions = await canUserApproveExceptions(user);

    if (!canApproveExceptions) {
      return NextResponse.json(
        { error: "No tienes permiso para aprobar, rechazar, modificar o anular excepciones." },
        { status: 403 },
      );
    }

    if (!currentException) {
      return NextResponse.json({ error: "Excepcion no encontrada." }, { status: 404 });
    }

    assertEmployeesInPlannerScope([
      currentException.employee?.toString?.() || currentException.employee,
      employeeId,
    ], plannerScope);

    const employee = await Employee.findById(employeeId).lean();
    const registeredBy = currentException.registeredBy || user?.employeeName || user?.username || user?.id || "SISTEMA";
    const payload = normalizeExceptionPayload(
      applyExceptionApprovalActor({ ...body, registeredBy }, user),
      employee,
    );

    const exception = await OperationalException.findByIdAndUpdate(exceptionId, {
      ...payload,
      manualPunch: currentException.manualPunch || null,
    }, {
      new: true,
      runValidators: true,
    });

    try {
      await syncExceptionManualPunch(exception);
    } catch (syncError) {
      await OperationalException.replaceOne({ _id: currentException._id }, currentException);
      throw syncError;
    }

    const savedException = await OperationalException.findById(exception._id).lean();

    return NextResponse.json({
      message: "Excepcion actualizada correctamente.",
      exception: serializeOperationalException(savedException),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo actualizar la excepcion." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request, context) {
  const params = await context.params;
  const exceptionId = String(params?.id || "").trim();

  if (!exceptionId) {
    return NextResponse.json({ error: "Debes indicar una excepcion valida." }, { status: 400 });
  }

  await connectToDatabase();
  const plannerScope = await resolvePlannerEmployeeScope();

  if (!plannerScope.isAuthenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  const user = await getAuthenticatedUser();
  const canApproveExceptions = await canUserApproveExceptions(user);

  if (!canApproveExceptions) {
    return NextResponse.json(
      { error: "No tienes permiso para anular excepciones." },
      { status: 403 },
    );
  }

  const currentException = await OperationalException.findById(exceptionId).lean();

  if (!currentException) {
    return NextResponse.json({ error: "Excepcion no encontrada." }, { status: 404 });
  }

  assertEmployeesInPlannerScope([
    currentException.employee?.toString?.() || currentException.employee,
  ], plannerScope);

  const exception = await OperationalException.findByIdAndUpdate(
    exceptionId,
    { $set: { status: "void" } },
    { new: true },
  );

  await deleteExceptionManualPunch(exception);

  return NextResponse.json({ success: true });
}
