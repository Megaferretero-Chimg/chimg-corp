import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
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
import {
  deleteExceptionManualPunch,
  resolvePermissionPunchSelection,
  syncExceptionManualPunch,
} from "@/modules/planner/lib/planning/exceptionPunches";
import {
  findLaterAttendanceDecisionForException,
  findLaterExceptionForException,
} from "@/modules/planner/lib/attendance/decisionDependencies";
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
    const user = plannerScope.user;
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
    const bodyWithPermissionPunches = {
      ...body,
      permissionPunchIds: Array.isArray(body?.permissionPunchIds)
        ? body.permissionPunchIds
        : (currentException.permissionPunches || []).map(String),
      permissionPunchTimes: Array.isArray(body?.permissionPunchTimes)
        ? body.permissionPunchTimes
        : currentException.permissionPunchTimes || [],
      discountMinutes: body?.discountMinutes ?? currentException.discountMinutes ?? 0,
    };
    const normalizedBodyWithPermissionPunches = await resolvePermissionPunchSelection(
      applyExceptionApprovalActor({ ...bodyWithPermissionPunches, registeredBy }, user),
      employee._id,
      exceptionId,
    );
    const payload = normalizeExceptionPayload(
      normalizedBodyWithPermissionPunches,
      employee,
    );

    const exception = await OperationalException.findByIdAndUpdate(exceptionId, {
      ...payload,
      manualPunch: currentException.manualPunch || null,
      manualPunches: currentException.manualPunches || (
        currentException.manualPunch ? [currentException.manualPunch] : []
      ),
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

    if (currentException.status === "void") {
      return NextResponse.json(
        { error: "La excepción ya fue anulada." },
        { status: 409 },
      );
    }

    const user = plannerScope.user;
    const canApproveExceptions = await canUserApproveExceptions(user);
    const canDeleteOwn = hasAccessPermission(user, "planner.exceptions.deleteOwn");
    const isOwner = String(currentException.createdByUser || "").trim() === String(user?.id || "").trim();
    const isPending = currentException.resolution === "pending" && currentException.status !== "void";
    const canResetAttendanceExecution = currentException.planningSource === "attendance_comparison"
      && hasAccessPermission(user, "planner.attendance.review");
    const canVoidResolvedException = canApproveExceptions || canResetAttendanceExecution;

    if (!isPending && !canVoidResolvedException) {
      return NextResponse.json(
        { error: "Solo un administrador de excepciones puede anular registros aprobados o resueltos." },
        { status: 403 },
      );
    }

    if (!canVoidResolvedException && !(isPending && canDeleteOwn && isOwner)) {
      return NextResponse.json(
        { error: "Solo puedes eliminar tus propios registros mientras estén pendientes." },
        { status: 403 },
      );
    }

    assertEmployeesInPlannerScope([
      currentException.employee?.toString?.() || currentException.employee,
    ], plannerScope);

    const [laterAttendanceDecision, laterException] = await Promise.all([
      findLaterAttendanceDecisionForException(currentException),
      findLaterExceptionForException(currentException),
    ]);

    if (laterAttendanceDecision || laterException) {
      return NextResponse.json({
        error: "Esta excepción tiene una resolución posterior. Desactiva primero la decisión más reciente para no romper el flujo del día.",
      }, { status: 409 });
    }

    await deleteExceptionManualPunch(currentException);
    const actor = user?.employeeName || user?.username || user?.id || "SISTEMA";
    const employeeId = currentException.employee?.toString?.() || String(currentException.employee || "");
    const before = serializeOperationalException(currentException);
    const voidReason = isPending
      ? "Registro pendiente anulado por el usuario."
      : "Registro aprobado o resuelto anulado por un administrador.";

    const voidedException = await OperationalException.findByIdAndUpdate(
      exceptionId,
      {
        $set: {
          status: "void",
          resolution: isPending ? "no_action" : currentException.resolution,
          resolutionNotes: currentException.resolutionNotes || voidReason,
          manualPunch: null,
          manualPunches: [],
          manualPunchTime: "",
          manualPunchTimes: [],
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
      message: isPending
        ? "Excepción pendiente eliminada correctamente."
        : "Excepción aprobada anulada correctamente. El antecedente permanece en el historial.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo anular la excepcion." },
      { status: 400 },
    );
  }
}
