import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
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

    if (currentException.status === "void") {
      return NextResponse.json(
        { error: "La excepcion ya fue anulada y no se puede modificar." },
        { status: 409 },
      );
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
    const actor = user?.employeeName || user?.username || user?.id || "SISTEMA";

    await createAuditLog({
      actor,
      action: "operationalException.update",
      entityType: "operationalException",
      entityId: exceptionId,
      entityLabel: `${employee.fullName || employeeId} ${savedException?.dateKey || ""}`,
      route: `/api/planner/planning/exceptions/${exceptionId}`,
      details: {
        employeeId,
        employeeName: employee.fullName || "",
        dateKey: savedException?.dateKey || "",
        planningSource: savedException?.planningSource || "",
        before: serializeOperationalException(currentException),
        after: serializeOperationalException(savedException),
      },
    });

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

    const currentException = await OperationalException.findById(exceptionId).lean();

    if (!currentException) {
      return NextResponse.json({ error: "Excepcion no encontrada." }, { status: 404 });
    }

    const user = await getAuthenticatedUser();
    const canApproveExceptions = await canUserApproveExceptions(user);
    const canResetAttendanceExecution = currentException.planningSource === "attendance_comparison";

    if (!canApproveExceptions && !canResetAttendanceExecution) {
      return NextResponse.json(
        { error: "No tienes permiso para anular excepciones." },
        { status: 403 },
      );
    }

    assertEmployeesInPlannerScope([
      currentException.employee?.toString?.() || currentException.employee,
    ], plannerScope);

    await deleteExceptionManualPunch(currentException);
    const actor = user?.employeeName || user?.username || user?.id || "SISTEMA";
    const employeeId = currentException.employee?.toString?.() || String(currentException.employee || "");
    const before = serializeOperationalException(currentException);

    if (currentException.resolution === "pending" || currentException.status === "open") {
      await OperationalException.findByIdAndDelete(exceptionId);

      await createAuditLog({
        actor,
        action: "operationalException.delete",
        entityType: "operationalException",
        entityId: exceptionId,
        entityLabel: `${currentException.employeeName || employeeId} ${currentException.dateKey || ""}`,
        route: `/api/planner/planning/exceptions/${exceptionId}`,
        details: {
          employeeId,
          employeeName: currentException.employeeName || "",
          dateKey: currentException.dateKey || "",
          planningSource: currentException.planningSource || "",
          before,
          after: null,
        },
      });

      return NextResponse.json({
        success: true,
        action: "deleted",
        message: "Justificacion eliminada correctamente.",
      });
    }

    const voidedException = await OperationalException.findByIdAndUpdate(
      exceptionId,
      {
        $set: {
          status: "void",
          resolution: "no_action",
          resolutionNotes: currentException.resolutionNotes || "Anulada manualmente.",
          manualPunch: null,
          manualPunchTime: "",
        },
      },
      { new: true },
    );

    await createAuditLog({
      actor,
      action: "operationalException.void",
      entityType: "operationalException",
      entityId: exceptionId,
      entityLabel: `${currentException.employeeName || employeeId} ${currentException.dateKey || ""}`,
      route: `/api/planner/planning/exceptions/${exceptionId}`,
      details: {
        employeeId,
        employeeName: currentException.employeeName || "",
        dateKey: currentException.dateKey || "",
        planningSource: currentException.planningSource || "",
        before,
        after: serializeOperationalException(voidedException),
      },
    });

    return NextResponse.json({
      success: true,
      action: "voided",
      message: "Justificacion anulada correctamente.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo anular la excepcion." },
      { status: 400 },
    );
  }
}
