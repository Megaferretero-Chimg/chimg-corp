"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, FileSearch, RefreshCw, Save, UserRound } from "lucide-react";

import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { isEmployeeActiveInMonth } from "@/lib/employees";
import { planningModulePath } from "@/lib/modules/planning/routes";
import styles from "./EmployeeMonthlySummaryView.module.scss";

function safeText(value, fallback = "--") {
  return value || fallback;
}

function metricValue(value) {
  return value && value !== "0m" ? value : "--";
}

function buildMonthLabel(value) {
  const [year, month] = String(value || "").split("-");
  return year && month ? `${month}/${year}` : value;
}

function buildDateTimeLabel(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const PAYMENT_METHODS = [
  { value: "transferencia", label: "Transferencia" },
  { value: "efectivo", label: "Efectivo" },
  { value: "cheque", label: "Cheque" },
  { value: "deposito", label: "Depósito" },
  { value: "otro", label: "Otro" },
];

function dayClassName(day) {
  const classes = [styles.dayRow];

  if (day.dayType === "holiday") classes.push(styles.holidayRow);
  if (day.dayType === "off_day" && !day.punchCount) classes.push(styles.restRow);
  if (day.tags?.length || day.lateMinutes > 0) classes.push(styles.issueRow);
  if (day.authorization?.isSaved) classes.push(styles.authorizedRow);

  return classes.join(" ");
}

export default function EmployeeMonthlySummaryView({
  initialEmployeeId = "",
  initialMonth = "",
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [month, setMonth] = useState(initialMonth || formatEcuadorMonthKey());
  const [employees, setEmployees] = useState([]);
  const [payload, setPayload] = useState(null);
  const [payment, setPayment] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ paymentMethod: "transferencia", notes: "" });
  const [error, setError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const row = payload?.rows?.[0] || null;
  const activeEmployees = useMemo(
    () => employees.filter((employee) => isEmployeeActiveInMonth(employee, month)),
    [employees, month],
  );
  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === employeeId) || row?.employee || null,
    [employeeId, employees, row],
  );
  const isLoadingReport = isPending && employeeId && month;

  function syncUrl(nextEmployeeId = employeeId, nextMonth = month) {
    const params = new URLSearchParams();
    if (nextEmployeeId) params.set("employeeId", nextEmployeeId);
    if (nextMonth) params.set("month", nextMonth);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    let ignore = false;

    async function loadEmployees() {
      try {
        setIsCatalogLoading(true);
        const response = await fetch("/api/employees");
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "No se pudo cargar empleados.");
        }

        if (ignore) return;

        const nextEmployees = data.employees || [];
        setEmployees(nextEmployees);

        setEmployeeId((currentEmployeeId) => {
          if (currentEmployeeId || !nextEmployees.length) {
            return currentEmployeeId;
          }

          const firstActive = nextEmployees.find((employee) => isEmployeeActiveInMonth(employee, month)) || nextEmployees[0];
          return firstActive.id;
        });
      } catch (requestError) {
        if (!ignore) setError(requestError.message);
      } finally {
        if (!ignore) setIsCatalogLoading(false);
      }
    }

    loadEmployees();

    return () => {
      ignore = true;
    };
  }, [month]);

  useEffect(() => {
    if (!employeeId || !month) {
      return;
    }

    startTransition(async () => {
      try {
        setError("");
        const params = new URLSearchParams();
        params.set("employeeId", employeeId);
        params.set("month", month);

        const response = await fetch(`/api/attendance/comparison?${params.toString()}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "No se pudo cargar el resumen mensual.");
        }

        setPayload(data);
      } catch (requestError) {
        setPayload(null);
        setError(requestError.message);
      }
    });
  }, [employeeId, month]);

  useEffect(() => {
    if (!employeeId || !month) {
      return;
    }

    let ignore = false;

    async function loadPayment() {
      try {
        setPaymentError("");
        const params = new URLSearchParams();
        params.set("employeeId", employeeId);
        params.set("month", month);

        const response = await fetch(`/api/payroll/payments?${params.toString()}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "No se pudo cargar el estado de pago.");
        }

        if (ignore) return;

        setPayment(data.payment || null);
        setPaymentForm({
          paymentMethod: data.payment?.paymentMethod || "transferencia",
          notes: data.payment?.notes || "",
        });
      } catch (requestError) {
        if (!ignore) setPaymentError(requestError.message);
      }
    }

    loadPayment();

    return () => {
      ignore = true;
    };
  }, [employeeId, month]);

  function handleEmployeeChange(value) {
    setEmployeeId(value);
    setPayload(null);
    setPayment(null);
    syncUrl(value, month);
  }

  function handleMonthChange(value) {
    setMonth(value);
    setPayload(null);
    setPayment(null);
    syncUrl(employeeId, value);
  }

  const comparisonHref = employeeId
    ? `${planningModulePath(`/attendance/comparison/${employeeId}`)}?month=${encodeURIComponent(month)}`
    : planningModulePath("/attendance/comparison");

  async function savePayment(event) {
    event.preventDefault();

    if (!employeeId || !month || !row || isSavingPayment) {
      return;
    }

    try {
      setIsSavingPayment(true);
      setPaymentError("");

      const response = await fetch("/api/payroll/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          employeeId,
          month,
          amount: row.summary.salaryProjected,
          paymentMethod: paymentForm.paymentMethod,
          notes: paymentForm.notes,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "No se pudo registrar el pago.");
      }

      setPayment(data.payment || null);
      setPaymentForm({
        paymentMethod: data.payment?.paymentMethod || paymentForm.paymentMethod,
        notes: data.payment?.notes || paymentForm.notes,
      });
    } catch (requestError) {
      setPaymentError(requestError.message);
    } finally {
      setIsSavingPayment(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.controls}>
        <label>
          <span>Empleado</span>
          <select value={employeeId} onChange={(event) => handleEmployeeChange(event.target.value)} disabled={isCatalogLoading}>
            <option value="">{isCatalogLoading ? "Cargando empleados..." : "Selecciona un empleado"}</option>
            {activeEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Mes</span>
          <input type="month" value={month} onChange={(event) => handleMonthChange(event.target.value)} />
        </label>

        <Link href={comparisonHref} className={styles.reportLink}>
          <FileSearch size={17} />
          Ver asistencia
        </Link>
      </div>

      {error ? (
        <div className={styles.errorBox}>
          <AlertTriangle size={18} />
          {error}
        </div>
      ) : null}

      {!employeeId ? (
        <div className={styles.emptyState}>
          <UserRound size={22} />
          Selecciona un empleado para consultar su resumen mensual.
        </div>
      ) : null}

      {isLoadingReport ? (
        <div className={styles.loadingBox}>
          <RefreshCw size={18} />
          Cargando resumen del mes...
        </div>
      ) : null}

      {row ? (
        <>
          <div className={styles.identityPanel}>
            <div>
              <span className={styles.eyebrow}>Resumen mensual</span>
              <h2>{row.employee.fullName}</h2>
              <div className={styles.identityMeta}>
                <span>{safeText(row.employee.branchName)}</span>
                <span>{safeText(row.employee.areaName)}</span>
                <span>{safeText(row.employee.roleName)}</span>
                <span>{buildMonthLabel(month)}</span>
              </div>
            </div>
            <div className={styles.salaryBox}>
              <span>Sueldo proyectado</span>
              <strong>{row.summary.salaryProjectedLabel}</strong>
              <small>Base {row.summary.salaryExpectedLabel}</small>
            </div>
          </div>

          <div className={styles.metricGrid}>
            <article>
              <span>Laborales</span>
              <strong>{metricValue(row.summary.regularWorkedLabel)}</strong>
              <small>Plan. {metricValue(row.summary.plannedRegularLabel)}</small>
            </article>
            <article>
              <span>Suplementarias</span>
              <strong>{metricValue(row.summary.supplementaryLabel)}</strong>
              <small>Plan. {metricValue(row.summary.plannedSupplementaryLabel)}</small>
            </article>
            <article>
              <span>Extraordinarias</span>
              <strong>{metricValue(row.summary.extraordinaryLabel)}</strong>
              <small>Plan. {metricValue(row.summary.plannedExtraordinaryLabel)}</small>
            </article>
            <article>
              <span>Atraso total</span>
              <strong>{metricValue(row.summary.lateLabel)}</strong>
              <small>{row.summary.lateDays || 0} dias con atraso</small>
            </article>
            <article>
              <span>Valor hora</span>
              <strong>{row.summary.hourlyRateLabel}</strong>
              <small>{row.summary.monthlyBaseHours || 0}h base del mes</small>
            </article>
          </div>

          <form className={`${styles.paymentPanel} ${payment?.isPaid ? styles.paymentPaid : ""}`} onSubmit={savePayment}>
            <div className={styles.paymentTitle}>
              <CheckCircle2 size={20} />
              <div>
                <span className={styles.eyebrow}>Pago de nómina</span>
                <h3>{payment?.isPaid ? "Pago registrado" : "Pendiente de registrar"}</h3>
                <p>
                  {payment?.isPaid
                    ? `${payment.paymentMethod || "Método no especificado"} · ${buildDateTimeLabel(payment.paidAt)}`
                    : `Valor a pagar: ${row.summary.salaryProjectedLabel}`}
                </p>
              </div>
            </div>

            <div className={styles.paymentFields}>
              <label>
                <span>Método de pago</span>
                <select
                  value={paymentForm.paymentMethod}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, paymentMethod: event.target.value }))}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>{method.label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.paymentNotes}>
                <span>Notas</span>
                <textarea
                  rows={3}
                  value={paymentForm.notes}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Ej. Transferencia enviada, pendiente comprobante, diferencia conciliada..."
                />
              </label>
            </div>

            {paymentError ? (
              <div className={styles.paymentError}>
                <AlertTriangle size={16} />
                {paymentError}
              </div>
            ) : null}

            <div className={styles.paymentActions}>
              <span>{payment?.isPaid ? `Registrado por ${payment.paidBy || "admin"}` : "El registro quedará guardado para auditoría."}</span>
              <button type="submit" disabled={isSavingPayment}>
                <Save size={16} />
                {isSavingPayment ? "Guardando..." : payment?.isPaid ? "Actualizar pago" : "Marcar como pagado"}
              </button>
            </div>
          </form>

          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.eyebrow}>Detalle del periodo</span>
              <h3>Dia por dia</h3>
            </div>
            <Link href={comparisonHref} className={styles.inlineLink}>
              Abrir autorizaciones
              <ArrowRight size={16} />
            </Link>
          </div>

          <div className={styles.tableShell}>
            <table>
              <thead>
                <tr>
                  <th>Dia</th>
                  <th>Plan</th>
                  <th>Picadas</th>
                  <th>Trabajado</th>
                  <th>Atraso</th>
                  <th>Adicional</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {row.days.map((day) => (
                  <tr key={day.dateKey} className={dayClassName(day)}>
                    <td>
                      <strong>{day.dayLabel}</strong>
                      <span>{day.dateLabel}</span>
                    </td>
                    <td>
                      <strong>{day.dayTypeLabel}</strong>
                      <span>
                        {day.startTime && day.endTime
                          ? `${day.startTime} - ${day.endTime}`
                          : day.plannedRegularLabel || "--"}
                      </span>
                    </td>
                    <td>
                      <strong>{day.punchCount || 0}</strong>
                      <span>{day.punches?.length ? day.punches.map((punch) => punch.time).join(" · ") : "Sin registros"}</span>
                    </td>
                    <td>
                      <strong>{day.workedLabel}</strong>
                      <span>Lab. {day.regularWorkedLabel}</span>
                    </td>
                    <td>
                      <strong>{day.lateMinutes ? `${day.lateMinutes}m` : "--"}</strong>
                      <span>{day.earlyLeaveMinutes ? `Salida ${day.earlyLeaveMinutes}m` : "Sin alerta"}</span>
                    </td>
                    <td>
                      <strong>Sup. {day.supplementaryLabel}</strong>
                      <span>Ext. {day.extraordinaryLabel}</span>
                    </td>
                    <td>
                      <strong>{day.pay?.totalLabel || "$0.00"}</strong>
                      <span>{day.authorization?.statusLabel || "Segun calculo"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {employeeId && !isLoadingReport && !row && !error ? (
        <div className={styles.emptyState}>
          <CalendarDays size={22} />
          No hay informacion calculada para este empleado en el mes seleccionado.
        </div>
      ) : null}
    </section>
  );
}
