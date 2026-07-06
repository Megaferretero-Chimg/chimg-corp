"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeft, Calculator, Wallet } from "lucide-react";

import { planningModulePath } from "@/modules/planner/routes";
import styles from "@/modules/planner/styles/components/payroll/PayrollEstimateView.module.scss";

function formatMonthLabel(value) {
  if (!value) {
    return "";
  }

  const [year, month] = String(value).split("-");

  if (!year || !month) {
    return value;
  }

  return `${month}/${year}`;
}

export default function PayrollEstimateView({
  initialEmployeeId = "",
  initialEmployeeName = "",
  initialMonth = "",
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [employeeId] = useState(initialEmployeeId);
  const [employeeName] = useState(initialEmployeeName);
  const [month, setMonth] = useState(initialMonth);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const isInitialLoading = isPending && !response && !error;

  const backHref = useMemo(() => {
    const params = new URLSearchParams();

    if (employeeId) {
      params.set("employeeId", employeeId);
    }

    if (employeeName) {
      params.set("employeeName", employeeName);
    }

    params.set("mode", "month");

    if (month) {
      params.set("month", month);
    }

    return `${planningModulePath("/payroll")}?${params.toString()}`;
  }, [employeeId, employeeName, month]);

  useEffect(() => {
    if (!employeeId || !month) {
      return;
    }

    startTransition(async () => {
      try {
        setError("");
        const request = await fetch(
          `/api/planner/payroll/estimate?employeeId=${encodeURIComponent(employeeId)}&month=${encodeURIComponent(month)}`,
        );
        const payload = await request.json();

        if (!request.ok) {
          throw new Error(payload.error || "No se pudo cargar la estimación.");
        }

        setResponse(payload);
      } catch (requestError) {
        setResponse(null);
        setError(requestError.message);
      }
    });
  }, [employeeId, month]);

  function handleMonthChange(event) {
    const nextMonth = event.target.value;
    setMonth(nextMonth);

    const params = new URLSearchParams();

    if (employeeId) {
      params.set("employeeId", employeeId);
    }

    if (employeeName) {
      params.set("employeeName", employeeName);
    }

    if (nextMonth) {
      params.set("month", nextMonth);
    }

    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <section className={styles.panel}>
      <div className={styles.topbar}>
        <Link href={backHref} className={styles.backLink}>
          <ArrowLeft size={16} />
          Volver a nómina
        </Link>

        <div className={styles.monthField}>
          <label className={styles.label}>Mes a estimar</label>
          <input
            type="month"
            value={month}
            onChange={handleMonthChange}
            className={styles.input}
            disabled={isPending}
          />
        </div>
      </div>

      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Estimación mensual</p>
          <h2 className={styles.title}>{employeeName || response?.employee?.fullName || "Empleado"}</h2>
          <p className={styles.description}>
            {month ? `Mes consultado: ${formatMonthLabel(month)}` : "Selecciona un mes para revisar la estimación."}
          </p>
        </div>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {isInitialLoading ? (
        <div className={styles.loadingStack} aria-hidden="true">
          <div className={styles.loadingHero}>
            <div className={styles.loadingLineLg} />
            <div className={styles.loadingLineMd} />
          </div>

          <div className={styles.loadingGrid}>
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className={styles.loadingCard}>
                <div className={styles.loadingLineSm} />
                <div className={styles.loadingValue} />
                <div className={styles.loadingLineXs} />
              </div>
            ))}
          </div>

          <div className={styles.loadingTable}>
            <div className={styles.loadingTableHeader}>
              <div className={styles.loadingLineMd} />
              <div className={styles.loadingIcons}>
                <div className={styles.loadingDot} />
                <div className={styles.loadingDot} />
              </div>
            </div>

            <div className={styles.loadingRows}>
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className={styles.loadingRow}>
                  <div className={styles.loadingCellShort} />
                  <div className={styles.loadingCellWide} />
                  <div className={styles.loadingCellShort} />
                  <div className={styles.loadingCellShort} />
                  <div className={styles.loadingCellShort} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {response?.message ? <div className={styles.info}>{response.message}</div> : null}

      {response?.summary ? (
        <>
          {!response.summary.hasSalaryConfigured ? (
            <div className={styles.error}>
              El sueldo de este empleado no está configurado. No podemos calcular la estimación todavía.
            </div>
          ) : null}

          <div className={styles.summaryGrid}>
            <article className={styles.card}>
              <span className={styles.cardLabel}>Sueldo referencial</span>
              <strong className={styles.cardValue}>{response.summary.salaryLabel}</strong>
            </article>
            <article className={styles.card}>
              <span className={styles.cardLabel}>Valor hora</span>
              <strong className={styles.cardValue}>{response.summary.hourlyRateLabel}</strong>
            </article>
            <article className={styles.card}>
              <span className={styles.cardLabel}>Base por horarios cargados</span>
              <strong className={styles.cardValue}>{response.summary.basePayTotalLabel}</strong>
              <span className={styles.cardHelp}>{response.summary.basePaidHoursLabel} reconocidas en este mes</span>
            </article>
            <article className={styles.card}>
              <span className={styles.cardLabel}>Horas suplementarias</span>
              <strong className={styles.cardValue}>{response.summary.supplementaryHoursLabel}</strong>
              <span className={styles.cardHelp}>{response.summary.supplementaryPayLabel}</span>
            </article>
            <article className={styles.card}>
              <span className={styles.cardLabel}>Horas extraordinarias</span>
              <strong className={styles.cardValue}>{response.summary.extraordinaryHoursLabel}</strong>
              <span className={styles.cardHelp}>{response.summary.extraordinaryPayLabel}</span>
            </article>
            <article className={styles.card}>
              <span className={styles.cardLabel}>Descuento por atraso</span>
              <strong className={styles.cardValue}>{response.summary.lateDiscountMinutesLabel}</strong>
              <span className={styles.cardHelp}>{response.summary.lateDiscountAmountLabel}</span>
            </article>
            <article className={styles.card}>
              <span className={styles.cardLabel}>Descuento por ausencia</span>
              <strong className={styles.cardValue}>{response.summary.absenceHoursLabel}</strong>
              <span className={styles.cardHelp}>{response.summary.absenceDiscountLabel}</span>
            </article>
            <article className={`${styles.card} ${styles.cardHighlight}`}>
              <span className={styles.cardLabel}>Sueldo estimado</span>
              <strong className={styles.cardValue}>{response.summary.estimatedSalaryLabel}</strong>
              <span className={styles.cardHelp}>Base del período + adicionales - descuentos confirmados</span>
            </article>
          </div>

          <div className={styles.tableWrap}>
            <div className={styles.tableHeader}>
              <div>
                <span className={styles.tableTitle}>Detalle diario</span>
                <p className={styles.tableText}>
                  La base se construye solo con los días que tienen horario cargado en este mes.
                  Vacaciones y feriados cuentan como 8 horas normales.
                </p>
              </div>
              <div className={styles.tableIcons}>
                <Calculator size={16} />
                <Wallet size={16} />
              </div>
            </div>

            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Horario</th>
                    <th>Normal</th>
                    <th>Base</th>
                    <th>Suplementaria</th>
                    <th>Extraordinaria</th>
                    <th>Descuento</th>
                    <th>Impacto</th>
                  </tr>
                </thead>
                <tbody>
                  {response.rows.length ? (
                    response.rows.map((row) => (
                      <tr key={row.dateKey}>
                        <td>
                          <div className={styles.dayCell}>
                            <strong>{row.dateLabel}</strong>
                            <span>{row.dayLabel}</span>
                          </div>
                        </td>
                        <td>
                          <div className={styles.scheduleCell}>
                            <strong>{row.scheduleType}</strong>
                            <span>{row.scheduleLine}</span>
                          </div>
                        </td>
                        <td>{row.normalPaidHours}h</td>
                        <td className={styles.amountCell}>{row.basePayAmountLabel}</td>
                        <td>{row.supplementaryHours}h</td>
                        <td>{row.extraordinaryHours}h</td>
                        <td>{row.discountLabel}</td>
                        <td className={styles.amountCell}>{row.adjustmentAmountLabel}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className={styles.emptyCell}>
                        No hay filas para calcular en este mes.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
