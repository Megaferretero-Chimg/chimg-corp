"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { planningModulePath } from "@/modules/planner/routes";
import styles from "@/modules/planner/styles/components/attendance/MonthlyClosureMonthsView.module.scss";

function monthLabel(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);

  if (!year || !month) return monthKey || "";

  return new Intl.DateTimeFormat("es-EC", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

export default function MonthlyClosureMonthsView() {
  const router = useRouter();
  const [months, setMonths] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadMonths() {
      try {
        setIsLoading(true);
        setError("");

        const response = await fetch("/api/planner/attendance/monthly-closure?list=months");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo cargar el resumen de cierres.");
        }

        if (isMounted) setMonths(payload.months || []);
      } catch (requestError) {
        if (isMounted) setError(requestError.message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadMonths();

    return () => {
      isMounted = false;
    };
  }, []);

  function openMonth(monthKey) {
    router.push(planningModulePath(`/operations/monthly-summary/${monthKey}`));
  }

  function handleRowKeyDown(event, monthKey) {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    openMonth(monthKey);
  }

  return (
    <section className={styles.panel}>
      {error ? (
        <div className={styles.errorBox}>
          <AlertTriangle size={17} />
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className={styles.loadingScene} aria-hidden="true">
          {Array.from({ length: 8 }).map((_, index) => <span key={index} />)}
        </div>
      ) : (
        <div className={styles.tableShell}>
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
                {months.map((month) => (
                  <tr
                    key={month.monthKey}
                    className={styles.clickableRow}
                    role="button"
                    tabIndex={0}
                    onClick={() => openMonth(month.monthKey)}
                    onKeyDown={(event) => handleRowKeyDown(event, month.monthKey)}
                  >
                    <td>
                      <strong>{monthLabel(month.monthKey)}</strong>
                      <span>{month.monthKey}</span>
                    </td>
                    <td>
                      <span className={month.isClosed ? styles.closedBadge : styles.openBadge}>
                        {month.isClosed ? `Cerrado v${month.version}` : "Pendiente"}
                      </span>
                      {month.closedAt ? <small>{new Date(month.closedAt).toLocaleString("es-EC")}</small> : null}
                    </td>
                    <td>{month.regularWorkedLabel} / {month.regularTargetLabel}</td>
                    <td>{month.supplementaryLabel}</td>
                    <td>{month.extraordinaryLabel}</td>
                    <td>{month.lateLabel}</td>
                    <td>
                      <strong className={styles.salaryValue}>{month.salaryTotalLabel}</strong>
                    </td>
                  </tr>
                ))}
                {!months.length ? (
                  <tr>
                    <td colSpan={7} className={styles.emptyCell}>No hay meses para mostrar.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isLoading && !error ? (
        <button type="button" className={styles.refreshButton} onClick={() => window.location.reload()}>
          <RefreshCw size={16} />
          Actualizar lista
        </button>
      ) : null}
    </section>
  );
}
