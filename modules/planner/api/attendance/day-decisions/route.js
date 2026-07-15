import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { buildEmployeeActiveInMonthQuery } from "@/modules/company/submodules/people/lib/employees";
import { AttendanceDayDecision } from "@/modules/planner/models";
import { Employee } from "@/modules/company/models";
import { findLaterExceptionForDay } from "@/modules/planner/lib/attendance/decisionDependencies";
import { removeCurrentAttendanceDecisionRevision } from "@/modules/planner/lib/attendance/dayDecisionRevisions";

const DECISIONS = new Set([
  "full",
  "planned",
  "none",
  "custom",
  "discount_day",
  "pay_planned_day",
  "complete_regular_day",
  "reviewed",
  "justify_early_leave",
  "justify_no_punches",
  "justify_incomplete_punches",
  "justify_late",
  "resolve_late",
]);

function minutes(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function parseDateKey(value) {
  const dateKey = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error("La fecha de la decisión no es válida.");
  }

  return dateKey;
}

function parseMonthKey(value) {
  const monthKey = String(value || "").trim();

  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error("El mes de la decisión no es válido.");
  }

  return monthKey;
}

function employeeFilterFromBody(body = {}) {
  const monthKey = String(body?.month || body?.dateKey || "").trim().slice(0, 7);
  const query = /^\d{4}-\d{2}$/.test(monthKey)
    ? buildEmployeeActiveInMonthQuery(new Date(`${monthKey}-01T00:00:00.000Z`))
    : { isActive: { $ne: false } };
  const employeeId = String(body?.employeeId || "").trim();
  const branchCode = String(body?.branchCode || "").trim().toUpperCase();
  const areaCode = String(body?.areaCode || "").trim().toUpperCase();
  const roleCode = String(body?.roleCode || "").trim().toUpperCase();

  if (employeeId) query._id = employeeId;
  if (branchCode) query.branchCode = branchCode;
  if (areaCode) query.areaCode = areaCode;
  if (roleCode) query.roleCode = roleCode;

  return query;
}

function normalizePayload(body) {
  const employeeId = String(body?.employeeId || "").trim();
  const dateKey = parseDateKey(body?.dateKey);
  const decision = String(body?.decision || "custom").trim();
  const detectedSupplementaryMinutes = minutes(body?.detectedSupplementaryMinutes);
  const detectedExtraordinaryMinutes = minutes(body?.detectedExtraordinaryMinutes);
  const detectedLateMinutes = minutes(body?.detectedLateMinutes);
  const detectedEarlyLeaveMinutes = minutes(body?.detectedEarlyLeaveMinutes);
  let authorizedSupplementaryMinutes = minutes(body?.authorizedSupplementaryMinutes);
  let authorizedExtraordinaryMinutes = minutes(body?.authorizedExtraordinaryMinutes);
  let adjustedLateMinutes = body?.adjustedLateMinutes === undefined || body?.adjustedLateMinutes === null
    ? detectedLateMinutes
    : minutes(body?.adjustedLateMinutes);
  let adjustedEarlyLeaveMinutes = body?.adjustedEarlyLeaveMinutes === undefined || body?.adjustedEarlyLeaveMinutes === null
    ? detectedEarlyLeaveMinutes
    : minutes(body?.adjustedEarlyLeaveMinutes);

  if (!employeeId) {
    throw new Error("Debes indicar el empleado.");
  }

  if (!DECISIONS.has(decision)) {
    throw new Error("La decisión no es válida.");
  }

  if (decision === "full") {
    authorizedSupplementaryMinutes = detectedSupplementaryMinutes;
    authorizedExtraordinaryMinutes = detectedExtraordinaryMinutes;
  }

  if (decision === "none" || decision === "discount_day") {
    authorizedSupplementaryMinutes = 0;
    authorizedExtraordinaryMinutes = 0;
    adjustedLateMinutes = 0;
    adjustedEarlyLeaveMinutes = 0;
  }

  if (decision === "reviewed") {
    authorizedSupplementaryMinutes = 0;
    authorizedExtraordinaryMinutes = 0;
    adjustedLateMinutes = detectedLateMinutes;
    adjustedEarlyLeaveMinutes = detectedEarlyLeaveMinutes;
  }

  if (["pay_planned_day", "complete_regular_day", "justify_early_leave", "justify_no_punches", "justify_incomplete_punches"].includes(decision)) {
    adjustedEarlyLeaveMinutes = 0;
  }

  if (["pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches", "justify_late"].includes(decision)) {
    adjustedLateMinutes = 0;
  }

  if (decision === "complete_regular_day") {
    authorizedSupplementaryMinutes = 0;
    authorizedExtraordinaryMinutes = 0;
  }

  authorizedSupplementaryMinutes = Math.min(authorizedSupplementaryMinutes, detectedSupplementaryMinutes);
  authorizedExtraordinaryMinutes = Math.min(authorizedExtraordinaryMinutes, detectedExtraordinaryMinutes);
  adjustedLateMinutes = Math.min(adjustedLateMinutes, detectedLateMinutes);
  adjustedEarlyLeaveMinutes = Math.min(adjustedEarlyLeaveMinutes, detectedEarlyLeaveMinutes);

  return {
    employeeId,
    dateKey,
    decision,
    authorizedSupplementaryMinutes,
    authorizedExtraordinaryMinutes,
    detectedSupplementaryMinutes,
    detectedExtraordinaryMinutes,
    detectedLateMinutes,
    adjustedLateMinutes,
    detectedEarlyLeaveMinutes,
    adjustedEarlyLeaveMinutes,
    additionalResolved: body?.additionalResolved === true,
    lateResolved: body?.lateResolved === true,
    note: String(body?.note || "").trim().slice(0, 240),
  };
}

export async function POST(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    const payload = normalizePayload(await request.json());

    await connectToDatabase();

    const employee = await Employee.findById(payload.employeeId).select("_id fullName").lean();

    if (!employee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    const date = new Date(`${payload.dateKey}T12:00:00.000Z`);
    const previousDecision = await AttendanceDayDecision.findOne({
      employee: payload.employeeId,
      dateKey: payload.dateKey,
    }).lean();
    const actor = user.employeeName || user.username || user.id;
    const additionalResolved = Boolean(previousDecision?.additionalResolved || payload.additionalResolved);
    const lateResolved = Boolean(previousDecision?.lateResolved || payload.lateResolved);

    await AttendanceDayDecision.updateOne(
      {
        employee: payload.employeeId,
        dateKey: payload.dateKey,
      },
      {
        $set: {
          date,
          decision: payload.decision,
          authorizedSupplementaryMinutes: payload.authorizedSupplementaryMinutes,
          authorizedExtraordinaryMinutes: payload.authorizedExtraordinaryMinutes,
          detectedSupplementaryMinutes: payload.detectedSupplementaryMinutes,
          detectedExtraordinaryMinutes: payload.detectedExtraordinaryMinutes,
          detectedLateMinutes: payload.detectedLateMinutes,
          adjustedLateMinutes: payload.adjustedLateMinutes,
          detectedEarlyLeaveMinutes: payload.detectedEarlyLeaveMinutes,
          adjustedEarlyLeaveMinutes: payload.adjustedEarlyLeaveMinutes,
          additionalResolved,
          lateResolved,
          note: payload.note,
          decidedBy: actor,
        },
        $setOnInsert: {
          employee: payload.employeeId,
          dateKey: payload.dateKey,
        },
      },
      { upsert: true },
    );
    const savedDecision = await AttendanceDayDecision.findOne({
      employee: payload.employeeId,
      dateKey: payload.dateKey,
    }).lean();

    await createAuditLog({
      actor,
      action: "attendanceDayDecision.upsert",
      entityType: "attendanceDayDecision",
      entityId: savedDecision?._id?.toString?.() || "",
      entityLabel: `${employee.fullName || payload.employeeId} ${payload.dateKey}`,
      route: "/api/planner/attendance/day-decisions",
      details: {
        employeeId: payload.employeeId,
        employeeName: employee.fullName || "",
        dateKey: payload.dateKey,
        before: previousDecision ? {
          decision: previousDecision.decision,
          authorizedSupplementaryMinutes: previousDecision.authorizedSupplementaryMinutes,
          authorizedExtraordinaryMinutes: previousDecision.authorizedExtraordinaryMinutes,
          detectedSupplementaryMinutes: previousDecision.detectedSupplementaryMinutes,
          detectedExtraordinaryMinutes: previousDecision.detectedExtraordinaryMinutes,
          detectedLateMinutes: previousDecision.detectedLateMinutes || 0,
          adjustedLateMinutes: previousDecision.adjustedLateMinutes || 0,
          detectedEarlyLeaveMinutes: previousDecision.detectedEarlyLeaveMinutes || 0,
          adjustedEarlyLeaveMinutes: previousDecision.adjustedEarlyLeaveMinutes || 0,
          additionalResolved: Boolean(previousDecision.additionalResolved),
          lateResolved: Boolean(previousDecision.lateResolved),
          note: previousDecision.note || "",
          decidedBy: previousDecision.decidedBy || "",
          updatedAt: previousDecision.updatedAt || null,
        } : null,
        after: {
          decision: payload.decision,
          authorizedSupplementaryMinutes: payload.authorizedSupplementaryMinutes,
          authorizedExtraordinaryMinutes: payload.authorizedExtraordinaryMinutes,
          detectedSupplementaryMinutes: payload.detectedSupplementaryMinutes,
          detectedExtraordinaryMinutes: payload.detectedExtraordinaryMinutes,
          detectedLateMinutes: payload.detectedLateMinutes,
          adjustedLateMinutes: payload.adjustedLateMinutes,
          detectedEarlyLeaveMinutes: payload.detectedEarlyLeaveMinutes,
          adjustedEarlyLeaveMinutes: payload.adjustedEarlyLeaveMinutes,
          additionalResolved,
          lateResolved,
          note: payload.note,
          decidedBy: actor,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: "Decisión guardada correctamente.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo guardar la decisión del día." },
      { status: 400 },
    );
  }
}

export async function DELETE(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const scope = String(body?.scope || "").trim();

    if (scope === "month") {
      const monthKey = parseMonthKey(body?.month);

      await connectToDatabase();

      const employees = await Employee.find(employeeFilterFromBody(body)).select("_id fullName").lean();
      const employeeIds = employees.map((employee) => employee._id);
      const employeeNameById = new Map(employees.map((employee) => [employee._id.toString(), employee.fullName || ""]));
      const previousDecisions = employeeIds.length
        ? await AttendanceDayDecision.find({
            employee: { $in: employeeIds },
            dateKey: { $regex: `^${monthKey}` },
          }).lean()
        : [];
      const actor = user.employeeName || user.username || user.id;

      if (previousDecisions.length) {
        await AttendanceDayDecision.deleteMany({
          _id: { $in: previousDecisions.map((decision) => decision._id) },
        });
      }

      await createAuditLog({
        actor,
        action: "attendanceDayDecision.bulkDelete",
        entityType: "attendanceDayDecision",
        entityId: `${monthKey}:${previousDecisions.length}`,
        entityLabel: `Reinicio decisiones ${monthKey}`,
        route: "/api/planner/attendance/day-decisions",
        details: {
          monthKey,
          filters: {
            employeeId: String(body?.employeeId || "").trim(),
            branchCode: String(body?.branchCode || "").trim().toUpperCase(),
            areaCode: String(body?.areaCode || "").trim().toUpperCase(),
            roleCode: String(body?.roleCode || "").trim().toUpperCase(),
          },
          deletedCount: previousDecisions.length,
          deletedDecisions: previousDecisions.slice(0, 200).map((decision) => ({
            id: decision._id?.toString?.() || "",
            employeeId: decision.employee?.toString?.() || "",
            employeeName: employeeNameById.get(decision.employee?.toString?.() || "") || "",
            dateKey: decision.dateKey,
            decision: decision.decision,
          })),
        },
      });

      return NextResponse.json({
        success: true,
        deletedCount: previousDecisions.length,
        message: previousDecisions.length
          ? "Decisiones reiniciadas correctamente."
          : "No había decisiones guardadas para reiniciar.",
      });
    }

    const employeeId = String(body?.employeeId || "").trim();
    const dateKey = parseDateKey(body?.dateKey);

    if (!employeeId) {
      throw new Error("Debes indicar el empleado.");
    }

    await connectToDatabase();

    const employee = await Employee.findById(employeeId).select("_id fullName").lean();

    if (!employee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    const previousDecision = await AttendanceDayDecision.findOne({ employee: employeeId, dateKey }).lean();
    const actor = user.employeeName || user.username || user.id;

    if (!previousDecision) {
      return NextResponse.json({ error: "No existe una decisión vigente para quitar." }, { status: 404 });
    }

    const laterException = await findLaterExceptionForDay({
      employeeId,
      dateKey,
      happenedAt: previousDecision.updatedAt || previousDecision.createdAt,
    });

    if (laterException) {
      return NextResponse.json({
        error: "Esta decisión tiene una resolución posterior. Debes desactivar primero la decisión más reciente del día.",
      }, { status: 409 });
    }

    const result = await removeCurrentAttendanceDecisionRevision({
      decision: previousDecision,
      employeeId,
      employeeName: employee.fullName || "",
      dateKey,
      actor,
    });

    return NextResponse.json({
      success: true,
      restoredPreviousRevision: result.restoredPreviousRevision,
      message: result.restoredPreviousRevision
        ? "Decisión quitada y resolución anterior restaurada correctamente."
        : "Revisión quitada correctamente.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo quitar la decisión del día." },
      { status: 400 },
    );
  }
}
