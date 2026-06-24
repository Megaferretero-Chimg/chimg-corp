"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ArrowRight, BadgeDollarSign, CalendarCheck2, CircleAlert, FileText, RefreshCw, UsersRound } from "lucide-react";

import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { planningModulePath } from "@/lib/modules/planning/routes";
import styles from "./PayrollHomeView.module.scss";

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

function monthLabel(month) {
  const [year, monthNumber] = String(month || "").split("-");
  return year && monthNumber ? `${monthNumber}/${year}` : month;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "No se pudo cargar la información.");
  }

  return data;
}

export default function PayrollHomeView({ initialMonth = "" }) {
  const [month, setMonth] = useState(initialMonth || formatEcuadorMonthKey());
  const [payload, setPayload] = useState({ planned: null, executed: null, closure: null });
  const [errors, setErrors] = useState({});
  const [isPending, startTransition] = useTransition();

  const planned = payload.planned;
  const executed = payload.executed;
  const closure = payload.closure;
  const plannedTotal = Number(planned?.summary?.totalCost) || 0;
  const executedTotal = Number(executed?.summary?.totalCost) || 0;
  const variance = executedTotal - plannedTotal;
  const hasExecuted = Boolean(executed?.summary);
  const hasClosure = Boolean(closure?.closure);

  const links = useMemo(() => {
    const encodedMonth = encodeURIComponent(month);

    return {
      planned: `${planningModulePath("/payroll/planned-cost")}?month=${encodedMonth}`,
      executed: `${planningModulePath("/payroll/executed-cost")}?month=${encodedMonth}`,
      employee: `${planningModulePath("/payroll/by-employee")}?month=${encodedMonth}`,
      closure: planningModulePath(`/operations/monthly-summary/${encodedMonth}`),
    };
  }, [month]);

  const load = useCallback((nextMonth) => {
    startTransition(async () => {
      const query = `month=${encodeURIComponent(nextMonth)}`;
      const [plannedResult, executedResult, closureResult] = await Promise.allSettled([
        fetchJson(`/api/payroll/planned-cost?${query}`),
        fetchJson(`/api/payroll/executed-cost?${query}`),
        fetchJson(`/api/attendance/monthly-closure?${query}`),
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
    load(month);
  }, [load, month]);

  function handleMonthChange(value) {
    setMonth(value);
    window.history.replaceState(null, "", `${window.location.pathname}?month=${encodeURIComponent(value)}`);
  }

  return (
    <section className={styles.panel}>
      <div className={styles.controlBand}>
        <div>
          <span className={styles.eyebrow}>Periodo de nómina</span>
          <h2>{monthLabel(month)}</h2>
        </div>
        <label>
          <span>Mes</span>
          <input type="month" value={month} onChange={(event) => handleMonthChange(event.target.value)} />
        </label>
      </div>

      <div className={styles.heroGrid}>
        <article className={styles.heroCard}>
          <span>Costo ejecutado</span>
          <strong>{hasExecuted ? money(executedTotal) : "--"}</strong>
          <small>{hasExecuted ? `${executed.summary.employees || 0} empleados en cierre` : "Pendiente de cierre mensual"}</small>
        </article>
        <article className={styles.heroCard}>
          <span>Costo planificado</span>
          <strong>{planned ? money(plannedTotal) : "--"}</strong>
          <small>{planned ? `${planned.summary.employees || 0} empleados planificados` : "Sin programación cargada"}</small>
        </article>
        <article className={`${styles.heroCard} ${variance > 0 ? styles.warningCard : ""}`}>
          <span>Diferencia</span>
          <strong>{hasExecuted && planned ? money(variance) : "--"}</strong>
          <small>{variance > 0 ? "Por encima del plan" : "Contra el plan mensual"}</small>
        </article>
      </div>

      <div className={styles.statusGrid}>
        <article className={styles.statusCard}>
          <CalendarCheck2 size={20} />
          <div>
            <span>Resumen de cierre</span>
            <strong>{hasClosure ? `Cerrado v${closure.closure.version}` : "Pendiente"}</strong>
            <small>{hasClosure ? "Datos listos para nómina" : errors.closure || "Guarda el cruce para fijar valores"}</small>
          </div>
        </article>
        <article className={styles.statusCard}>
          <UsersRound size={20} />
          <div>
            <span>Horas laborales</span>
            <strong>{hours(executed?.summary?.normalHours ?? planned?.summary?.workdays * 8)}</strong>
            <small>Base mensual reconocida</small>
          </div>
        </article>
        <article className={styles.statusCard}>
          <BadgeDollarSign size={20} />
          <div>
            <span>Recargos</span>
            <strong>
              {money((Number(executed?.summary?.supplementaryCost) || 0) + (Number(executed?.summary?.extraordinaryCost) || 0))}
            </strong>
            <small>
              Sup. {hours(executed?.summary?.supplementaryHours)} · Ext. {hours(executed?.summary?.extraordinaryHours)}
            </small>
          </div>
        </article>
      </div>

      {errors.executed ? (
        <div className={styles.notice}>
          <CircleAlert size={18} />
          {errors.executed}
        </div>
      ) : null}

      <div className={styles.actionGrid}>
        <Link href={links.employee} className={styles.actionCard}>
          <FileText size={20} />
          <div>
            <strong>Resumen por empleado</strong>
            <span>Revisar valores finales por persona</span>
          </div>
          <ArrowRight size={18} />
        </Link>
        <Link href={links.executed} className={styles.actionCard}>
          <BadgeDollarSign size={20} />
          <div>
            <strong>Costo ejecutado</strong>
            <span>Analizar el impacto real del mes</span>
          </div>
          <ArrowRight size={18} />
        </Link>
        <Link href={links.planned} className={styles.actionCard}>
          <CalendarCheck2 size={20} />
          <div>
            <strong>Costo planificado</strong>
            <span>Comparar presupuesto esperado</span>
          </div>
          <ArrowRight size={18} />
        </Link>
        <Link href={links.closure} className={styles.actionCard}>
          <RefreshCw size={20} />
          <div>
            <strong>Resumen de cierre</strong>
            <span>Revisar totales finales antes de nómina</span>
          </div>
          <ArrowRight size={18} />
        </Link>
      </div>

      {isPending ? <div className={styles.loading}>Actualizando métricas...</div> : null}
    </section>
  );
}
