import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
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

    if (!hasAccessPermission(plannerScope.user, "planner.exceptions.view")) {
      return NextResponse.json({ error: "No tienes permiso para ver ajustes y excepciones." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const query = buildMonthExceptionQuery(searchParams.get("month"));
    const isWeeklyIndicatorRequest = searchParams.get("context") === "weekly"
      && hasAccessPermission(plannerScope.user, "planner.schedules.weekly.view");
    const user = plannerScope.user;
    const canApproveExceptions = await canUserApproveExceptions(user);
    const canDeleteOwnExceptions = hasAccessPermission(user, "planner.exceptions.deleteOwn");
    const canCreateExceptions = hasAccessPermission(user, "planner.exceptions.create");

    applyPlannerScopeToEmployeeReferenceQuery(query, plannerScope);

    if (isWeeklyIndicatorRequest) {
      query.resolution = { $ne: "no_action" };
    }

    if (!isWeeklyIndicatorRequest && !hasAccessPermission(user, "planner.exceptions.viewAll")) {
      query.createdByUser = user.id;
    }

    const exceptions = await OperationalException.find(query)
      .sort({ date: -1, employeeName: 1 })
      .lean();

    return NextResponse.json({
      exceptions: exceptions.map((exception) => {
        const serializedException = serializeOperationalException(exception);
        const isOwner = String(exception.createdByUser || "").trim() === String(user?.id || "").trim();
        const isPending = exception.resolution === "pending" && exception.status !== "void";

        return {
          ...serializedException,
          canDelete: isPending && (canApproveExceptions || (canDeleteOwnExceptions && isOwner)),
        };
      }),
      options: {
        types: EXCEPTION_TYPES,
        resolutions: EXCEPTION_RESOLUTIONS,
        effects: RESOLUTION_EFFECTS,
        attendanceModes: ATTENDANCE_MODES,
        payModes: PAY_MODES,
        canApproveExceptions,
        canCreateExceptions,
        canDeleteOwnExceptions,
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
    const planningSource = String(body?.planningSource || "").trim();
    const requestKey = planningSource === "schedule_planner"
      ? String(body?.requestKey || "").trim().slice(0, 160)
      : "";
    const canCreateFromAttendance = planningSource === "attendance_comparison"
      && hasAccessPermission(plannerScope.user, "planner.attendance.review");

    if (
      !hasAccessPermission(plannerScope.user, "planner.exceptions.create")
      && !canCreateFromAttendance
    ) {
      return NextResponse.json({ error: "No tienes permiso para crear ajustes y excepciones." }, { status: 403 });
    }

    const employeeId = String(body?.employeeId || "").trim();

    if (!employeeId) {
      throw new Error("Debes seleccionar un empleado.");
    }

    assertEmployeesInPlannerScope([employeeId], plannerScope);

    const employee = await Employee.findById(employeeId).lean();
    const user = plannerScope.user;
    const canApproveExceptions = await canUserApproveExceptions(user);
    const registeredBy = user?.employeeName || user?.username || user?.id || "SISTEMA";
    const isAttendanceExecution = planningSource === "attendance_comparison";
    const shouldAutoResolve = isAttendanceExecution || (
      planningSource === "schedule_planner" &&
      canApproveExceptions &&
      body?.autoResolve !== false
    );
    const requestedResolution = String(body?.resolution || "").trim();
    const executionResolution = requestedResolution && requestedResolution !== "pending"
      ? requestedResolution
      : body?.effect === "planning_change" || body?.type === "schedule_change"
        ? "reschedule"
        : body?.effect === "unpaid_absence"
          ? "discount_day"
          : "approved_work_time";
    const sourceBody = isAttendanceExecution
      ? { ...body, autoResolve: true, resolution: executionResolution }
      : body;

    console.info("[planning/exceptions] create requested", {
      planningSource,
      employeeId,
      dateKey: body?.dateKey || "",
      type: body?.type || "",
      autoResolveRequested: body?.autoResolve !== false,
      canApproveExceptions,
      shouldAutoResolve,
    });

    const normalizedBody = shouldAutoResolve
      ? applyExceptionApprovalActor(sourceBody, user)
      : forcePendingExceptionPayload(sourceBody);
    const payload = {
      ...normalizeExceptionPayload({ ...normalizedBody, registeredBy }, employee),
      createdByUser: String(user?.id || user?.username || "").trim(),
      requestKey,
    };
    const idempotencyQuery = requestKey
      ? {
        requestKey,
        employee: employee._id,
        createdByUser: payload.createdByUser,
      }
      : null;
    const existingException = requestKey
      ? await OperationalException.findOne(idempotencyQuery).lean()
      : null;

    if (existingException) {
      return NextResponse.json({
        message: "La excepcion ya habia sido registrada.",
        exception: serializeOperationalException(existingException),
      });
    }

    let exception;

    try {
      exception = await OperationalException.create(payload);
    } catch (createError) {
      if (requestKey && createError?.code === 11000) {
        const concurrentException = await OperationalException.findOne(idempotencyQuery).lean();

        if (concurrentException) {
          return NextResponse.json({
            message: "La excepcion ya habia sido registrada.",
            exception: serializeOperationalException(concurrentException),
          });
        }
      }

      throw createError;
    }

    try {
      await syncExceptionManualPunch(exception);
    } catch (syncError) {
      await OperationalException.findByIdAndDelete(exception._id);
      throw syncError;
    }

    const savedException = await OperationalException.findById(exception._id).lean();

    await createAuditLog({
      actor: registeredBy,
      action: "operationalException.create",
      entityType: "operationalException",
      entityId: exception._id.toString(),
      entityLabel: `${employee.fullName || employeeId} ${savedException?.dateKey || ""}`,
      route: "/api/planner/planning/exceptions",
      details: {
        employeeId,
        employeeName: employee.fullName || "",
        dateKey: savedException?.dateKey || "",
        planningSource: savedException?.planningSource || "",
        before: null,
        after: serializeOperationalException(savedException),
      },
    });

    console.info("[planning/exceptions] create completed", {
      exceptionId: exception._id.toString(),
      employeeId,
      dateKey: savedException?.dateKey || "",
      resolution: savedException?.resolution || "pending",
    });

    return NextResponse.json(
      {
        message: "Excepcion registrada correctamente.",
        exception: serializeOperationalException(savedException),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[planning/exceptions] create failed", {
      message: error.message || String(error),
    });

    return NextResponse.json(
      { error: error.message || "No se pudo registrar la excepcion." },
      { status: 400 },
    );
  }
}
