import Link from "next/link";
import { Activity, CalendarCheck2, CheckCircle2, Clock3, FileClock, UserRound } from "lucide-react";

import ModuleShell from "@/components/shell/ModuleShell";
import connectToDatabase from "@/lib/db/mongodb";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import AuditLog from "@/models/AuditLog";
import HistoryFilters from "@/modules/planner/pages/dashboard/history/HistoryFilters";
import styles from "@/modules/planner/styles/pages/dashboard/history/page.module.scss";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Historial operativo | Control de Asistencia",
};

const FLOW_OPTIONS = [
  { value: "", label: "Todo" },
  { value: "planning", label: "Planificación" },
  { value: "attendance", label: "Asistencia" },
  { value: "exceptions", label: "Novedades" },
  { value: "closure", label: "Control operativo" },
  { value: "payroll", label: "Nómina" },
  { value: "company", label: "Configuración" },
];

const ACTION_LABELS = {
  "attendanceMonthlyClosure.create": "Cruce de horas guardado",
  "attendanceDayDecision.create": "Decisión de asistencia creada",
  "attendanceDayDecision.update": "Decisión de asistencia actualizada",
  "attendanceDayDecision.upsert": "Decisión de asistencia guardada",
  "attendanceDayDecision.delete": "Decisión de asistencia anulada",
  "attendanceDayDecision.bulkReviewLate": "Atrasos revisados",
  "attendancePunch.create": "Picada creada",
  "attendancePunch.ignore": "Picada anulada",
  "attendancePunch.delete": "Picada anulada",
  "payrollPayment.create": "Pago registrado",
  "exception.applyPunches": "Excepción aplicada a picadas",
  "employee.role.assignAmbatoSpecializedSeller": "Cobertura del empleado actualizada",
  "employee.role.assignSellerCoverage": "Cobertura del empleado actualizada",
  "employee.roleAssignments.enableSellerCoverage": "Coberturas del empleado habilitadas",
  "employee.roles.migrateVendorSubroles": "Cargo del empleado migrado",
  "employee.roleLabel.sync": "Etiqueta de cargo sincronizada",
  "organization_structure.relationship_update": "Relación del organigrama actualizada",
  "area.create": "Área creada",
  "area.update": "Área actualizada",
  "area.delete": "Área eliminada",
  "branch.create": "Sucursal creada",
  "branch.update": "Sucursal actualizada",
  "branch.delete": "Sucursal eliminada",
  "role.create": "Cargo creado",
  "role.update": "Cargo actualizado",
  "role.delete": "Cargo eliminado",
  "role.delete.promoteToVendorSubrole": "Cargo convertido a subrol",
  "role.label.update": "Etiqueta de cargo actualizada",
  "role.subroles.configure": "Subroles configurados",
};

const ENTITY_LABELS = {
  area: "Área",
  attendanceDayDecision: "Día revisado",
  attendancePunch: "Picada",
  branch: "Sucursal",
  employee: "Empleado",
  monthlyAttendanceClosure: "Cruce mensual",
  organization_node: "Organigrama",
  role: "Cargo",
};

const FIELD_LABELS = {
  areaName: "Área",
  authorizedExtraordinaryMinutes: "HE aprobadas",
  authorizedSupplementaryMinutes: "HS aprobadas",
  branchCodes: "Sucursales",
  branchNames: "Sucursales",
  city: "Ciudad",
  code: "Código",
  decision: "Decisión",
  description: "Descripción",
  detectedExtraordinaryMinutes: "HE detectadas",
  detectedSupplementaryMinutes: "HS detectadas",
  employeeName: "Empleado",
  endTime: "Salida",
  fixedScheduleTemplateName: "Horario fijo",
  hasLunch: "Almuerzo",
  isActive: "Estado",
  level: "Nivel",
  lunchEndTime: "Fin almuerzo",
  lunchStartTime: "Inicio almuerzo",
  name: "Nombre",
  note: "Nota",
  parentTitle: "Depende de",
  punchedAt: "Hora de picada",
  reason: "Motivo",
  roleAssignments: "Coberturas",
  roleName: "Cargo",
  scheduleMode: "Tipo de horario",
  source: "Origen",
  startTime: "Entrada",
  subtitle: "Subtítulo",
  supervisorRoleName: "Supervisor",
  title: "Nombre",
};

const IGNORED_DIFF_FIELDS = new Set([
  "_id",
  "id",
  "__v",
  "createdAt",
  "updatedAt",
  "positionX",
  "positionY",
  "width",
  "height",
  "sortOrder",
]);

const DECISION_LABELS = {
  none: "Sin decisión",
  planned: "Tomar planificado",
  custom: "Aprobación parcial",
  ignored: "Anulado",
  full: "Aprobar tiempo registrado",
  reviewed: "Revisado",
  resolve_late: "Atraso revisado",
  justify_late: "Atraso justificado",
  justify_early_leave: "Salida justificada",
  pay_planned_day: "Tomar planificación",
  complete_regular_day: "Completar jornada laboral",
  justify_no_punches: "Sin picadas justificadas",
  justify_incomplete_punches: "Picadas incompletas justificadas",
  discount_day: "Día anulado",
  approved_work_time: "Tiempo trabajado aprobado",
  discount_hours: "Horas descontadas",
};

function monthRange(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);

  if (!year || !month) return {};

  return {
    from: new Date(year, month - 1, 1),
    to: new Date(year, month, 1),
  };
}

function flowForLog(log = {}) {
  const action = String(log.action || "");
  const entityType = String(log.entityType || "");
  const route = String(log.route || "");

  if (action.includes("MonthlyClosure") || entityType.includes("monthlyAttendanceClosure")) return "closure";
  if (action.includes("payroll") || route.includes("/payroll")) return "payroll";
  if (action.includes("exception") || entityType.includes("exception") || route.includes("/exceptions")) return "exceptions";
  if (action.includes("attendance") || entityType.includes("attendance") || route.includes("/attendance")) return "attendance";
  if (action.includes("schedule") || entityType.includes("schedule") || route.includes("/schedule")) return "planning";
  return "company";
}

function flowLabel(value) {
  return FLOW_OPTIONS.find((option) => option.value === value)?.label || "Configuración";
}

function actionLabel(action) {
  return ACTION_LABELS[action] || String(action || "Acción registrada");
}

function entityTypeLabel(entityType) {
  return ENTITY_LABELS[entityType] || "Registro";
}

function formatDateTime(value) {
  if (!value) return "Sin fecha";

  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDateOnly(value) {
  if (!value) return "";

  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium",
  }).format(new Date(`${value}T12:00:00-05:00`));
}

function formatMinutes(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;

  if (!total) return "0m";
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function normalizeValue(value) {
  if (value === undefined || value === null || value === "") return "Sin dato";
  if (typeof value === "boolean") return value ? "Activo" : "Inactivo";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(normalizeArrayItem).filter(Boolean).join(", ") || "Sin registros";
  if (isPlainObject(value)) return normalizeObjectValue(value);
  return String(value);
}

function normalizeArrayItem(value) {
  if (!isPlainObject(value)) return normalizeValue(value);
  return value.name || value.title || value.roleName || value.areaName || value.code || "";
}

function normalizeObjectValue(value) {
  return value.name || value.title || value.roleName || value.areaName || value.employeeName || value.code || JSON.stringify(value);
}

function valuesAreEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function fieldLabel(key) {
  return FIELD_LABELS[key] || key;
}

function buildChangedLines(before = {}, after = {}) {
  if (!isPlainObject(before) || !isPlainObject(after)) return [];

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !IGNORED_DIFF_FIELDS.has(key))
    .filter((key) => !valuesAreEqual(before[key], after[key]));

  return keys.slice(0, 5).map((key) => ({
    label: fieldLabel(key),
    before: normalizeValue(before[key]),
    after: normalizeValue(after[key]),
  }));
}

function mainEntity(details = {}, fallback = "") {
  return details.employeeName || details.after?.employeeName || details.before?.employeeName || details.deleted?.name || details.after?.name || details.before?.name || fallback;
}

function buildAttendanceDecisionDetails(log) {
  const details = log.details || {};
  const lines = [];
  const before = details.before || {};
  const hasAfter = Boolean(details.after);
  const after = details.after || {};

  if (details.dateKey) {
    lines.push({ label: "Día", value: formatDateOnly(details.dateKey) });
  }

  if (before.decision !== after.decision) {
    lines.push({
      label: "Decisión",
      before: DECISION_LABELS[before.decision] || before.decision || "Sin decisión",
      after: hasAfter ? DECISION_LABELS[after.decision] || after.decision || "Sin decisión" : "Anulada",
    });
  }

  if (!valuesAreEqual(before.authorizedSupplementaryMinutes, after?.authorizedSupplementaryMinutes)) {
    lines.push({
      label: "HS aprobadas",
      before: formatMinutes(before.authorizedSupplementaryMinutes),
      after: hasAfter ? formatMinutes(after.authorizedSupplementaryMinutes) : "0m",
    });
  }

  if (!valuesAreEqual(before.authorizedExtraordinaryMinutes, after?.authorizedExtraordinaryMinutes)) {
    lines.push({
      label: "HE aprobadas",
      before: formatMinutes(before.authorizedExtraordinaryMinutes),
      after: hasAfter ? formatMinutes(after.authorizedExtraordinaryMinutes) : "0m",
    });
  }

  if (after?.note || before.note) {
    lines.push({ label: "Nota", value: after?.note || before.note });
  }

  return lines.slice(0, 5);
}

function buildClosureDetails(details = {}) {
  return [
    details.version ? { label: "Versión", value: `V${details.version}` } : null,
    details.employees ? { label: "Empleados", value: details.employees } : null,
    { label: "Laborales", value: formatMinutes(details.regularWorkedMinutes) },
    { label: "HS", value: formatMinutes(details.supplementaryMinutes) },
    { label: "HE", value: formatMinutes(details.extraordinaryMinutes) },
    { label: "Atrasos", value: formatMinutes(details.lateMinutes) },
  ].filter(Boolean);
}

function buildPunchDetails(details = {}) {
  const punch = details.after || details.before || {};

  return [
    punch.punchedAt ? { label: "Picada", value: formatDateTime(punch.punchedAt) } : null,
    punch.source ? { label: "Origen", value: punch.source === "manual" ? "Manual" : "Carga biométrica" } : null,
    details.reason ? { label: "Motivo", value: details.reason } : null,
  ].filter(Boolean);
}

function detailLines(log = {}) {
  const details = log.details || {};

  if (log.entityType === "attendanceDayDecision") return buildAttendanceDecisionDetails(log);
  if (log.entityType === "monthlyAttendanceClosure") return buildClosureDetails(details);
  if (log.entityType === "attendancePunch") return buildPunchDetails(details);

  if (details.reason) {
    const lines = [{ label: "Motivo", value: details.reason }];
    return lines.concat(buildChangedLines(details.before, details.after)).slice(0, 5);
  }

  if (details.before && details.after) {
    if (Array.isArray(details.before) || Array.isArray(details.after)) {
      return [{
        label: "Registros",
        before: `${details.before?.length || 0}`,
        after: `${details.after?.length || 0}`,
      }];
    }

    return buildChangedLines(details.before, details.after);
  }

  if (details.after) {
    return [
      { label: "Creado", value: normalizeObjectValue(details.after) },
      details.after.areaName ? { label: "Área", value: details.after.areaName } : null,
      details.after.roleName ? { label: "Cargo", value: details.after.roleName } : null,
    ].filter(Boolean);
  }

  if (details.deleted) {
    return [
      { label: "Eliminado", value: normalizeObjectValue(details.deleted) },
      details.reason ? { label: "Motivo", value: details.reason } : null,
    ].filter(Boolean);
  }

  const entries = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 4);

  if (!entries.length) return [];

  return entries.map(([key, value]) => ({ label: fieldLabel(key), value: normalizeValue(value) }));
}

function timelineText(log = {}) {
  const details = log.details || {};
  const entity = mainEntity(details, log.entityLabel || log.entityType);
  const date = details.dateKey ? ` · ${formatDateOnly(details.dateKey)}` : "";

  return `${entity || "Registro operativo"}${date}`;
}

async function loadHistory({ month, actor, flow }) {
  await connectToDatabase();

  const query = {};
  const range = monthRange(month);

  if (range.from && range.to) {
    query.happenedAt = { $gte: range.from, $lt: range.to };
  }

  if (actor) {
    query.actor = actor;
  }

  const rawLogs = await AuditLog.find(query)
    .sort({ happenedAt: -1 })
    .limit(160)
    .lean();

  const allLogs = rawLogs.map((log) => ({
    id: log._id.toString(),
    actor: log.actor || "admin",
    action: log.action || "",
    actionLabel: actionLabel(log.action),
    entityLabel: log.entityLabel || "",
    entityTypeLabel: entityTypeLabel(log.entityType),
    entityType: log.entityType || "",
    route: log.route || "",
    details: log.details || {},
    detailLines: detailLines(log),
    timelineText: timelineText(log),
    happenedAt: log.happenedAt,
    flow: flowForLog(log),
  }));
  const logs = allLogs.filter((log) => !flow || log.flow === flow);

  const actors = await AuditLog.distinct("actor", range.from && range.to ? { happenedAt: { $gte: range.from, $lt: range.to } } : {});
  const flowCounts = FLOW_OPTIONS
    .map((option) => ({
      ...option,
      count: option.value ? allLogs.filter((log) => log.flow === option.value).length : allLogs.length,
    }));

  return {
    actors: actors.filter(Boolean).sort((left, right) => left.localeCompare(right, "es")),
    flowCounts,
    logs,
  };
}

function historyHref({ month, actor, flow }) {
  const params = new URLSearchParams();

  if (month) params.set("month", month);
  if (actor) params.set("actor", actor);
  if (flow) params.set("flow", flow);

  const query = params.toString();
  return query ? `/modules/planning/history?${query}` : "/modules/planning/history";
}

export default async function OperationalHistoryPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const month = resolvedSearchParams?.month || formatEcuadorMonthKey();
  const actor = resolvedSearchParams?.actor || "";
  const flow = resolvedSearchParams?.flow || "";
  const history = await loadHistory({ month, actor, flow });

  return (
    <ModuleShell
      title="Historial operativo"
      description="Rastreo de acciones para confirmar que el flujo operativo se cumplió."
    >
      <section className={styles.panel}>
        <HistoryFilters month={month} actor={actor} flow={flow} actors={history.actors} />

        <div className={styles.flowGrid}>
          {history.flowCounts.map((item) => (
            <Link
              key={item.value || "all"}
              href={historyHref({ month, actor, flow: item.value })}
              className={`${styles.flowCard} ${flow === item.value ? styles.flowCardActive : ""}`}
            >
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </Link>
          ))}
        </div>

        <section className={styles.timelineSection}>
          <div className={styles.sectionHeader}>
            <div>
              <span>Secuencia operativa</span>
              <strong>{history.logs.length} movimiento{history.logs.length === 1 ? "" : "s"}</strong>
            </div>
            <small><Clock3 size={14} /> Más reciente primero</small>
          </div>

          {history.logs.length ? (
            <div className={styles.timeline}>
              {history.logs.map((log) => (
                <article key={log.id} className={styles.timelineItem}>
                  <div className={styles.iconCell}>
                    {log.flow === "closure" ? <CalendarCheck2 size={18} /> : log.flow === "payroll" ? <CheckCircle2 size={18} /> : <Activity size={18} />}
                  </div>
                  <div className={styles.timelineBody}>
                    <div className={styles.timelineTop}>
                      <span className={styles.flowBadge}>{flowLabel(log.flow)}</span>
                      <span className={styles.entityBadge}>{log.entityTypeLabel}</span>
                      <time>{formatDateTime(log.happenedAt)}</time>
                    </div>
                    <strong>{log.actionLabel}</strong>
                    <p>{log.timelineText}</p>
                    {log.detailLines.length ? (
                      <div className={styles.detailList}>
                        {log.detailLines.map((line, index) => (
                          <div key={`${log.id}-${line.label}-${index}`} className={styles.detailRow}>
                            <span>{line.label}</span>
                            {"before" in line || "after" in line ? (
                              <strong>
                                <em>{line.before}</em>
                                <b>{"->"}</b>
                                <em>{line.after}</em>
                              </strong>
                            ) : (
                              <strong>{line.value}</strong>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.actorCell}>
                    <UserRound size={15} />
                    <span>{log.actor}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <FileClock size={24} />
              No hay acciones auditadas para los filtros seleccionados.
            </div>
          )}
        </section>
      </section>
    </ModuleShell>
  );
}
