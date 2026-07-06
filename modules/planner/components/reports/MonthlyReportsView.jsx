"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, ArrowRight, Download, RefreshCw } from "lucide-react";

import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { planningModulePath } from "@/modules/planner/routes";
import styles from "@/modules/planner/styles/components/reports/MonthlyReportsView.module.scss";

function money(value) {
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

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "No se pudo cargar la información.");
  }

  return data;
}

export default function MonthlyReportsView({ initialMonth = "" }) {
  const [month, setMonth] = useState(initialMonth || formatEcuadorMonthKey());
  const [isLoading, setIsLoading] = useState(true);
  const [payload, setPayload] = useState({
    months: [],
    closure: null,
    planned: null,
    executed: null,
  });
  const [errors, setErrors] = useState({});
  const [isPending, startTransition] = useTransition();

  const closure = payload.closure?.closure || payload.closure?.preview || null;
  const totals = closure?.totals || {};
  const plannedTotal = Number(payload.planned?.summary?.totalCost) || 0;
  const executedTotal = Number(payload.executed?.summary?.totalCost) || Number(totals.salaryTotal) || 0;
  const variance = executedTotal - plannedTotal;
  const largestTotal = Math.max(plannedTotal, executedTotal, 1);
  const plannedBarWidth = `${Math.max(4, (plannedTotal / largestTotal) * 100)}%`;
  const executedBarWidth = `${Math.max(4, (executedTotal / largestTotal) * 100)}%`;
  const closureHref = planningModulePath(`/operations/monthly-summary/${encodeURIComponent(month)}`);
  const payrollHref = `${planningModulePath("/payroll")}?month=${encodeURIComponent(month)}`;
  const detailedExcelHref = `/api/planner/attendance/monthly-closure?month=${encodeURIComponent(month)}&export=detailed-xlsx`;
  const payrollExcelHref = `/api/planner/attendance/monthly-closure?month=${encodeURIComponent(month)}&export=payroll-xlsx`;

  const currentMonthRow = useMemo(() => {
    return (payload.months || []).find((row) => row.monthKey === month) || null;
  }, [month, payload.months]);
  const insightItems = [
    {
      label: "Cierre",
      value: currentMonthRow?.isClosed ? `v${currentMonthRow.version}` : "Pendiente",
      detail: currentMonthRow?.closedAt ? new Date(currentMonthRow.closedAt).toLocaleDateString("es-EC") : "Sin copia histórica",
    },
    {
      label: "Adicionales",
      value: `${totals.supplementaryLabel || currentMonthRow?.supplementaryLabel || "--"} HS`,
      detail: `${totals.extraordinaryLabel || currentMonthRow?.extraordinaryLabel || "--"} HE`,
    },
    {
      label: "Variación",
      value: plannedTotal && executedTotal ? money(variance) : "--",
      detail: variance > 0 ? "Sobre planificación" : variance < 0 ? "Bajo planificación" : "Sin diferencia",
    },
  ];

  const load = useCallback((nextMonth) => {
    startTransition(async () => {
      try {
        const query = `month=${encodeURIComponent(nextMonth)}`;
        const [monthsResult, closureResult, plannedResult, executedResult] = await Promise.allSettled([
          fetchJson("/api/planner/attendance/monthly-closure?list=months"),
          fetchJson(`/api/planner/attendance/monthly-closure?${query}`),
          fetchJson(`/api/planner/payroll/planned-cost?${query}`),
          fetchJson(`/api/planner/payroll/executed-cost?${query}`),
        ]);

        setPayload({
          months: monthsResult.status === "fulfilled" ? monthsResult.value.months || [] : [],
          closure: closureResult.status === "fulfilled" ? closureResult.value : null,
          planned: plannedResult.status === "fulfilled" ? plannedResult.value : null,
          executed: executedResult.status === "fulfilled" ? executedResult.value : null,
        });
        setErrors({
          months: monthsResult.status === "rejected" ? monthsResult.reason.message : "",
          closure: closureResult.status === "rejected" ? closureResult.reason.message : "",
          planned: plannedResult.status === "rejected" ? plannedResult.reason.message : "",
          executed: executedResult.status === "rejected" ? executedResult.reason.message : "",
        });
      } finally {
        setIsLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    load(month);
  }, [load, month]);

  function handleMonthChange(value) {
    setIsLoading(true);
    setMonth(value);
    window.history.replaceState(null, "", `${window.location.pathname}?month=${encodeURIComponent(value)}`);
  }

  return (
    <section className={styles.workspace}>
      <main className={styles.reportCanvas}>
        {isLoading ? (
          <div className={styles.loadingOverlay} role="status" aria-live="polite">
            <RefreshCw size={18} />
            <span>Preparando reporte mensual</span>
          </div>
        ) : null}

        <header className={styles.reportHero}>
          <div>
            <span className={styles.eyebrow}>Reporte integral</span>
            <h2>{monthLabel(month)}</h2>
            <p>Cierre, asistencia, costos, exportables e histórico mensual.</p>
          </div>
          <div className={styles.heroActions}>
            <label className={styles.monthField}>
              <span>Mes</span>
              <input
                type="month"
                value={month}
                onChange={(event) => handleMonthChange(event.target.value)}
                disabled={isLoading || isPending}
              />
            </label>
            <div className={styles.heroStatus}>
              <span>{currentMonthRow?.isClosed ? "Cerrado" : "Pendiente"}</span>
              <strong>{currentMonthRow?.isClosed ? `v${currentMonthRow.version}` : "--"}</strong>
            </div>
          </div>
        </header>

        {errors.closure ? (
          <div className={styles.notice}>
            <AlertTriangle size={18} />
            {errors.closure}
          </div>
        ) : null}

        <div className={styles.insightStrip}>
          {insightItems.map((item) => (
            <article key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.detail}</small>
            </article>
          ))}
        </div>

        <section className={styles.reportBlock}>
          <div className={styles.blockHeader}>
            <span>Cierre operativo</span>
            {isPending || isLoading ? <small><RefreshCw size={14} /> Actualizando</small> : null}
          </div>
          <div className={styles.metricGrid}>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <article key={index} className={styles.metricSkeleton} aria-hidden="true">
                  <span className={styles.skeletonLineShort} />
                  <strong className={styles.skeletonLineLarge} />
                  <small className={styles.skeletonLine} />
                </article>
              ))
            ) : (
              <>
                <article>
                  <span>Empleados</span>
                  <strong>{totals.employees || currentMonthRow?.employees || "--"}</strong>
                  <small>En el cierre mensual</small>
                </article>
                <article>
                  <span>Laborables</span>
                  <strong>{totals.regularWorkedLabel || currentMonthRow?.regularWorkedLabel || "--"}</strong>
                  <small>Meta {totals.regularTargetLabel || currentMonthRow?.regularTargetLabel || "--"}</small>
                </article>
                <article>
                  <span>HS / HE</span>
                  <strong>{totals.supplementaryLabel || currentMonthRow?.supplementaryLabel || "--"} / {totals.extraordinaryLabel || currentMonthRow?.extraordinaryLabel || "--"}</strong>
                  <small>Horas adicionales</small>
                </article>
                <article>
                  <span>Sueldo total</span>
                  <strong>{totals.salaryTotalLabel || currentMonthRow?.salaryTotalLabel || "--"}</strong>
                  <small>Valor guardado del mes</small>
                </article>
              </>
            )}
          </div>
        </section>

        <section className={styles.reportBlock}>
          <div className={styles.blockHeader}>
            <span>Planificado vs ejecutado</span>
          </div>
          <div className={styles.comparisonBoard}>
            <div className={styles.barsPanel}>
              <div>
                <span>Planificado</span>
                <strong>{plannedTotal ? money(plannedTotal) : "--"}</strong>
                <i style={{ width: plannedBarWidth }} />
              </div>
              <div>
                <span>Ejecutado</span>
                <strong>{executedTotal ? money(executedTotal) : "--"}</strong>
                <i style={{ width: executedBarWidth }} />
              </div>
            </div>
            <article className={variance > 0 ? styles.overBudget : styles.underBudget}>
              <span>Variación</span>
              <strong>{plannedTotal && executedTotal ? money(variance) : "--"}</strong>
              <small>Contra planificación</small>
            </article>
          </div>
        </section>

        <section className={styles.exportDeck}>
          <Link href={closureHref}>
            Cierre mensual
            <ArrowRight size={16} />
          </Link>
          <Link href={payrollHref}>
            Costos
            <ArrowRight size={16} />
          </Link>
          <a href={detailedExcelHref}>
            <Download size={16} />
            Excel completo
          </a>
          <a href={payrollExcelHref}>
            <Download size={16} />
            Nómina
          </a>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}>
            <div>
              <span>Histórico mensual</span>
              <strong>Mes a mes desde mayo 2026</strong>
            </div>
          </div>
          <div className={styles.tableScroller}>
            <table>
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Estado</th>
                  <th>Laborables</th>
                  <th>HS</th>
                  <th>HE</th>
                  <th>Atrasos</th>
                  <th>Sueldo total</th>
                </tr>
              </thead>
              <tbody>
                {(payload.months || []).map((row) => (
                  <tr key={row.monthKey} className={row.monthKey === month ? styles.activeRow : ""}>
                    <td>
                      <strong>{monthLabel(row.monthKey)}</strong>
                      <span>{row.monthKey}</span>
                    </td>
                    <td>{row.isClosed ? `Cerrado v${row.version}` : "Pendiente"}</td>
                    <td>{row.regularWorkedLabel} / {row.regularTargetLabel}</td>
                    <td>{row.supplementaryLabel}</td>
                    <td>{row.extraordinaryLabel}</td>
                    <td>{row.lateLabel}</td>
                    <td>{row.salaryTotalLabel}</td>
                  </tr>
                ))}
                {!payload.months?.length ? (
                  <tr>
                    <td colSpan={7} className={styles.emptyCell}>No hay meses para mostrar.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </section>
  );
}
