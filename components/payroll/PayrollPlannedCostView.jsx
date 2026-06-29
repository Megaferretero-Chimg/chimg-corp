"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BarChart3, Building2, Clock3, DollarSign, Layers3, Users } from "lucide-react";

import FloatingNotice from "@/components/ui/FloatingNotice";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { employeeDismissalLabel, isEmployeeDismissedInMonth } from "@/lib/employees";
import { planningModulePath } from "@/lib/modules/planning/routes";
import styles from "./PayrollPlannedCostView.module.scss";

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

function buildUrl(filters, mode = "overview") {
  const params = new URLSearchParams();

  if (filters.monthKey) {
    params.set("month", filters.monthKey);
  }

  if (filters.branchCode) {
    params.set("branchCode", filters.branchCode);
  }

  if (filters.areaCode) {
    params.set("areaCode", filters.areaCode);
  }

  if (filters.roleCode) {
    params.set("roleCode", filters.roleCode);
  }

  const query = params.toString();
  const pathname = mode === "analysis"
    ? planningModulePath("/payroll/planned-cost/analysis")
    : planningModulePath("/payroll/planned-cost");

  return `${pathname}${query ? `?${query}` : ""}`;
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
                {formatMoney(row.supplementaryCost)} sup. · {formatMoney(row.extraordinaryCost)} extra
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

export default function PayrollPlannedCostView({ initialFilters = {}, mode = "overview" }) {
  const router = useRouter();
  const isAnalysis = mode === "analysis";
  const [monthKey, setMonthKey] = useState(initialFilters.month || currentMonthKey());
  const [branchCode, setBranchCode] = useState(isAnalysis ? initialFilters.branchCode || "" : "");
  const [areaCode, setAreaCode] = useState(isAnalysis ? initialFilters.areaCode || "" : "");
  const [roleCode, setRoleCode] = useState(isAnalysis ? initialFilters.roleCode || "" : "");
  const [payload, setPayload] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const summary = payload?.summary || {};
  const rows = useMemo(() => payload?.rows || [], [payload?.rows]);
  const options = payload?.options || { branches: [], areas: [], roles: [] };

  const sortedRows = useMemo(
    () => [...rows].sort((left, right) => right.totalCost - left.totalCost),
    [rows],
  );
  const visibleGroups = useMemo(() => {
    if (!isAnalysis) {
      return [
        { title: "Por sucursal", icon: Building2, rows: payload?.groups?.branches || [] },
        { title: "Por area", icon: Layers3, rows: payload?.groups?.areas || [] },
        { title: "Por rol", icon: Users, rows: payload?.groups?.roles || [] },
      ];
    }

    if (!branchCode) {
      return [{ title: "Por sucursal", icon: Building2, rows: payload?.groups?.branches || [] }];
    }

    if (!areaCode) {
      return [{ title: "Areas de la sucursal", icon: Layers3, rows: payload?.groups?.areas || [] }];
    }

    if (!roleCode) {
      return [{ title: "Roles del area", icon: Users, rows: payload?.groups?.roles || [] }];
    }

    return [];
  }, [areaCode, branchCode, isAnalysis, payload?.groups?.areas, payload?.groups?.branches, payload?.groups?.roles, roleCode]);

  const clearNoticeTimers = useCallback(() => {
    if (noticeExitTimeoutRef.current) {
      window.clearTimeout(noticeExitTimeoutRef.current);
      noticeExitTimeoutRef.current = null;
    }

    if (noticeRemoveTimeoutRef.current) {
      window.clearTimeout(noticeRemoveTimeoutRef.current);
      noticeRemoveTimeoutRef.current = null;
    }
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
    noticeExitTimeoutRef.current = window.setTimeout(() => {
      dismissNotice();
    }, 4000);
  }, [clearNoticeTimers, dismissNotice]);

  function replaceFilters(nextFilters) {
    router.replace(buildUrl({
      monthKey,
      branchCode,
      areaCode,
      roleCode,
      ...nextFilters,
    }, mode), { scroll: false });
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadPlannedCost() {
      setIsLoading(true);

      try {
        const params = new URLSearchParams({ month: monthKey });

        if (isAnalysis && branchCode) {
          params.set("branchCode", branchCode);
        }

        if (isAnalysis && areaCode) {
          params.set("areaCode", areaCode);
        }

        if (isAnalysis && roleCode) {
          params.set("roleCode", roleCode);
        }

        const response = await fetch(`/api/payroll/planned-cost?${params.toString()}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "No se pudo cargar el costo planificado.");
        }

        if (!isCancelled) {
          setPayload(data);
        }
      } catch (error) {
        if (!isCancelled) {
          showNotice("error", error.message);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    loadPlannedCost();

    return () => {
      isCancelled = true;
      clearNoticeTimers();
    };
  }, [areaCode, branchCode, clearNoticeTimers, isAnalysis, monthKey, roleCode, showNotice]);

  if (isLoading) {
    return (
      <section className={styles.loadingScene}>
        <div className={styles.skeletonFilters}>
          {Array.from({ length: isAnalysis ? 4 : 2 }, (_, index) => <span key={index} />)}
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

      {isAnalysis ? (
        <div className={styles.returnBar}>
          <Link href={buildUrl({ monthKey }, "overview")} className={styles.returnButton}>
            <ArrowLeft size={16} />
            Volver al resumen
          </Link>
        </div>
      ) : null}

      <section className={`${styles.toolbar} ${isAnalysis ? styles.toolbarAnalysis : styles.toolbarOverview}`}>
        <label>
          <span>Mes</span>
          <input
            type="month"
            value={monthKey}
            onChange={(event) => {
              setMonthKey(event.target.value);
              replaceFilters({ monthKey: event.target.value });
            }}
          />
        </label>
        {isAnalysis ? (
          <>
            <label>
              <span>Sucursal</span>
              <select
                value={branchCode}
                onChange={(event) => {
                  setBranchCode(event.target.value);
                  setAreaCode("");
                  setRoleCode("");
                  replaceFilters({ branchCode: event.target.value, areaCode: "", roleCode: "" });
                }}
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
                value={areaCode}
                onChange={(event) => {
                  setAreaCode(event.target.value);
                  setRoleCode("");
                  replaceFilters({ areaCode: event.target.value, roleCode: "" });
                }}
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
                value={roleCode}
                onChange={(event) => {
                  setRoleCode(event.target.value);
                  replaceFilters({ roleCode: event.target.value });
                }}
              >
                <option value="">Todos</option>
                {options.roles.map((role) => (
                  <option key={role.code} value={role.code}>{role.name}</option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <Link href={buildUrl({ monthKey }, "analysis")} className={styles.analysisLink}>
            Analizar con filtros
            <ArrowRight size={16} />
          </Link>
        )}
      </section>

      <section className={styles.kpiGrid}>
        <article>
          <DollarSign size={18} />
          <span>Total planificado</span>
          <strong>{formatMoney(summary.totalCost)}</strong>
        </article>
        <article>
          <Users size={18} />
          <span>Empleados</span>
          <strong>{summary.employees || 0}</strong>
        </article>
        <article>
          <Layers3 size={18} />
          <span>Sueldo base</span>
          <strong>{formatMoney(summary.baseCost)}</strong>
        </article>
        <article>
          <Clock3 size={18} />
          <span>Suplementarias</span>
          <strong>{formatMoney(summary.supplementaryCost)}</strong>
        </article>
        <article>
          <BarChart3 size={18} />
          <span>Extraordinarias</span>
          <strong>{formatMoney(summary.extraordinaryCost)}</strong>
        </article>
      </section>

      <section className={styles.splitGrid}>
        {visibleGroups.map((group) => (
          <GroupTable key={group.title} title={group.title} icon={group.icon} rows={group.rows} />
        ))}
      </section>

      {isAnalysis ? (
        <section className={styles.tablePanel}>
        <div className={styles.tableHeader}>
          <h3>Detalle por empleado</h3>
          <span>{formatHours(summary.supplementaryHours)} sup. · {formatHours(summary.extraordinaryHours)} extra</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Estructura</th>
                <th>Sueldo</th>
                <th>Suplementarias</th>
                <th>Extraordinarias</th>
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
                  className={isDismissed ? styles.dismissedRow : ""}
                  title={dismissalTitle}
                >
                  <td data-label="Empleado">
                    <strong>{row.employeeName}</strong>
                    <span>{row.branchName}</span>
                  </td>
                  <td data-label="Estructura">
                    <strong>{row.areaName}</strong>
                    <span>{row.roleName}</span>
                  </td>
                  <td data-label="Sueldo">{formatMoney(row.baseCost)}</td>
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
                  <td data-label="Total">
                    <strong>{formatMoney(row.totalCost)}</strong>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length ? <p className={styles.emptyText}>No hay horarios planificados para este filtro.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
