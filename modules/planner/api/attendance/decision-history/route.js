import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import AuditLog from "@/models/AuditLog";
import { Employee } from "@/modules/company/models";
import {
  assertEmployeesInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import { serializeOperationalException } from "@/modules/planner/lib/planning/exceptions";
import { AttendanceDayDecision, OperationalException } from "@/modules/planner/models";

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
  if ((Number(decision.manualSupplementaryMinutes) || 0) > 0) {
    parts.push(`HS manuales: ${minutesLabel(decision.manualSupplementaryMinutes)}`);
  }
  if ((Number(decision.manualExtraordinaryMinutes) || 0) > 0) {
    parts.push(`HE manuales: ${minutesLabel(decision.manualExtraordinaryMinutes)}`);
  }
  if ((Number(decision.detectedLateMinutes) || 0) > 0) {
    parts.push(`Atraso resultante: ${minutesLabel(decision.adjustedLateMinutes)}`);
  }
  if ((Number(decision.detectedEarlyLeaveMinutes) || 0) > 0) {
    parts.push(`Salida resultante: ${minutesLabel(decision.adjustedEarlyLeaveMinutes)}`);
  }

  return parts.join(" · ") || DECISION_LABELS[decision.decision] || "Decisión registrada";
}

function exceptionSummary(exception = {}) {
  if (exception.isExtraDay) {
    const lunch = exception.plannedLunchStartTime && exception.plannedLunchEndTime
      ? ` · Almuerzo ${exception.plannedLunchStartTime}–${exception.plannedLunchEndTime}`
      : "";

    return `Día extra ${exception.plannedStartTime}–${exception.plannedEndTime}${lunch}`;
  }

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
}) {
  return {
    id,
    kind: "attendance_decision",
    sourceId: id,
    title: DECISION_LABELS[snapshot?.decision] || "Decisión del día",
    summary: attendanceDecisionSummary(snapshot),
    note: snapshot?.manualAdditionalReason || snapshot?.note || "",
    actor: actor || snapshot?.decidedBy || "SISTEMA",
    happenedAt,
    status,
    statusLabel,
    canDelete,
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
      Employee.exists({ _id: employeeId }),
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
      })
        .select({ actor: 1, action: 1, entityType: 1, entityId: 1, happenedAt: 1, "details.before": 1, "details.after": 1 })
        .sort({ happenedAt: -1 })
        .lean(),
    ]);

    if (!employee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    const history = [];
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

        const isDeleted = ["attendanceDayDecision.delete", "attendanceDayDecision.deactivate"].includes(log.action);
        const snapshot = isDeleted ? log.details?.before : log.details?.after;

        if (!snapshot) return;

        history.push(attendanceHistoryItem({
          id: `audit-${log._id}`,
          snapshot,
          actor: log.actor,
          happenedAt: log.happenedAt,
          status: isDeleted ? "deleted" : "replaced",
          statusLabel: isDeleted ? "Desactivada" : "Reemplazada",
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
          statusLabel: isDeleted ? "Anulada" : "Vigente",
          canDelete: !isDeleted,
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
        });
      });

    const activeHistory = history
      .filter((item) => item.status === "active")
      .sort((left, right) => new Date(right.happenedAt || 0) - new Date(left.happenedAt || 0));
    const latestActiveId = activeHistory[0]?.id || "";

    history.forEach((item) => {
      if (item.status === "active" && item.id !== latestActiveId) {
        item.canDelete = false;
        item.dependencyMessage = `Primero debes desactivar “${activeHistory[0]?.title || "la resolución posterior"}”.`;
      }

      if (item.status === "replaced" && activeHistory.length) {
        item.dependencyMessage = "Este antecedente es inmutable y se conserva para auditoría.";
      }
    });

    history.sort((left, right) => new Date(right.happenedAt || 0) - new Date(left.happenedAt || 0));

    return NextResponse.json(
      { history, canPurgeHistory: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo cargar el historial de decisiones." },
      { status: 400 },
    );
  }
}
