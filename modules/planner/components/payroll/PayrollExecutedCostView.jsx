"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Building2, Clock3, DollarSign, Layers3, RefreshCw, Users } from "lucide-react";

import FloatingNotice from "@/components/ui/FloatingNotice";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { employeeDismissalLabel, isEmployeeDismissedInMonth } from "@/modules/company/submodules/people/lib/employees";
import { planningModulePath } from "@/modules/planner/routes";
import styles from "@/modules/planner/styles/components/payroll/PayrollExecutedCostView.module.scss";

function currentMonthKey() {
  return formatEcuadorMonthKey();
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatHours(value) {
  return `${new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 }).format(Number(value) || 0)} h`;
}

function readInitialFilters() {
  if (typeof window === "undefined") {
    return {
      monthKey: currentMonthKey(),
      branchCode: "",
      areaCode: "",
      roleCode: "",
    };
  }

  const params = new URLSearchParams(window.location.search);

  return {
    monthKey: params.get("month") || currentMonthKey(),
    branchCode: params.get("branchCode") || "",
    areaCode: params.get("areaCode") || "",
    roleCode: params.get("roleCode") || "",
  };
}

function syncUrl(filters) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams();
  params.set("month", filters.monthKey);
  if (filters.branchCode) params.set("branchCode", filters.branchCode);
  if (filters.areaCode) params.set("areaCode", filters.areaCode);
  if (filters.roleCode) params.set("roleCode", filters.roleCode);

  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function EmptyValue() {
  return <span className={styles.emptyValue}>-</span>;
}

function GroupTable({ title, icon: Icon, rows }) {
  return (
    <section className={styles.groupPanel}>
      <div className={styles.panelTitle}>
        <Icon size={18} />
        <h3>{title}</h3>
      </div>
      {rows.length ? (
        <div className={styles.groupList}>
          {rows.map((row) => (
            <article key={row.key || row.label} className={styles.groupRow}>
              <div>
                <strong>{row.label}</strong>
                <span>{row.employees} empleados</span>
              </div>
              <p>{formatMoney(row.totalCost)}</p>
              <small>
                {formatMoney(row.supplementaryCost)} sup. · {formatMoney(row.extraordinaryCost)} extra · {formatHours(row.lateHours)} atraso control
              </small>
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.emptyText}>No hay datos para este filtro.</p>
      )}
    </section>
  );
}

export default function PayrollExecutedCostView() {
  const router = useRouter();
  const [initialFilters] = useState(() => readInitialFilters());
  const [filters, setFilters] = useState(() => initialFilters);
  const [payload, setPayload] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const summary = payload?.summary || {};
  const rows = useMemo(() => payload?.rows || [], [payload?.rows]);
  const sortedRows = useMemo(() => [...rows].sort((left, right) => right.totalCost - left.totalCost), [rows]);
  const options = payload?.options || { branches: [], areas: [], roles: [] };
  const groups = [
    { title: "Por sucursal", icon: Building2, rows: payload?.groups?.branches || [] },
    { title: "Por area", icon: Layers3, rows: payload?.groups?.areas || [] },
    { title: "Por rol", icon: Users, rows: payload?.groups?.roles || [] },
  ];

  const clearNoticeTimers = useCallback(() => {
    if (noticeExitTimeoutRef.current) window.clearTimeout(noticeExitTimeoutRef.current);
    if (noticeRemoveTimeoutRef.current) window.clearTimeout(noticeRemoveTimeoutRef.current);
    noticeExitTimeoutRef.current = null;
    noticeRemoveTimeoutRef.current = null;
  }, []);

  const dismissNotice = useCallback(() => {
    clearNoticeTimers();
    setNotice((current) => (current ? { ...current, isLeaving: true } : null));
    noticeRemoveTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeRemoveTimeoutRef.current = null;
    }, 240);
  }, [clearNoticeTimers]);

  const showNotice = useCallback((type, message) => {
    clearNoticeTimers();
    setNotice({ type, message, isLeaving: false });
    noticeExitTimeoutRef.current = window.setTimeout(dismissNotice, 4000);
  }, [clearNoticeTimers, dismissNotice]);

  useEffect(() => () => {
    clearNoticeTimers();
  }, [clearNoticeTimers]);

  function updateFilters(nextValues) {
    const nextFilters = {
      ...filters,
      ...nextValues,
    };

    setFilters(nextFilters);
    syncUrl(nextFilters);
  }

  function openEmployeeSummary(row) {
    if (!row.employeeId) {
      return;
    }

    const params = new URLSearchParams();
    params.set("employeeId", row.employeeId);
    params.set("month", filters.monthKey);
    router.push(`${planningModulePath("/payroll/by-employee")}?${params.toString()}`);
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadExecutedCost() {
      setIsLoading(true);
      clearNoticeTimers();
      setNotice(null);

      try {
        const params = new URLSearchParams({ month: filters.monthKey });
        if (filters.branchCode) params.set("branchCode", filters.branchCode);
        if (filters.areaCode) params.set("areaCode", filters.areaCode);
        if (filters.roleCode) params.set("roleCode", filters.roleCode);

        const response = await fetch(`/api/planner/payroll/executed-cost?${params.toString()}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "No se pudo cargar el costo ejecutado.");
        }

        if (!isCancelled) {
          setPayload(data);
        }
      } catch (error) {
        if (!isCancelled) {
          setPayload(null);
          if (!String(error.message || "").includes("Primero guarda el cierre de mes")) {
            showNotice("error", error.message);
          }
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    loadExecutedCost();

    return () => {
      isCancelled = true;
    };
  }, [clearNoticeTimers, filters.areaCode, filters.branchCode, filters.monthKey, filters.roleCode, showNotice]);

  if (isLoading) {
    return (
      <section className={styles.loadingScene}>
        <div className={styles.skeletonFilters}>
          {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
        </div>
        <div className={styles.skeletonCards}>
          {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
        </div>
        <div className={styles.skeletonTable}>
          {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
        </div>
      </section>
    );
  }

  return (
    <div className={styles.layout}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />

      <section className={styles.toolbar}>
        <label>
          <span>Mes</span>
          <input
            type="month"
            value={filters.monthKey}
            onChange={(event) => updateFilters({ monthKey: event.target.value })}
            disabled={isLoading}
          />
        </label>
        <label>
          <span>Sucursal</span>
          <select
            value={filters.branchCode}
            onChange={(event) => updateFilters({ branchCode: event.target.value, areaCode: "", roleCode: "" })}
            disabled={isLoading}
          >
            <option value="">Todas</option>
            {options.branches.map((branch) => (
              <option key={branch.code} value={branch.code}>{branch.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Area</span>
          <select
            value={filters.areaCode}
            onChange={(event) => updateFilters({ areaCode: event.target.value, roleCode: "" })}
            disabled={isLoading}
          >
            <option value="">Todas</option>
            {options.areas.map((area) => (
              <option key={area.code} value={area.code}>{area.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Rol</span>
          <select
            value={filters.roleCode}
            onChange={(event) => updateFilters({ roleCode: event.target.value })}
            disabled={isLoading}
          >
            <option value="">Todos</option>
            {options.roles.map((role) => (
              <option key={role.code} value={role.code}>{role.name}</option>
            ))}
          </select>
        </label>
      </section>

      {!payload ? (
        <section className={styles.emptyState}>
          <AlertTriangle size={18} />
          Guarda primero el cierre de mes de asistencia para calcular el costo ejecutado.
        </section>
      ) : (
        <>
          <section className={styles.kpiGrid}>
            <article>
              <DollarSign size={18} />
              <span>Total ejecutado</span>
              <strong>{formatMoney(summary.totalCost)}</strong>
            </article>
            <article>
              <Users size={18} />
              <span>Empleados</span>
              <strong>{summary.employees || 0}</strong>
            </article>
            <article>
              <Clock3 size={18} />
              <span>Normales</span>
              <strong>{formatMoney(summary.normalCost)}</strong>
            </article>
            <article>
              <BarChart3 size={18} />
              <span>Suplementarias</span>
              <strong>{formatMoney(summary.supplementaryCost)}</strong>
            </article>
            <article>
              <RefreshCw size={18} />
              <span>Extraordinarias</span>
              <strong>{formatMoney(summary.extraordinaryCost)}</strong>
            </article>
          </section>

          <section className={styles.splitGrid}>
            {groups.map((group) => (
              <GroupTable key={group.title} title={group.title} icon={group.icon} rows={group.rows} />
            ))}
          </section>

          <section className={styles.tablePanel}>
            <div className={styles.tableHeader}>
              <h3>Detalle por empleado</h3>
              <span>Cierre v{payload.closure?.version || 1}</span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Estructura</th>
                    <th>Normales</th>
                    <th>Suplementarias</th>
                    <th>Extraordinarias</th>
                    <th>Atrasos</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => {
                    const isDismissed = isEmployeeDismissedInMonth(row, filters.monthKey);
                    const dismissalTitle = isDismissed ? employeeDismissalLabel(row) : undefined;

                    return (
                    <tr
                      key={row.employeeId}
                      className={`${styles.clickableRow} ${row.payment?.isPaid ? styles.paidRow : ""} ${isDismissed ? styles.dismissedRow : ""}`}
                      title={dismissalTitle}
                      onClick={() => openEmployeeSummary(row)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openEmployeeSummary(row);
                        }
                      }}
                      tabIndex={row.employeeId ? 0 : undefined}
                      role={row.employeeId ? "button" : undefined}
                      aria-label={`Ver resumen mensual de ${row.employeeName}`}
                    >
                      <td data-label="Empleado">
                        <strong>{row.employeeName}</strong>
                        <span>{row.branchName}</span>
                        {row.payment?.isPaid ? <em className={styles.paidBadge}>Pagado</em> : null}
                      </td>
                      <td data-label="Estructura">
                        <strong>{row.areaName}</strong>
                        <span>{row.roleName}</span>
                      </td>
                      <td data-label="Normales">
                        <strong>{formatMoney(row.normalCost)}</strong>
                        <span>{formatHours(row.normalHours)}</span>
                      </td>
                      <td data-label="Suplementarias">
                        {row.supplementaryHours ? (
                          <>
                            <strong>{formatMoney(row.supplementaryCost)}</strong>
                            <span>{formatHours(row.supplementaryHours)}</span>
                          </>
                        ) : <EmptyValue />}
                      </td>
                      <td data-label="Extraordinarias">
                        {row.extraordinaryHours ? (
                          <>
                            <strong>{formatMoney(row.extraordinaryCost)}</strong>
                            <span>{formatHours(row.extraordinaryHours)}</span>
                          </>
                        ) : <EmptyValue />}
                      </td>
                      <td data-label="Atrasos">
                        {row.lateHours ? (
                          <>
                            <strong>Control</strong>
                            <span>{formatHours(row.lateHours)}</span>
                          </>
                        ) : <EmptyValue />}
                      </td>
                      <td data-label="Total">
                        <strong>{formatMoney(row.totalCost)}</strong>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!rows.length ? <p className={styles.emptyText}>No hay datos para este filtro.</p> : null}
          </section>
        </>
      )}
    </div>
  );
}
