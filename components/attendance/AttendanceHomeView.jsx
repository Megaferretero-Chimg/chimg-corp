"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ArrowRight, Clock3, DollarSign, RefreshCw, TimerReset, WalletCards } from "lucide-react";

import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { planningModulePath } from "@/lib/modules/planning/routes";
import styles from "./AttendanceHomeView.module.scss";

function readInitialFilters() {
  if (typeof window === "undefined") {
    return {
      month: formatEcuadorMonthKey(),
      branchCode: "",
      areaCode: "",
    };
  }

  const params = new URLSearchParams(window.location.search);

  return {
    month: params.get("month") || formatEcuadorMonthKey(),
    branchCode: params.get("branchCode") || "",
    areaCode: params.get("areaCode") || "",
  };
}

function syncUrl(filters) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams();
  params.set("month", filters.month);
  if (filters.branchCode) params.set("branchCode", filters.branchCode);
  if (filters.areaCode) params.set("areaCode", filters.areaCode);

  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function minutes(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function formatMinutes(value) {
  const totalMinutes = minutes(value);
  const hours = Math.floor(totalMinutes / 60);
  const rest = totalMinutes % 60;

  if (!totalMinutes) return "0m";
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function moneyLabel(value) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function monthLabel(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);

  if (!year || !month) return monthKey || "";

  return new Intl.DateTimeFormat("es-EC", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function parsePunchDateTime(dateKey, time) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  const [hour, minute] = String(time || "").split(":").map(Number);

  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  return new Date(year, month - 1, day, hour, minute);
}

function latestPunchLabel(date) {
  if (!date) return "Sin picadas";

  const dayLabel = new Intl.DateTimeFormat("es-EC", {
    day: "2-digit",
    month: "short",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  return `Hasta ${dayLabel}, ${timeLabel}`;
}

function ratio(registered, planned) {
  const plannedValue = Math.max(Number(planned) || 0, 0);
  const registeredValue = Math.max(Number(registered) || 0, 0);

  if (!plannedValue && !registeredValue) return 0;
  if (!plannedValue) return 100;
  return Math.min((registeredValue / plannedValue) * 100, 130);
}

function differenceLabel(registered, planned, formatter) {
  const diff = (Number(registered) || 0) - (Number(planned) || 0);
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  const absoluteValue = Math.abs(diff);

  return `${sign}${formatter(absoluteValue)}`;
}

function MetricCard({ icon: Icon, title, planned, registered, diff, progress, tone = "blue" }) {
  return (
    <article className={`${styles.metricCard} ${styles[`metricCard_${tone}`]}`}>
      <header>
        <span>
          <Icon size={18} />
        </span>
        <strong>{title}</strong>
      </header>
      <div className={styles.metricValues}>
        <div>
          <small>Registrado</small>
          <b>{registered}</b>
        </div>
        <div>
          <small>Planificado</small>
          <b>{planned}</b>
        </div>
      </div>
      <div className={styles.progressTrack}>
        <i style={{ width: `${Math.max(progress, 3)}%` }} />
      </div>
      <footer>
        <span>Diferencia</span>
        <strong>{diff}</strong>
      </footer>
    </article>
  );
}

export default function AttendanceHomeView() {
  const [filters, setFilters] = useState(() => readInitialFilters());
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [comparison, setComparison] = useState({ rows: [], summary: null });
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const areaOptions = useMemo(() => {
    const options = new Map();

    employees.forEach((employee) => {
      if (employee.isActive === false) return;
      if (filters.branchCode && employee.branchCode !== filters.branchCode) return;
      if (employee.areaCode) options.set(employee.areaCode, employee.areaName || employee.areaCode);
    });

    return [...options.entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "es"));
  }, [employees, filters.branchCode]);

  const totals = useMemo(() => {
    const rowTotals = (comparison.rows || []).reduce(
      (accumulator, row) => {
        accumulator.salaryPlanned += Number(row.summary?.salaryPlanned) || 0;
        accumulator.salaryReal += Number(row.summary?.salaryReal) || 0;

        (row.days || []).forEach((day) => {
          (day.punches || []).forEach((punch) => {
            const punchDate = parsePunchDateTime(day.dateKey, punch.time);

            if (punchDate && (!accumulator.latestPunchDate || punchDate > accumulator.latestPunchDate)) {
              accumulator.latestPunchDate = punchDate;
            }
          });
        });

        return accumulator;
      },
      {
        salaryPlanned: 0,
        salaryReal: 0,
        latestPunchDate: null,
      },
    );
    const summary = comparison.summary || {};

    return {
      employees: Number(summary.employees) || comparison.rows?.length || 0,
      plannedRegularMinutes: minutes(summary.plannedRegularMinutes),
      regularWorkedMinutes: minutes(summary.regularWorkedMinutes),
      plannedSupplementaryMinutes: minutes(summary.plannedSupplementaryMinutes),
      detectedSupplementaryMinutes: minutes(summary.detectedSupplementaryMinutes),
      plannedExtraordinaryMinutes: minutes(summary.plannedExtraordinaryMinutes),
      detectedExtraordinaryMinutes: minutes(summary.detectedExtraordinaryMinutes),
      lateDays: Number(summary.lateDays) || 0,
      operationalAlertDays: Number(summary.operationalAlertDays) || 0,
      salaryPlanned: rowTotals.salaryPlanned,
      salaryReal: rowTotals.salaryReal,
      latestPunchDate: rowTotals.latestPunchDate,
    };
  }, [comparison.rows, comparison.summary]);

  const quickLinks = [
    {
      title: "Cargar picadas",
      description: "Subir archivo biométrico y publicar registros.",
      href: planningModulePath("/attendance/uploads"),
    },
    {
      title: "Revisar picadas",
      description: "Depurar registros antes de compararlos.",
      href: planningModulePath("/attendance/review"),
    },
    {
      title: "Comparar con horario",
      description: "Entrar al detalle por empleado.",
      href: planningModulePath("/attendance/comparison"),
    },
  ];

  const loadCatalogs = useCallback(async () => {
    const [employeesResponse, branchesResponse] = await Promise.all([
      fetch("/api/employees"),
      fetch("/api/branches"),
    ]);
    const [employeesPayload, branchesPayload] = await Promise.all([
      employeesResponse.json(),
      branchesResponse.json(),
    ]);

    if (!employeesResponse.ok) {
      throw new Error(employeesPayload.error || "No se pudieron cargar empleados.");
    }

    if (!branchesResponse.ok) {
      throw new Error(branchesPayload.error || "No se pudieron cargar sucursales.");
    }

    setEmployees(employeesPayload.employees || []);
    setBranches(branchesPayload.branches || []);
  }, []);

  const loadComparison = useCallback((nextFilters) => {
    startTransition(async () => {
      try {
        setError("");
        const params = new URLSearchParams();
        params.set("month", nextFilters.month);
        if (nextFilters.branchCode) params.set("branchCode", nextFilters.branchCode);
        if (nextFilters.areaCode) params.set("areaCode", nextFilters.areaCode);

        const response = await fetch(`/api/attendance/comparison?${params.toString()}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo cargar el resumen de asistencia.");
        }

        setComparison({
          rows: payload.rows || [],
          summary: payload.summary || null,
        });
      } catch (requestError) {
        setComparison({ rows: [], summary: null });
        setError(requestError.message);
      }
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    const timeoutId = window.setTimeout(() => {
      loadCatalogs()
        .catch((requestError) => {
          if (mounted) setError(requestError.message);
        });
    }, 0);

    return () => {
      mounted = false;
      window.clearTimeout(timeoutId);
    };
  }, [loadCatalogs]);

  useEffect(() => {
    loadComparison(filters);
  }, [filters, loadComparison]);

  function updateFilters(nextValues) {
    const nextFilters = {
      ...filters,
      ...nextValues,
    };

    if (Object.prototype.hasOwnProperty.call(nextValues, "branchCode")) {
      nextFilters.areaCode = "";
    }

    setFilters(nextFilters);
    syncUrl(nextFilters);
  }

  return (
    <section className={styles.panel}>
      <header className={styles.hero}>
        <div>
          <span>Asistencia en tiempo real</span>
          <h2>{monthLabel(filters.month)}</h2>
          <p>Lectura viva de lo registrado contra lo planificado antes del cierre mensual.</p>
        </div>
        <div className={styles.heroStats}>
          <strong>{totals.employees}</strong>
          <span>empleados evaluados</span>
        </div>
      </header>

      <div className={styles.filterBar}>
        <label>
          <span>Mes</span>
          <input type="month" value={filters.month} onChange={(event) => updateFilters({ month: event.target.value })} />
        </label>
        <label>
          <span>Sucursal</span>
          <select value={filters.branchCode} onChange={(event) => updateFilters({ branchCode: event.target.value })}>
            <option value="">Todas</option>
            {branches.map((branch) => (
              <option key={branch.code} value={branch.code}>{branch.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Área</span>
          <select value={filters.areaCode} onChange={(event) => updateFilters({ areaCode: event.target.value })}>
            <option value="">Todas</option>
            {areaOptions.map((area) => (
              <option key={area.code} value={area.code}>{area.name}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => loadComparison(filters)} disabled={isPending}>
          <RefreshCw size={16} />
          Actualizar
        </button>
      </div>

      {error ? <div className={styles.notice}>{error}</div> : null}

      <div className={`${styles.metricGrid} ${isPending ? styles.loading : ""}`}>
        <MetricCard
          icon={Clock3}
          title="Horas laborables"
          planned={formatMinutes(totals.plannedRegularMinutes)}
          registered={formatMinutes(totals.regularWorkedMinutes)}
          diff={differenceLabel(totals.regularWorkedMinutes, totals.plannedRegularMinutes, formatMinutes)}
          progress={ratio(totals.regularWorkedMinutes, totals.plannedRegularMinutes)}
          tone="blue"
        />
        <MetricCard
          icon={TimerReset}
          title="HS"
          planned={formatMinutes(totals.plannedSupplementaryMinutes)}
          registered={formatMinutes(totals.detectedSupplementaryMinutes)}
          diff={differenceLabel(totals.detectedSupplementaryMinutes, totals.plannedSupplementaryMinutes, formatMinutes)}
          progress={ratio(totals.detectedSupplementaryMinutes, totals.plannedSupplementaryMinutes)}
          tone="green"
        />
        <MetricCard
          icon={WalletCards}
          title="HE"
          planned={formatMinutes(totals.plannedExtraordinaryMinutes)}
          registered={formatMinutes(totals.detectedExtraordinaryMinutes)}
          diff={differenceLabel(totals.detectedExtraordinaryMinutes, totals.plannedExtraordinaryMinutes, formatMinutes)}
          progress={ratio(totals.detectedExtraordinaryMinutes, totals.plannedExtraordinaryMinutes)}
          tone="orange"
        />
        <MetricCard
          icon={DollarSign}
          title="Sueldos"
          planned={moneyLabel(totals.salaryPlanned)}
          registered={moneyLabel(totals.salaryReal)}
          diff={differenceLabel(totals.salaryReal, totals.salaryPlanned, moneyLabel)}
          progress={ratio(totals.salaryReal, totals.salaryPlanned)}
          tone="navy"
        />
      </div>

      <div className={styles.signalStrip}>
        <article>
          <span>Atrasos</span>
          <strong>{totals.lateDays}</strong>
        </article>
        <article>
          <span>Alertas operativas</span>
          <strong>{totals.operationalAlertDays}</strong>
        </article>
        <article>
          <span>Estado</span>
          <strong>{isPending ? "Actualizando" : latestPunchLabel(totals.latestPunchDate)}</strong>
        </article>
      </div>

      <div className={styles.quickLinks}>
        {quickLinks.map((link) => (
          <Link key={link.href} href={link.href}>
            <span>
              <strong>{link.title}</strong>
              <small>{link.description}</small>
            </span>
            <ArrowRight size={18} />
          </Link>
        ))}
      </div>
    </section>
  );
}
