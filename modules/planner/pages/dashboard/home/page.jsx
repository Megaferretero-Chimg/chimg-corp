import Link from "next/link";
import { connection } from "next/server";
import {
  ArrowRight,
  BadgeDollarSign,
  CalendarDays,
  CheckCircle2,
  Gauge,
  History,
  ListChecks,
  UploadCloud,
  Users,
} from "lucide-react";

import ModuleShell from "@/components/shell/ModuleShell";
import connectToDatabase from "@/lib/db/mongodb";
import { formatEcuadorDateTimeLabel, formatEcuadorMonthKey, makeEcuadorDate } from "@/lib/datetime/ecuador";
import { buildEmployeeActiveInMonthQuery } from "@/modules/company/submodules/people/lib/employees";
import { planningModulePath } from "@/modules/planner/routes";
import AuditLog from "@/models/AuditLog";
import { GET as getAttendanceComparison } from "@/modules/planner/api/attendance/comparison/route";
import { Employee } from "@/modules/company/models";
import {
  AttendanceDayDecision,
  AttendanceUpload,
  MonthlyAttendanceClosure,
  PlanningWorkGroup,
  ScheduleAssignment,
} from "@/modules/planner/models";
import styles from "@/modules/planner/styles/pages/dashboard/home/page.module.scss";

export const metadata = {
  title: "Inicio | Control de Asistencia",
};

function minutesBetween(startTime = "", endTime = "") {
  const [startHour, startMinute] = String(startTime || "").split(":").map(Number);
  const [endHour, endMinute] = String(endTime || "").split(":").map(Number);

  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) {
    return 0;
  }

  return Math.max((endHour * 60 + endMinute) - (startHour * 60 + startMinute), 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-EC").format(Number(value) || 0);
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatOptionalMoney(value) {
  if (value === null || value === undefined) return "--";

  return formatMoney(value);
}

function numberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function formatDateTime(value) {
  return formatEcuadorDateTimeLabel(value, { fallback: "Sin fecha" });
}

function formatHours(minutes) {
  const hours = (Number(minutes) || 0) / 60;

  return `${new Intl.NumberFormat("es-EC", { maximumFractionDigits: 1 }).format(hours)} h`;
}

function monthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = makeEcuadorDate(year, month - 1, 1);

  return new Intl.DateTimeFormat("es-EC", { month: "long", year: "numeric" }).format(date);
}

function readUploadPending(upload) {
  if (!upload) return "Sin cargas";
  if (!upload.normalizedAt) return "Pendiente normalizar";
  if (!upload.punchesPublishedAt) return "Pendiente publicar";

  return "Picadas publicadas";
}

function weekKeysForMonth(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return [];

  const keys = new Set();
  const date = makeEcuadorDate(year, month - 1, 1);
  const end = makeEcuadorDate(year, month, 1);

  while (date < end) {
    const monday = new Date(date);
    const day = monday.getDay() || 7;
    monday.setDate(monday.getDate() - day + 1);
    keys.add(monday.toISOString().slice(0, 10));
    date.setDate(date.getDate() + 1);
  }

  return [...keys];
}

const RECENT_ACTION_LABELS = {
  "attendanceMonthlyClosure.create": "Cruce de horas guardado",
  "attendanceDayDecision.upsert": "Decisión de asistencia guardada",
  "attendanceDayDecision.delete": "Decisión de asistencia anulada",
  "attendancePunch.ignore": "Picada anulada",
  "attendancePunch.delete": "Picada anulada",
};

const PLANNER_ACTIVITY_ACTIONS = Object.keys(RECENT_ACTION_LABELS);

function recentActionLabel(action) {
  return RECENT_ACTION_LABELS[action] || String(action || "Acción registrada");
}

async function loadComparisonSnapshot(monthKey) {
  try {
    const response = await getAttendanceComparison(
      new Request(`http://localhost/api/planner/attendance/comparison?month=${encodeURIComponent(monthKey)}`),
    );

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const additionalDays = payload.summary?.pendingAdditionalDays ?? rows.reduce(
      (total, row) => total + (Number(row.summary?.pendingAdditionalDays) || 0),
      0,
    );
    const salaryPlanned = rows.reduce((total, row) => total + (Number(row.summary?.salaryPlanned) || 0), 0);
    const salaryReal = rows.reduce((total, row) => total + (Number(row.summary?.salaryReal) || 0), 0);

    return {
      summary: payload.summary || {},
      additionalDays,
      salaryPlanned,
      salaryReal,
    };
  } catch {
    return null;
  }
}

async function loadHomeSummary() {
  await connectToDatabase();

  const monthKey = formatEcuadorMonthKey();
  const [year, month] = monthKey.split("-").map(Number);
  const monthIndex = month - 1;
  const monthStart = makeEcuadorDate(year, monthIndex, 1);
  const nextMonthStart = makeEcuadorDate(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1);
  const activeEmployeeQuery = buildEmployeeActiveInMonthQuery(monthStart);
  const weekKeys = weekKeysForMonth(monthKey);
  const comparisonSnapshotPromise = loadComparisonSnapshot(monthKey);

  const [
    employees,
    activeGroups,
    assignments,
    uploadStats,
    latestUpload,
    dayDecisionStats,
    latestClosure,
    recentLogs,
  ] = await Promise.all([
    Employee.find(activeEmployeeQuery)
      .select({ _id: 1, salary: 1 })
      .lean(),
    PlanningWorkGroup.find({ isActive: { $ne: false } })
      .select({ _id: 1, name: 1, members: 1, ownerEmployeeName: 1 })
      .lean(),
    ScheduleAssignment.find({ monthKey })
      .select({ employee: 1, generatedDays: 1, scheduleHistory: 1, planningApprovals: 1 })
      .lean(),
    AttendanceUpload.aggregate([
      { $match: { year, month } },
      {
        $group: {
          _id: null,
          uploads: { $sum: 1 },
          totalPunches: { $sum: "$totalPunches" },
          normalized: { $sum: { $cond: [{ $ne: ["$normalizedAt", null] }, 1, 0] } },
          published: { $sum: { $cond: [{ $ne: ["$punchesPublishedAt", null] }, 1, 0] } },
          unmatchedEmployees: { $sum: "$normalizedSnapshot.summary.unmatchedEmployees" },
          irregularDays: { $sum: "$normalizedSnapshot.summary.irregularDays" },
        },
      },
    ]),
    AttendanceUpload.findOne({ year, month })
      .select({
        fileName: 1,
        branchName: 1,
        totalPunches: 1,
        normalizedAt: 1,
        punchesPublishedAt: 1,
        createdAt: 1,
      })
      .sort({ createdAt: -1 })
      .lean(),
    AttendanceDayDecision.aggregate([
      { $match: { date: { $gte: monthStart, $lt: nextMonthStart } } },
      {
        $group: {
          _id: "$decision",
          count: { $sum: 1 },
          lateMinutes: { $sum: "$adjustedLateMinutes" },
          supplementaryMinutes: { $sum: "$authorizedSupplementaryMinutes" },
          extraordinaryMinutes: { $sum: "$authorizedExtraordinaryMinutes" },
        },
      },
    ]),
    MonthlyAttendanceClosure.findOne({ monthKey, isLatest: { $ne: false } })
      .select({ version: 1, completeBaseHours: 1, totals: 1, closedAt: 1, closedBy: 1 })
      .sort({ version: -1 })
      .lean(),
    AuditLog.find({ happenedAt: { $gte: monthStart, $lt: nextMonthStart } })
      .select({ action: 1, entityLabel: 1, actor: 1, happenedAt: 1 })
      .where("action").in(PLANNER_ACTIVITY_ACTIONS)
      .sort({ happenedAt: -1 })
      .limit(5)
      .lean(),
  ]);
  const comparisonSnapshot = await comparisonSnapshotPromise;

  const employeeIds = new Set(employees.map((employee) => employee._id.toString()));
  const activeAssignments = assignments.filter((assignment) =>
    employeeIds.has(assignment.employee?.toString?.() || ""),
  );
  const scheduledEmployeeIds = new Set(activeAssignments.map((assignment) => assignment.employee.toString()));
  const baseSalary = employees.reduce((total, employee) => total + (Number(employee.salary) || 0), 0);
  const groupEmployeeIds = new Set();
  const savedGroupWeeks = new Set();
  const approvedGroupWeeks = new Set();

  const planned = activeAssignments.reduce(
    (totals, assignment) => {
      (assignment.generatedDays || []).forEach((day) => {
        if (day.dayType === "workday") {
          totals.workdays += 1;
          totals.supplementaryMinutes += Number(day.authorizedExtraMinutes) || 0;
        }

        if (day.dayType === "vacation") {
          totals.vacationDays += 1;
        }

        if (day.dayType === "weekend_overtime") {
          totals.extraDays += 1;
          totals.extraMinutes += Math.max(
            minutesBetween(day.startTime, day.endTime) - (Number(day.lunchDurationMinutes) || 0),
            0,
          );
        }
      });

      (assignment.scheduleHistory || []).forEach((entry) => {
        const groupId = entry.groupId?.toString?.() || "";
        if (groupId && entry.weekStartKey) {
          savedGroupWeeks.add(`${groupId}|${entry.weekStartKey}`);
        }
      });

      (assignment.planningApprovals || []).forEach((entry) => {
        const groupId = entry.groupId?.toString?.() || "";
        if (groupId && entry.weekStartKey && !entry.unlockedAt) {
          approvedGroupWeeks.add(`${groupId}|${entry.weekStartKey}`);
        }
      });

      return totals;
    },
    { workdays: 0, vacationDays: 0, extraDays: 0, supplementaryMinutes: 0, extraMinutes: 0 },
  );

  activeGroups.forEach((group) => {
    (group.members || []).forEach((member) => {
      const employeeId = member.employee?.toString?.() || "";
      if (employeeId && employeeIds.has(employeeId)) {
        groupEmployeeIds.add(employeeId);
      }
    });
  });

  const uploadSummary = uploadStats[0] || {
    uploads: 0,
    totalPunches: 0,
    normalized: 0,
    published: 0,
    unmatchedEmployees: 0,
    irregularDays: 0,
  };
  const dayDecisions = dayDecisionStats.reduce(
    (totals, row) => {
      totals.count += Number(row.count) || 0;
      totals.lateMinutes += Number(row.lateMinutes) || 0;
      totals.supplementaryMinutes += Number(row.supplementaryMinutes) || 0;
      totals.extraordinaryMinutes += Number(row.extraordinaryMinutes) || 0;
      return totals;
    },
    { count: 0, lateMinutes: 0, supplementaryMinutes: 0, extraordinaryMinutes: 0 },
  );
  const coverage = employees.length ? Math.round((scheduledEmployeeIds.size / employees.length) * 100) : 0;
  const pendingUploads = Math.max((uploadSummary.uploads || 0) - (uploadSummary.published || 0), 0);
  const expectedGroupWeeks = activeGroups.length * weekKeys.length;
  const groupCoverage = expectedGroupWeeks ? Math.round((savedGroupWeeks.size / expectedGroupWeeks) * 100) : 0;
  const approvedCoverage = expectedGroupWeeks ? Math.round((approvedGroupWeeks.size / expectedGroupWeeks) * 100) : 0;
  const pendingGroupWeeks = Math.max(expectedGroupWeeks - savedGroupWeeks.size, 0);
  const pendingApprovals = Math.max(savedGroupWeeks.size - approvedGroupWeeks.size, 0);
  const employeesWithoutGroup = Math.max(employees.length - groupEmployeeIds.size, 0);
  const closureSaved = Boolean(latestClosure?.completeBaseHours);
  const comparisonSummary = comparisonSnapshot?.summary || {};
  const unresolvedAlerts = Number(
    comparisonSummary.pendingOperationalAlertDays ?? comparisonSummary.operationalAlertDays,
  ) || 0;
  const unresolvedLates = Number(comparisonSummary.pendingLateDays ?? comparisonSummary.lateDays) || 0;
  const unresolvedAdditional = Number(comparisonSnapshot?.additionalDays) || 0;
  const plannedSalary = numberOrNull(comparisonSnapshot?.salaryPlanned) ?? baseSalary;
  const hasRegisteredData = (Number(uploadSummary.published) || 0) > 0;
  const registeredSalary = hasRegisteredData ? numberOrNull(comparisonSnapshot?.salaryReal) ?? 0 : null;

  return {
    monthKey,
    monthLabel: monthLabel(monthKey),
    employees: employees.length,
    activeGroups: activeGroups.length,
    employeesWithoutGroup,
    scheduledEmployees: scheduledEmployeeIds.size,
    pendingSchedules: Math.max(employees.length - scheduledEmployeeIds.size, 0),
    coverage,
    groupCoverage,
    approvedCoverage,
    expectedGroupWeeks,
    savedGroupWeeks: savedGroupWeeks.size,
    approvedGroupWeeks: approvedGroupWeeks.size,
    pendingGroupWeeks,
    pendingApprovals,
    baseSalary,
    plannedSalary,
    registeredSalary,
    hasRegisteredData,
    planned,
    uploadSummary,
    latestUpload,
    pendingUploads,
    dayDecisions,
    latestClosure,
    closureSaved,
    unresolved: {
      alerts: unresolvedAlerts,
      lates: unresolvedLates,
      additional: unresolvedAdditional,
      lateMinutes: Number(comparisonSummary.lateMinutes) || 0,
      additionalMinutes: Number(comparisonSummary.additionalSupplementaryMinutes) || 0,
    },
    recentLogs: recentLogs.map((log) => ({
      id: log._id.toString(),
      label: recentActionLabel(log.action),
      entity: log.entityLabel || "Registro operativo",
      actor: log.actor || "admin",
      happenedAt: log.happenedAt,
    })),
  };
}

export default async function DashboardHomePage() {
  await connection();
  const summary = await loadHomeSummary();

  const metrics = [
    {
      label: "Empleados activos",
      value: formatNumber(summary.employees),
      help: `${formatNumber(summary.activeGroups)} grupos de trabajo`,
      icon: Users,
    },
    {
      label: "Sueldo planificado",
      value: formatMoney(summary.plannedSalary),
      help: "Según horarios del mes",
      icon: BadgeDollarSign,
    },
    {
      label: "Sueldo registrado",
      value: formatOptionalMoney(summary.registeredSalary),
      help: summary.hasRegisteredData ? "Referencia antes de cierre" : "Sin picadas publicadas",
      icon: Gauge,
    },
    {
      label: "Picadas publicadas",
      value: formatNumber(summary.uploadSummary.published),
      help: `${formatNumber(summary.uploadSummary.totalPunches)} picadas cargadas`,
      icon: UploadCloud,
    },
    {
      label: "Decisiones guardadas",
      value: formatNumber(summary.dayDecisions.count),
      help: "Revisiones ya aplicadas",
      icon: ListChecks,
    },
    {
      label: "Cruce de horas",
      value: summary.closureSaved ? "Guardado" : "Pendiente",
      help: summary.latestClosure ? `Versión ${summary.latestClosure.version}` : "Bloquea pre-nómina",
      icon: BadgeDollarSign,
    },
  ];
  const flowSteps = [
    {
      title: "Alertas por resolver",
      value: summary.unresolved.alerts,
      detail: "Picadas incompletas, de más o trabajo sin horario",
      tone: "danger",
      href: `${planningModulePath("/attendance/comparison")}?month=${encodeURIComponent(summary.monthKey)}&onlyIssues=1`,
    },
    {
      title: "Atrasos por resolver",
      value: summary.unresolved.lates,
      detail: `${formatHours(summary.unresolved.lateMinutes)} detectadas`,
      tone: "warning",
      href: `${planningModulePath("/attendance/comparison")}?month=${encodeURIComponent(summary.monthKey)}&filter=late`,
    },
    {
      title: "Adicionales por resolver",
      value: summary.unresolved.additional,
      detail: `${formatHours(summary.unresolved.additionalMinutes)} detectadas`,
      tone: "additional",
      href: `${planningModulePath("/attendance/comparison")}?month=${encodeURIComponent(summary.monthKey)}&filter=additional`,
    },
  ];

  return (
    <ModuleShell
      title="Inicio"
      description="Estado del flujo operativo del mes."
    >
      <div className={styles.home}>
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <h2>Mes en curso: {summary.monthLabel}</h2>
            <p>
              Revisa qué falta para pasar de planificación a pre-nómina sin perder de vista
              cargas, novedades, decisiones y cierre operativo.
            </p>
          </div>

          <Link className={styles.primaryAction} href={planningModulePath("/schedules")}>
            <CalendarDays size={19} />
            <span>Planificación semanal</span>
            <ArrowRight size={17} />
          </Link>
        </section>

        <section className={styles.metricGrid} aria-label="Indicadores del mes">
          {metrics.map((metric) => {
            const Icon = metric.icon;

            return (
              <article key={metric.label} className={styles.metricCard}>
                <span className={styles.metricIcon}><Icon size={18} /></span>
                <span className={styles.metricLabel}>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.help}</small>
              </article>
            );
          })}
        </section>

        <div className={styles.mainGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Flujo</p>
                <h3>Resolver antes del cierre</h3>
              </div>
              <CheckCircle2 size={20} />
            </div>

            <div className={styles.alertList}>
              {flowSteps.map((item) => (
                <Link key={item.title} href={item.href} className={styles.alertItem}>
                  <span className={item.value > 0 ? styles[`${item.tone}Value`] : styles.okValue}>
                    {formatNumber(item.value)}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Mes</p>
                <h3>Planificado vs registrado</h3>
              </div>
              <BadgeDollarSign size={20} />
            </div>

            <div className={styles.salaryPanel}>
              <div>
                <span>Sueldo planificado</span>
                <strong>{formatMoney(summary.plannedSalary)}</strong>
              </div>
              <div>
                <span>Sueldo registrado</span>
                <strong>{formatOptionalMoney(summary.registeredSalary)}</strong>
              </div>
              <small>
                El planificado se actualiza según los horarios guardados. El registrado aparece solo cuando existen picadas
                publicadas en el mes.
              </small>
            </div>
          </section>
        </div>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Actividad</p>
              <h3>Últimos movimientos</h3>
            </div>
            <History size={20} />
          </div>

          <div className={styles.activityList}>
            {summary.recentLogs.length ? (
              summary.recentLogs.map((log) => (
                <Link key={log.id} href={planningModulePath("/history")} className={styles.activityItem}>
                  <span><History size={15} /></span>
                  <div>
                    <strong>{log.label}</strong>
                    <small>{log.entity} · {log.actor} · {formatDateTime(log.happenedAt)}</small>
                  </div>
                  <ArrowRight size={15} />
                </Link>
              ))
            ) : (
              <div className={styles.emptyState}>Todavía no hay movimientos auditados este mes.</div>
            )}
          </div>
        </section>
      </div>
    </ModuleShell>
  );
}
