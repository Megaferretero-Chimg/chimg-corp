import Link from "next/link";
import { connection } from "next/server";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileSpreadsheet,
  Gauge,
  UploadCloud,
  Users,
} from "lucide-react";

import DashboardShell from "@/components/dashboard/DashboardShell";
import connectToDatabase from "@/lib/db/mongodb";
import { formatEcuadorMonthKey, makeEcuadorDate } from "@/lib/datetime/ecuador";
import { buildEmployeeActiveInMonthQuery } from "@/lib/employees";
import { planningModulePath } from "@/lib/modules/planning/routes";
import Employee from "@/models/Employee";
import AttendanceUpload from "@/models/AttendanceUpload";
import DailyAttendance from "@/models/DailyAttendance";
import ScheduleAssignment from "@/models/ScheduleAssignment";
import styles from "./page.module.scss";

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

async function loadHomeSummary() {
  await connectToDatabase();

  const monthKey = formatEcuadorMonthKey();
  const [year, month] = monthKey.split("-").map(Number);
  const monthIndex = month - 1;
  const monthStart = makeEcuadorDate(year, monthIndex, 1);
  const nextMonthStart = makeEcuadorDate(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1);
  const activeEmployeeQuery = buildEmployeeActiveInMonthQuery(monthStart);

  const [employees, assignments, uploadStats, latestUpload, attendanceStatusRows] = await Promise.all([
    Employee.find(activeEmployeeQuery)
      .select({ _id: 1, salary: 1, branchCode: 1, branchName: 1, branch: 1 })
      .lean(),
    ScheduleAssignment.find({ monthKey })
      .select({ employee: 1, branchCode: 1, branchName: 1, generatedDays: 1 })
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
    DailyAttendance.aggregate([
      { $match: { date: { $gte: monthStart, $lt: nextMonthStart } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const employeeIds = new Set(employees.map((employee) => employee._id.toString()));
  const activeAssignments = assignments.filter((assignment) =>
    employeeIds.has(assignment.employee?.toString?.() || ""),
  );
  const scheduledEmployeeIds = new Set(activeAssignments.map((assignment) => assignment.employee.toString()));
  const baseSalary = employees.reduce((total, employee) => total + (Number(employee.salary) || 0), 0);
  const branchMap = new Map();

  employees.forEach((employee) => {
    const branchKey = employee.branchCode || employee.branchName || employee.branch || "sin-sucursal";
    const branch = branchMap.get(branchKey) || {
      branchKey,
      branchName: employee.branchName || employee.branch || employee.branchCode || "Sin sucursal",
      employees: 0,
      scheduled: 0,
    };

    branch.employees += 1;
    if (scheduledEmployeeIds.has(employee._id.toString())) {
      branch.scheduled += 1;
    }

    branchMap.set(branchKey, branch);
  });

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

      return totals;
    },
    { workdays: 0, vacationDays: 0, extraDays: 0, supplementaryMinutes: 0, extraMinutes: 0 },
  );
  const uploadSummary = uploadStats[0] || {
    uploads: 0,
    totalPunches: 0,
    normalized: 0,
    published: 0,
    unmatchedEmployees: 0,
    irregularDays: 0,
  };
  const attendanceStatus = Object.fromEntries(attendanceStatusRows.map((row) => [row._id, row.count]));
  const attendanceIssues = [
    "late",
    "early_leave",
    "incomplete",
    "missing",
    "without_schedule",
  ].reduce((total, key) => total + (Number(attendanceStatus[key]) || 0), 0);
  const coverage = employees.length ? Math.round((scheduledEmployeeIds.size / employees.length) * 100) : 0;
  const pendingUploads = Math.max((uploadSummary.uploads || 0) - (uploadSummary.published || 0), 0);
  const branches = [...branchMap.values()]
    .map((branch) => ({
      ...branch,
      pending: Math.max(branch.employees - branch.scheduled, 0),
      coverage: branch.employees ? Math.round((branch.scheduled / branch.employees) * 100) : 0,
    }))
    .sort((left, right) => left.coverage - right.coverage || right.employees - left.employees)
    .slice(0, 5);

  return {
    monthKey,
    monthLabel: monthLabel(monthKey),
    employees: employees.length,
    scheduledEmployees: scheduledEmployeeIds.size,
    pendingSchedules: Math.max(employees.length - scheduledEmployeeIds.size, 0),
    coverage,
    baseSalary,
    planned,
    uploadSummary,
    latestUpload,
    attendanceIssues,
    branches,
    alerts: [
      {
        title: "Horarios por completar",
        value: Math.max(employees.length - scheduledEmployeeIds.size, 0),
        detail: `${coverage}% de cobertura del mes`,
        href: planningModulePath("/planning/monthly"),
      },
      {
        title: "Cargas pendientes",
        value: pendingUploads,
        detail: readUploadPending(latestUpload),
        href: planningModulePath("/attendance/uploads"),
      },
      {
        title: "Novedades en asistencia",
        value: attendanceIssues,
        detail: "Atrasos, incompletos o sin horario",
        href: planningModulePath("/attendance/comparison"),
      },
    ],
  };
}

const quickLinks = [
  {
    title: "Comparar horarios",
    description: "Cruzar planificado vs picadas y revisar novedades.",
    href: planningModulePath("/attendance/comparison"),
    icon: ClipboardCheck,
    featured: true,
  },
  {
    title: "Programar horarios",
    description: "Asignar turnos mensuales por empleado.",
    href: planningModulePath("/planning/monthly"),
    icon: CalendarDays,
  },
  {
    title: "Cargar picadas",
    description: "Subir archivos del biometrico y publicarlos.",
    href: planningModulePath("/attendance/uploads"),
    icon: UploadCloud,
  },
  {
    title: "Cruce de horas",
    description: "Completar laborables para el cierre operativo.",
    href: planningModulePath("/operations/monthly-closure"),
    icon: CalendarClock,
  },
  {
    title: "Pre-nomina",
    description: "Revisar la tabla simple lista para nomina.",
    href: planningModulePath("/operations/monthly-payroll"),
    icon: BadgeDollarSign,
  },
  {
    title: "Reporte mensual",
    description: "Consultar totales y exportables del periodo.",
    href: planningModulePath("/reports/monthly"),
    icon: FileSpreadsheet,
  },
];

export default async function DashboardHomePage() {
  await connection();
  const summary = await loadHomeSummary();

  const metrics = [
    {
      label: "Empleados activos",
      value: formatNumber(summary.employees),
      help: `${formatNumber(summary.scheduledEmployees)} con horario`,
      icon: Users,
    },
    {
      label: "Cobertura de horarios",
      value: `${summary.coverage}%`,
      help: `${formatNumber(summary.pendingSchedules)} pendientes`,
      icon: Gauge,
    },
    {
      label: "Suplementarias planificadas",
      value: formatHours(summary.planned.supplementaryMinutes),
      help: `${formatNumber(summary.planned.workdays)} dias laborables`,
      icon: CalendarClock,
    },
    {
      label: "Extras fin de semana",
      value: formatHours(summary.planned.extraMinutes),
      help: `${formatNumber(summary.planned.extraDays)} jornadas`,
      icon: AlertTriangle,
    },
    {
      label: "Base salarial",
      value: formatMoney(summary.baseSalary),
      help: "Referencia mensual activa",
      icon: BadgeDollarSign,
    },
    {
      label: "Picadas cargadas",
      value: formatNumber(summary.uploadSummary.totalPunches),
      help: `${formatNumber(summary.uploadSummary.published)} cargas publicadas`,
      icon: UploadCloud,
    },
  ];

  return (
    <DashboardShell
      title="Resumen general"
      description="Estado actual del mes, accesos frecuentes y alertas operativas para arrancar el trabajo diario."
    >
      <div className={styles.home}>
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>Inicio</p>
            <h2>Mes en curso: {summary.monthLabel}</h2>
            <p>
              Revisa rapidamente si el mes esta planificado, si las picadas ya fueron publicadas
              y donde conviene entrar primero.
            </p>
          </div>

          <Link className={styles.primaryAction} href={planningModulePath("/attendance/comparison")}>
            <ClipboardCheck size={19} />
            <span>Comparar horarios</span>
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
                <p className={styles.eyebrow}>Alertas</p>
                <h3>Lo que pide atencion</h3>
              </div>
              <CheckCircle2 size={20} />
            </div>

            <div className={styles.alertList}>
              {summary.alerts.map((alert) => (
                <Link key={alert.title} href={alert.href} className={styles.alertItem}>
                  <span className={alert.value > 0 ? styles.alertValue : styles.okValue}>
                    {formatNumber(alert.value)}
                  </span>
                  <span>
                    <strong>{alert.title}</strong>
                    <small>{alert.detail}</small>
                  </span>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Sucursales</p>
                <h3>Cobertura por revisar</h3>
              </div>
              <Gauge size={20} />
            </div>

            <div className={styles.branchList}>
              {summary.branches.length ? (
                summary.branches.map((branch) => (
                  <div key={branch.branchKey} className={styles.branchRow}>
                    <div>
                      <strong>{branch.branchName}</strong>
                      <span>{formatNumber(branch.pending)} sin horario</span>
                    </div>
                    <div className={styles.progressWrap} aria-label={`${branch.coverage}% planificado`}>
                      <span style={{ width: `${branch.coverage}%` }} />
                    </div>
                    <em>{branch.coverage}%</em>
                  </div>
                ))
              ) : (
                <div className={styles.emptyState}>No hay sucursales activas para este mes.</div>
              )}
            </div>
          </section>
        </div>

        <section className={styles.quickGrid} aria-label="Accesos directos">
          {quickLinks.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.quickLink} ${item.featured ? styles.quickLinkFeatured : ""}`}
              >
                <span><Icon size={19} /></span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
                <ArrowRight size={16} />
              </Link>
            );
          })}
        </section>
      </div>
    </DashboardShell>
  );
}
