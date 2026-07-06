"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, ArrowRight, BadgeDollarSign, CalendarCheck2, RefreshCw } from "lucide-react";

import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { planningModulePath } from "@/modules/planner/routes";
import styles from "@/modules/planner/styles/components/payroll/PayrollHomeView.module.scss";

function money(value) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function hours(value) {
  const number = Number(value) || 0;
  return number ? `${number.toLocaleString("es-EC", { maximumFractionDigits: 2 })}h` : "--";
}

function percent(value) {
  const number = Number(value) || 0;
  return `${number.toLocaleString("es-EC", { maximumFractionDigits: 1 })}%`;
}

function monthLabel(month) {
  const [year, monthNumber] = String(month || "").split("-").map(Number);

  if (!year || !monthNumber) return month || "";

  return new Intl.DateTimeFormat("es-EC", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, monthNumber - 1, 1));
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "No se pudo cargar la información.");
  }

  return data;
}

function makeGroup(row = {}) {
  return {
    key: `${row.branchCode || "SIN"}:${row.areaCode || "SIN"}`,
    branchCode: row.branchCode || "",
    branchName: row.branchName || row.branchCode || "Sin sucursal",
    areaCode: row.areaCode || "",
    areaName: row.areaName || "Sin area",
    employees: 0,
    baseCost: 0,
    plannedTotal: 0,
    executedTotal: 0,
    plannedSupplementaryCost: 0,
    executedSupplementaryCost: 0,
    plannedExtraordinaryCost: 0,
    executedExtraordinaryCost: 0,
    plannedSupplementaryHours: 0,
    executedSupplementaryHours: 0,
    plannedExtraordinaryHours: 0,
    executedExtraordinaryHours: 0,
  };
}

function groupRows(plannedRows = [], executedRows = []) {
  const groups = new Map();

  plannedRows.forEach((row) => {
    const key = `${row.branchCode || "SIN"}:${row.areaCode || "SIN"}`;

    if (!groups.has(key)) groups.set(key, makeGroup(row));

    const group = groups.get(key);
    group.employees = Math.max(group.employees, 0) + 1;
    group.baseCost += Number(row.baseCost) || 0;
    group.plannedTotal += Number(row.totalCost) || 0;
    group.plannedSupplementaryCost += Number(row.supplementaryCost) || 0;
    group.plannedExtraordinaryCost += Number(row.extraordinaryCost) || 0;
    group.plannedSupplementaryHours += Number(row.supplementaryHours) || 0;
    group.plannedExtraordinaryHours += Number(row.extraordinaryHours) || 0;
  });

  executedRows.forEach((row) => {
    const key = `${row.branchCode || "SIN"}:${row.areaCode || "SIN"}`;

    if (!groups.has(key)) groups.set(key, makeGroup(row));

    const group = groups.get(key);
    group.employees = Math.max(group.employees, 0);
    group.executedTotal += Number(row.totalCost) || 0;
    group.executedSupplementaryCost += Number(row.supplementaryCost) || 0;
    group.executedExtraordinaryCost += Number(row.extraordinaryCost) || 0;
    group.executedSupplementaryHours += Number(row.supplementaryHours) || 0;
    group.executedExtraordinaryHours += Number(row.extraordinaryHours) || 0;
  });

  return [...groups.values()].sort((left, right) =>
    `${left.branchName} ${left.areaName}`.localeCompare(`${right.branchName} ${right.areaName}`, "es"),
  );
}

function employeeRows(plannedRows = [], executedRows = []) {
  const rowsByEmployee = new Map();

  plannedRows.forEach((row) => {
    rowsByEmployee.set(row.employeeId, {
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      branchName: row.branchName,
      areaName: row.areaName,
      roleName: row.roleName,
      plannedTotal: Number(row.totalCost) || 0,
      executedTotal: 0,
      plannedSupplementaryHours: Number(row.supplementaryHours) || 0,
      executedSupplementaryHours: 0,
      plannedExtraordinaryHours: Number(row.extraordinaryHours) || 0,
      executedExtraordinaryHours: 0,
    });
  });

  executedRows.forEach((row) => {
    const current = rowsByEmployee.get(row.employeeId) || {
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      branchName: row.branchName,
      areaName: row.areaName,
      roleName: row.roleName,
      plannedTotal: 0,
      executedTotal: 0,
      plannedSupplementaryHours: 0,
      executedSupplementaryHours: 0,
      plannedExtraordinaryHours: 0,
      executedExtraordinaryHours: 0,
    };

    current.executedTotal = Number(row.totalCost) || 0;
    current.executedSupplementaryHours = Number(row.supplementaryHours) || 0;
    current.executedExtraordinaryHours = Number(row.extraordinaryHours) || 0;
    rowsByEmployee.set(row.employeeId, current);
  });

  return [...rowsByEmployee.values()]
    .map((row) => ({
      ...row,
      variance: row.executedTotal - row.plannedTotal,
    }))
    .sort((left, right) => Math.abs(right.variance) - Math.abs(left.variance));
}

function variationReason(row) {
  const hsDiff = row.executedSupplementaryCost - row.plannedSupplementaryCost;
  const heDiff = row.executedExtraordinaryCost - row.plannedExtraordinaryCost;
  const totalDiff = row.executedTotal - row.plannedTotal;

  if (!row.executedTotal) return "Sin cierre";
  if (Math.abs(hsDiff) >= Math.abs(heDiff) && Math.abs(hsDiff) > 0.01) return hsDiff > 0 ? "Más HS" : "Menos HS";
  if (Math.abs(heDiff) > 0.01) return heDiff > 0 ? "Más HE" : "Menos HE";
  if (Math.abs(totalDiff) > 0.01) return totalDiff > 0 ? "Mayor base" : "Menor ejecución";
  return "Sin variación";
}

function mergeOptions(plannedOptions = {}, executedOptions = {}) {
  const merge = (key) => {
    const map = new Map();

    [...(plannedOptions[key] || []), ...(executedOptions[key] || [])].forEach((option) => {
      if (!option.code) return;
      map.set(option.code, option.name || option.code);
    });

    return [...map.entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "es"));
  };

  return {
    branches: merge("branches"),
    areas: merge("areas"),
  };
}

export default function PayrollHomeView({ initialFilters = {} }) {
  const [filters, setFilters] = useState({
    month: initialFilters.month || formatEcuadorMonthKey(),
    branchCode: initialFilters.branchCode || "",
    areaCode: initialFilters.areaCode || "",
  });
  const [payload, setPayload] = useState({ planned: null, executed: null, closure: null });
  const [errors, setErrors] = useState({});
  const [isPending, startTransition] = useTransition();

  const planned = payload.planned;
  const executed = payload.executed;
  const closure = payload.closure;
  const plannedTotal = Number(planned?.summary?.totalCost) || 0;
  const executedTotal = Number(executed?.summary?.totalCost) || 0;
  const variance = executedTotal - plannedTotal;
  const variancePercent = plannedTotal ? (variance / plannedTotal) * 100 : 0;
  const hasExecuted = Boolean(executed?.summary);
  const hasClosure = Boolean(closure?.closure);
  const options = useMemo(() => mergeOptions(planned?.options, executed?.options), [planned, executed]);
  const groupedRows = useMemo(() => groupRows(planned?.rows || [], executed?.rows || []), [planned, executed]);
  const employees = useMemo(() => employeeRows(planned?.rows || [], executed?.rows || []).slice(0, 12), [planned, executed]);
  const closureHref = planningModulePath(`/operations/monthly-summary/${encodeURIComponent(filters.month)}`);
  const payrollHref = planningModulePath(`/operations/monthly-payroll?month=${encodeURIComponent(filters.month)}`);

  const load = useCallback((nextFilters) => {
    startTransition(async () => {
      const params = new URLSearchParams();
      params.set("month", nextFilters.month);
      if (nextFilters.branchCode) params.set("branchCode", nextFilters.branchCode);
      if (nextFilters.areaCode) params.set("areaCode", nextFilters.areaCode);

      const [plannedResult, executedResult, closureResult] = await Promise.allSettled([
        fetchJson(`/api/planner/payroll/planned-cost?${params.toString()}`),
        fetchJson(`/api/planner/payroll/executed-cost?${params.toString()}`),
        fetchJson(`/api/planner/attendance/monthly-closure?month=${encodeURIComponent(nextFilters.month)}`),
      ]);

      setPayload({
        planned: plannedResult.status === "fulfilled" ? plannedResult.value : null,
        executed: executedResult.status === "fulfilled" ? executedResult.value : null,
        closure: closureResult.status === "fulfilled" ? closureResult.value : null,
      });
      setErrors({
        planned: plannedResult.status === "rejected" ? plannedResult.reason.message : "",
        executed: executedResult.status === "rejected" ? executedResult.reason.message : "",
        closure: closureResult.status === "rejected" ? closureResult.reason.message : "",
      });
    });
  }, []);

  useEffect(() => {
    load(filters);
  }, [filters, load]);

  function updateFilter(key, value) {
    setFilters((current) => {
      const next = {
        ...current,
        [key]: value,
        ...(key === "branchCode" ? { areaCode: "" } : {}),
      };
      const params = new URLSearchParams();
      params.set("month", next.month);
      if (next.branchCode) params.set("branchCode", next.branchCode);
      if (next.areaCode) params.set("areaCode", next.areaCode);
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
      return next;
    });
  }

  return (
    <section className={styles.panel}>
      <div className={styles.filterBar}>
        <div>
          <span className={styles.eyebrow}>Planificado vs ejecutado</span>
          <h2>{monthLabel(filters.month)}</h2>
        </div>
        <label>
          <span>Mes</span>
          <input type="month" value={filters.month} onChange={(event) => updateFilter("month", event.target.value)} disabled={isPending} />
        </label>
        <label>
          <span>Sucursal</span>
          <select value={filters.branchCode} onChange={(event) => updateFilter("branchCode", event.target.value)} disabled={isPending}>
            <option value="">Todas</option>
            {options.branches.map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}
          </select>
        </label>
        <label>
          <span>Área</span>
          <select value={filters.areaCode} onChange={(event) => updateFilter("areaCode", event.target.value)} disabled={isPending}>
            <option value="">Todas</option>
            {options.areas.map((area) => <option key={area.code} value={area.code}>{area.name}</option>)}
          </select>
        </label>
      </div>

      <div className={styles.metricGrid}>
        <article>
          <span>Ejecutado</span>
          <strong>{hasExecuted ? money(executedTotal) : "--"}</strong>
          <small>{hasExecuted ? `${executed.summary.employees || 0} empleados` : "Requiere cierre guardado"}</small>
        </article>
        <article>
          <span>Planificado</span>
          <strong>{planned ? money(plannedTotal) : "--"}</strong>
          <small>{planned ? `${planned.summary.employees || 0} empleados` : "Sin planificación"}</small>
        </article>
        <article className={variance > 0 ? styles.overBudget : styles.underBudget}>
          <span>Variación</span>
          <strong>{hasExecuted && planned ? money(variance) : "--"}</strong>
          <small>{hasExecuted && planned ? percent(variancePercent) : "Pendiente"}</small>
        </article>
        <article>
          <span>Estado cierre</span>
          <strong>{hasClosure ? `v${closure.closure.version}` : "Pendiente"}</strong>
          <small>{hasClosure ? new Date(closure.closure.closedAt).toLocaleDateString("es-EC") : errors.closure || "Sin copia histórica"}</small>
        </article>
      </div>

      {errors.executed ? (
        <div className={styles.notice}>
          <AlertTriangle size={18} />
          {errors.executed}
        </div>
      ) : null}

      <div className={styles.breakdownGrid}>
        <article>
          <span>Sueldo base</span>
          <strong>{money(Number(executed?.summary?.normalCost ?? planned?.summary?.baseCost) || 0)}</strong>
          <small>Base mensual</small>
        </article>
        <article>
          <span>HS</span>
          <strong>{money(Number(executed?.summary?.supplementaryCost) || 0)}</strong>
          <small>{hours(executed?.summary?.supplementaryHours)} ejecutadas · {hours(planned?.summary?.supplementaryHours)} plan</small>
        </article>
        <article>
          <span>HE</span>
          <strong>{money(Number(executed?.summary?.extraordinaryCost) || 0)}</strong>
          <small>{hours(executed?.summary?.extraordinaryHours)} ejecutadas · {hours(planned?.summary?.extraordinaryHours)} plan</small>
        </article>
      </div>

      <div className={styles.quickLinks}>
        <Link href={closureHref}>
          <CalendarCheck2 size={17} />
          Cierre del mes
          <ArrowRight size={16} />
        </Link>
        <Link href={payrollHref}>
          <BadgeDollarSign size={17} />
          Pre-nómina
          <ArrowRight size={16} />
        </Link>
      </div>

      <section className={styles.tableSection}>
        <div className={styles.sectionHeader}>
          <div>
            <span>Variación por área</span>
            <strong>Qué cambió contra el plan</strong>
          </div>
          {isPending ? <small><RefreshCw size={14} /> Actualizando</small> : null}
        </div>
        <div className={styles.tableScroller}>
          <table>
            <thead>
              <tr>
                <th>Sucursal / área</th>
                <th>Planificado</th>
                <th>Ejecutado</th>
                <th>Diferencia</th>
                <th>HS</th>
                <th>HE</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map((row) => {
                const diff = row.executedTotal - row.plannedTotal;

                return (
                  <tr key={row.key}>
                    <td>
                      <strong>{row.areaName}</strong>
                      <span>{row.branchName}</span>
                    </td>
                    <td>{money(row.plannedTotal)}</td>
                    <td>{row.executedTotal ? money(row.executedTotal) : "--"}</td>
                    <td className={diff > 0 ? styles.positiveValue : diff < 0 ? styles.negativeValue : ""}>
                      {row.executedTotal ? money(diff) : "--"}
                    </td>
                    <td>
                      <span>{hours(row.executedSupplementaryHours)}</span>
                      <small>Plan {hours(row.plannedSupplementaryHours)}</small>
                    </td>
                    <td>
                      <span>{hours(row.executedExtraordinaryHours)}</span>
                      <small>Plan {hours(row.plannedExtraordinaryHours)}</small>
                    </td>
                    <td><span className={styles.reasonBadge}>{variationReason(row)}</span></td>
                  </tr>
                );
              })}
              {!groupedRows.length ? (
                <tr>
                  <td colSpan={7} className={styles.emptyCell}>No hay datos para comparar en este mes.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.tableSection}>
        <div className={styles.sectionHeader}>
          <div>
            <span>Mayores variaciones</span>
            <strong>Empleados a revisar</strong>
          </div>
        </div>
        <div className={styles.employeeList}>
          {employees.map((row) => (
            <Link
              key={row.employeeId}
              href={`${planningModulePath("/payroll/by-employee")}?employeeId=${encodeURIComponent(row.employeeId)}&month=${encodeURIComponent(filters.month)}`}
            >
              <div>
                <strong>{row.employeeName}</strong>
                <span>{row.branchName} · {row.areaName} · {row.roleName}</span>
              </div>
              <span className={row.variance > 0 ? styles.positiveValue : row.variance < 0 ? styles.negativeValue : ""}>
                {money(row.variance)}
              </span>
            </Link>
          ))}
          {!employees.length ? <p>No hay empleados con variación para mostrar.</p> : null}
        </div>
      </section>
    </section>
  );
}
