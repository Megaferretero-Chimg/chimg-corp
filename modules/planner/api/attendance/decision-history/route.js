import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import AuditLog from "@/models/AuditLog";
import { Employee } from "@/modules/company/models";
import { isAdminAccessUser } from "@/modules/company/submodules/access/lib/permissions";
import {
  assertEmployeesInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import { serializeOperationalException } from "@/modules/planner/lib/planning/exceptions";
import { deleteExceptionManualPunch } from "@/modules/planner/lib/planning/exceptionPunches";
import { AttendanceDayDecision, OperationalException } from "@/modules/planner/models";
import {
  findLaterAttendanceDecisionForException,
  findLaterExceptionForDay,
  findLaterExceptionForException,
} from "@/modules/planner/lib/attendance/decisionDependencies";
import { removeCurrentAttendanceDecisionRevision } from "@/modules/planner/lib/attendance/dayDecisionRevisions";

const DECISION_LABELS = {
  full: "Tiempo registrado aprobado",
  planned: "Tiempo ajustado a la planificación",
  none: "Tiempo adicional no aprobado",
  custom: "Tiempo adicional aprobado",
  discount_day: "Día anulado",
  pay_planned_day: "Día planificado pagado",
  complete_regular_day: "Jornada regular completada",
  reviewed: "Día revisado",
  justify_early_leave: "Salida anticipada justificada",
  justify_no_punches: "Ausencia de picadas justificada",
  justify_incomplete_punches: "Picadas incompletas justificadas",
  justify_late: "Atraso justificado",
  resolve_late: "Atraso revisado",
};

function parseDateKey(value) {
  const dateKey = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error("La fecha no es válida.");
  }

  return dateKey;
}

function minutesLabel(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (!minutes) return "0m";
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function attendanceDecisionSummary(decision = {}) {
  const supplementary = Number(decision.authorizedSupplementaryMinutes) || 0;
  const extraordinary = Number(decision.authorizedExtraordinaryMinutes) || 0;
  const parts = [];

  if (supplementary) parts.push(`HS aprobadas: ${minutesLabel(supplementary)}`);
  if (extraordinary) parts.push(`HE aprobadas: ${minutesLabel(extraordinary)}`);
  if ((Number(decision.detectedLateMinutes) || 0) > 0) {
    parts.push(`Atraso resultante: ${minutesLabel(decision.adjustedLateMinutes)}`);
  }
  if ((Number(decision.detectedEarlyLeaveMinutes) || 0) > 0) {
    parts.push(`Salida resultante: ${minutesLabel(decision.adjustedEarlyLeaveMinutes)}`);
  }

  return parts.join(" · ") || DECISION_LABELS[decision.decision] || "Decisión registrada";
}

function exceptionSummary(exception = {}) {
  if (exception.type === "missing_punch") {
    return exception.allowSupplementaryTime
      ? "Jornada calculada con la primera y última picada"
      : "Jornada reconocida sin crear picadas ficticias";
  }

  if (exception.type === "schedule_change" && exception.plannedDayType === "off_day") {
    return "Planificación cambiada a descanso";
  }

  if (exception.type === "schedule_change" && exception.plannedStartTime && exception.plannedEndTime) {
    const lunch = exception.plannedLunchStartTime && exception.plannedLunchEndTime
      ? ` · Almuerzo ${exception.plannedLunchStartTime}–${exception.plannedLunchEndTime}`
      : "";
    return `Horario ${exception.plannedStartTime}–${exception.plannedEndTime}${lunch}`;
  }

  if (exception.startTime && exception.endTime) {
    return `Horario ${exception.startTime}–${exception.endTime}`;
  }

  return exception.effectLabel || exception.resolutionLabel || "Excepción operativa";
}

function exceptionAppliesToDate(exception, dateKey) {
  if (!exception.endDateKey) return exception.dateKey === dateKey;
  if (exception.dateKey > dateKey || exception.endDateKey < dateKey) return false;

  if (Array.isArray(exception.applicableWeekdays) && exception.applicableWeekdays.length) {
    const weekday = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
    return exception.applicableWeekdays.includes(weekday);
  }

  return true;
}

function attendanceHistoryItem({
  id,
  snapshot,
  actor,
  happenedAt,
  status,
  statusLabel,
  canDelete = false,
  purgeTarget = null,
}) {
  return {
    id,
    kind: "attendance_decision",
    sourceId: id,
    title: DECISION_LABELS[snapshot?.decision] || "Decisión del día",
    summary: attendanceDecisionSummary(snapshot),
    note: snapshot?.note || "",
    actor: actor || snapshot?.decidedBy || "SISTEMA",
    happenedAt,
    status,
    statusLabel,
    canDelete,
    canPurge: Boolean(purgeTarget),
    purgeTarget,
  };
}

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser();

    if (!user) {
      return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = String(searchParams.get("employeeId") || "").trim();
    const dateKey = parseDateKey(searchParams.get("dateKey"));

    if (!employeeId) {
      throw new Error("Debes indicar el empleado.");
    }

    await connectToDatabase();
    const plannerScope = await resolvePlannerEmployeeScope();

    if (!plannerScope.isAuthenticated) {
      return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
    }

    assertEmployeesInPlannerScope([employeeId], plannerScope);

    const [employee, currentDecision, exceptionDocs, auditLogs] = await Promise.all([
      Employee.findById(employeeId).select("_id fullName").lean(),
      AttendanceDayDecision.findOne({ employee: employeeId, dateKey }).lean(),
      OperationalException.find({
        employee: employeeId,
        planningSource: "attendance_comparison",
        $or: [
          { dateKey },
          {
            dateKey: { $lte: dateKey },
            endDateKey: { $gte: dateKey },
          },
        ],
      }).sort({ updatedAt: -1 }).lean(),
      AuditLog.find({
        $or: [
          {
            entityType: "attendanceDayDecision",
            "details.employeeId": employeeId,
            "details.dateKey": dateKey,
          },
          {
            entityType: "operationalException",
            "details.employeeId": employeeId,
            "details.dateKey": dateKey,
          },
        ],
      }).sort({ happenedAt: -1 }).lean(),
    ]);

    if (!employee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    const history = [];
    const isAdmin = isAdminAccessUser(user);
    const currentDecisionId = currentDecision?._id?.toString?.() || "";
    let skippedCurrentAudit = false;

    if (currentDecision) {
      history.push(attendanceHistoryItem({
        id: currentDecisionId,
        snapshot: currentDecision,
        actor: currentDecision.decidedBy,
        happenedAt: currentDecision.updatedAt || currentDecision.createdAt,
        status: "active",
        statusLabel: "Vigente",
        canDelete: true,
        purgeTarget: isAdmin ? { type: "attendance_record", id: currentDecisionId } : null,
      }));
    }

    auditLogs
      .filter((log) => log.entityType === "attendanceDayDecision")
      .forEach((log) => {
        if (
          !skippedCurrentAudit &&
          currentDecisionId &&
          log.action === "attendanceDayDecision.upsert" &&
          log.entityId === currentDecisionId
        ) {
          skippedCurrentAudit = true;
          return;
        }

        const isDeleted = log.action === "attendanceDayDecision.delete";
        const snapshot = isDeleted ? log.details?.before : log.details?.after;

        if (!snapshot) return;

        history.push(attendanceHistoryItem({
          id: `audit-${log._id}`,
          snapshot,
          actor: log.actor,
          happenedAt: log.happenedAt,
          status: isDeleted ? "deleted" : "replaced",
          statusLabel: isDeleted ? "Eliminada" : "Reemplazada",
          purgeTarget: isAdmin ? { type: "audit_log", id: log._id.toString() } : null,
        }));
      });

    exceptionDocs
      .filter((exception) => exceptionAppliesToDate(exception, dateKey))
      .forEach((exception) => {
        const serialized = serializeOperationalException(exception);
        const isDeleted = serialized.status === "void";

        history.push({
          id: `exception-${serialized.id}`,
          kind: "operational_exception",
          sourceId: serialized.id,
          title: serialized.typeLabel || "Excepción operativa",
          summary: exceptionSummary(serialized),
          note: serialized.notes || serialized.resolutionNotes || "",
          actor: serialized.authorizedBy || serialized.registeredBy || "SISTEMA",
          happenedAt: serialized.updatedAt || serialized.createdAt,
          status: isDeleted ? "deleted" : "active",
          statusLabel: isDeleted ? "Eliminada" : "Vigente",
          canDelete: !isDeleted,
          canPurge: isAdmin,
          purgeTarget: isAdmin ? { type: "operational_exception", id: serialized.id } : null,
        });
      });

    auditLogs
      .filter((log) => log.action === "operationalException.update" && log.details?.before)
      .forEach((log) => {
        const snapshot = log.details.before;
        history.push({
          id: `audit-${log._id}`,
          kind: "operational_exception",
          sourceId: log.entityId,
          title: snapshot.typeLabel || "Excepción operativa",
          summary: exceptionSummary(snapshot),
          note: snapshot.notes || snapshot.resolutionNotes || "",
          actor: log.actor || snapshot.authorizedBy || snapshot.registeredBy || "SISTEMA",
          happenedAt: log.happenedAt,
          status: "replaced",
          statusLabel: "Reemplazada",
          canDelete: false,
          canPurge: isAdmin,
          purgeTarget: isAdmin ? { type: "audit_log", id: log._id.toString() } : null,
        });
      });

    const activeHistory = history
      .filter((item) => item.status === "active")
      .sort((left, right) => new Date(right.happenedAt || 0) - new Date(left.happenedAt || 0));
    const latestActiveId = activeHistory[0]?.id || "";

    history.forEach((item) => {
      if (item.status === "active" && item.id !== latestActiveId) {
        item.canDelete = false;
        item.canPurge = false;
        item.purgeTarget = null;
        item.dependencyMessage = `Primero debes desactivar “${activeHistory[0]?.title || "la resolución posterior"}”.`;
      }

      if (item.status === "replaced" && activeHistory.length) {
        item.canPurge = false;
        item.purgeTarget = null;
        item.dependencyMessage = "Este antecedente sostiene una resolución vigente y no se puede eliminar todavía.";
      }
    });

    history.sort((left, right) => new Date(right.happenedAt || 0) - new Date(left.happenedAt || 0));

    return NextResponse.json(
      { history, canPurgeHistory: isAdmin },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo cargar el historial de decisiones." },
      { status: 400 },
    );
  }
}

export async function DELETE(request) {
  try {
    const user = await getAuthenticatedUser();

    if (!user) {
      return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
    }

    if (!isAdminAccessUser(user)) {
      return NextResponse.json(
        { error: "Solo un administrador puede eliminar decisiones definitivamente." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const employeeId = String(body?.employeeId || "").trim();
    const dateKey = parseDateKey(body?.dateKey);
    const targetType = String(body?.targetType || "").trim();
    const targetId = String(body?.targetId || "").trim();

    if (!employeeId || !targetId) {
      throw new Error("La decisión que deseas eliminar no es válida.");
    }

    await connectToDatabase();
    const plannerScope = await resolvePlannerEmployeeScope();

    if (!plannerScope.isAuthenticated) {
      return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
    }

    assertEmployeesInPlannerScope([employeeId], plannerScope);

    if (targetType === "audit_log") {
      const auditLog = await AuditLog.findOne({
        _id: targetId,
        entityType: { $in: ["attendanceDayDecision", "operationalException"] },
        "details.employeeId": employeeId,
        "details.dateKey": dateKey,
      }).lean();

      if (!auditLog) {
        return NextResponse.json({ error: "Antecedente no encontrado." }, { status: 404 });
      }

      if (["attendanceDayDecision.upsert", "operationalException.update"].includes(auditLog.action)) {
        const [activeDecision, activeExceptions] = await Promise.all([
          AttendanceDayDecision.findOne({ employee: employeeId, dateKey }).select("_id").lean(),
          OperationalException.find({
            employee: employeeId,
            planningSource: "attendance_comparison",
            status: { $ne: "void" },
            resolution: { $ne: "pending" },
            $or: [
              { dateKey },
              { dateKey: { $lte: dateKey }, endDateKey: { $gte: dateKey } },
            ],
          }).select("_id applicableWeekdays dateKey endDateKey").lean(),
        ]);
        const hasActiveException = activeExceptions.some((exception) => exceptionAppliesToDate(exception, dateKey));

        if (activeDecision || hasActiveException) {
          return NextResponse.json({
            error: "Este antecedente sostiene una resolución vigente. Desactiva primero las decisiones posteriores.",
          }, { status: 409 });
        }
      }

      await AuditLog.deleteOne({ _id: auditLog._id });
    } else if (targetType === "attendance_record") {
      const decision = await AttendanceDayDecision.findOne({
        _id: targetId,
        employee: employeeId,
        dateKey,
      }).lean();

      if (!decision) {
        return NextResponse.json({ error: "Decisión vigente no encontrada." }, { status: 404 });
      }

      const laterException = await findLaterExceptionForDay({
        employeeId,
        dateKey,
        happenedAt: decision.updatedAt || decision.createdAt,
      });

      if (laterException) {
        return NextResponse.json({
          error: "Esta decisión tiene una resolución posterior. Elimina primero la decisión más reciente del día.",
        }, { status: 409 });
      }

      await removeCurrentAttendanceDecisionRevision({
        decision,
        employeeId,
        employeeName: decision.employeeName || "",
        dateKey,
        actor: user.employeeName || user.username || user.id,
        permanent: true,
      });
    } else if (targetType === "operational_exception") {
      const exception = await OperationalException.findOne({
        _id: targetId,
        employee: employeeId,
        planningSource: "attendance_comparison",
      }).lean();

      if (!exception || !exceptionAppliesToDate(exception, dateKey)) {
        return NextResponse.json({ error: "Excepción operativa no encontrada." }, { status: 404 });
      }

      const [laterAttendanceDecision, laterException] = await Promise.all([
        findLaterAttendanceDecisionForException(exception),
        findLaterExceptionForException(exception),
      ]);

      if (laterAttendanceDecision || laterException) {
        return NextResponse.json({
          error: "Esta excepción tiene una resolución posterior. Elimina primero la decisión más reciente del día.",
        }, { status: 409 });
      }

      await deleteExceptionManualPunch(exception);
      await Promise.all([
        OperationalException.deleteOne({ _id: exception._id }),
        AuditLog.deleteMany({ entityType: "operationalException", entityId: targetId }),
      ]);
    } else {
      throw new Error("El tipo de decisión no es válido.");
    }

    return NextResponse.json({
      success: true,
      message: "Decisión eliminada definitivamente.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo eliminar la decisión definitivamente." },
      { status: 400 },
    );
  }
}
