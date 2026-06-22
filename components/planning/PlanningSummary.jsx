"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Clock3, DollarSign, Plane, Settings2, SlidersHorizontal, Users } from "lucide-react";

import FloatingNotice from "@/components/ui/FloatingNotice";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { planningModulePath } from "@/lib/modules/planning/routes";
import styles from "./PlanningSummary.module.scss";

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
  const safeValue = Number(value) || 0;

  return `${new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 }).format(safeValue)} h`;
}

function buildUrl(filters) {
  const params = new URLSearchParams();

  if (filters.monthKey) params.set("month", filters.monthKey);
  if (filters.branchCode) params.set("branchCode", filters.branchCode);
  if (filters.areaCode) params.set("areaCode", filters.areaCode);
  if (filters.roleCode) params.set("roleCode", filters.roleCode);

  const query = params.toString();

  return `${planningModulePath("/planning")}${query ? `?${query}` : ""}`;
}

function emptyMoneySummary() {
  return {
    employees: 0,
    baseSalary: 0,
    supplementaryHours: 0,
    extraordinaryHours: 0,
    supplementaryCost: 0,
    extraordinaryCost: 0,
    variableCost: 0,
    estimatedSalary: 0,
    withSchedule: 0,
  };
}

function addRowToSummary(summary, row) {
  summary.employees += 1;
  summary.baseSalary += Number(row.salary) || 0;
  summary.supplementaryHours += Number(row.supplementaryHours) || 0;
  summary.extraordinaryHours += Number(row.extraordinaryHours) || 0;
  summary.supplementaryCost += Number(row.supplementaryCost) || 0;
  summary.extraordinaryCost += Number(row.extraordinaryCost) || 0;
  summary.variableCost += Number(row.variableCost) || 0;
  summary.estimatedSalary += Number(row.estimatedSalary) || 0;
  summary.withSchedule += row.hasSchedule ? 1 : 0;
  return summary;
}

const QUICK_LINKS = [
  {
    href: planningModulePath("/planning/monthly"),
    title: "Programacion de horarios",
    description: "Asignar y pegar horarios por semana.",
    icon: CalendarDays,
  },
  {
    href: planningModulePath("/planning/exceptions"),
    title: "Ajustes y excepciones",
    description: "Revisar permisos, novedades y palabras importadas.",
    icon: SlidersHorizontal,
  },
  {
    href: planningModulePath("/planning/time-off"),
    title: "Vacaciones programadas",
    description: "Registrar vacaciones antes de armar el horario.",
    icon: Plane,
  },
  {
    href: planningModulePath("/settings/base-schedules"),
    title: "Plantillas de horarios",
    description: "Mantener horarios base por area y rol.",
    icon: Settings2,
  },
];

export default function PlanningSummary({ initialFilters = {} }) {
  const router = useRouter();
  const [monthKey, setMonthKey] = useState(initialFilters.month || currentMonthKey());
  const [branchCode, setBranchCode] = useState(initialFilters.branchCode || "");
  const [areaCode, setAreaCode] = useState(initialFilters.areaCode || "");
  const [roleCode, setRoleCode] = useState(initialFilters.roleCode || "");
  const [payload, setPayload] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const rows = useMemo(() => payload?.rows || [], [payload?.rows]);
  const options = payload?.options || { branches: [], areas: [], roles: [] };
  const sortedRows = useMemo(
    () => [...rows].sort((left, right) =>
      right.estimatedSalary - left.estimatedSalary || left.employeeName.localeCompare(right.employeeName, "es"),
    ),
    [rows],
  );
  const summary = useMemo(
    () => rows.reduce((totals, row) => addRowToSummary(totals, row), emptyMoneySummary()),
    [rows],
  );
  const branchSummaries = useMemo(() => {
    const branches = new Map();

    rows.forEach((row) => {
      const branchKey = row.branchCode || row.branchName || "sin-sucursal";
      const branch = branches.get(branchKey) || {
        branchKey,
        branchName: row.branchName || "Sin sucursal",
        ...emptyMoneySummary(),
        areas: new Map(),
      };
      const areaKey = row.areaCode || row.areaName || "sin-area";
      const area = branch.areas.get(areaKey) || {
        areaKey,
        areaName: row.areaName || "Sin area",
        ...emptyMoneySummary(),
      };

      addRowToSummary(branch, row);
      addRowToSummary(area, row);
      branch.areas.set(areaKey, area);
      branches.set(branchKey, branch);
    });

    return [...branches.values()]
      .map((branch) => ({
        ...branch,
        areas: [...branch.areas.values()].sort((left, right) =>
          right.estimatedSalary - left.estimatedSalary || left.areaName.localeCompare(right.areaName, "es"),
        ),
      }))
      .sort((left, right) =>
        right.estimatedSalary - left.estimatedSalary || left.branchName.localeCompare(right.branchName, "es"),
      );
  }, [rows]);

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
    }), { scroll: false });
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadSummary() {
      setIsLoading(true);

      try {
        const params = new URLSearchParams({ month: monthKey });

        if (branchCode) params.set("branchCode", branchCode);
        if (areaCode) params.set("areaCode", areaCode);
        if (roleCode) params.set("roleCode", roleCode);

        const response = await fetch(`/api/planning/summary?${params.toString()}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "No se pudo cargar el resumen de planificacion.");
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

    loadSummary();

    return () => {
      isCancelled = true;
      clearNoticeTimers();
    };
  }, [areaCode, branchCode, clearNoticeTimers, monthKey, roleCode, showNotice]);

  return (
    <div className={styles.stack}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarIntro}>
            <p className={styles.eyebrow}>Resumen</p>
            <h2>Planificacion mensual</h2>
            <p>Consulta el costo aproximado del mes con sueldos base, suplementarias y horas extra planificadas.</p>
          </div>
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
        </div>
      </section>

      <section className={styles.summaryGrid}>
        {isLoading ? (
          Array.from({ length: 5 }, (_, index) => (
            <article key={index} className={styles.metricSkeleton}>
              <span className={styles.skeletonShort} />
              <span className={styles.skeletonValue} />
            </article>
          ))
        ) : (
          <>
            <article>
              <Users size={18} />
              <span>Empleados</span>
              <strong>{summary.employees || 0}</strong>
              <small>{summary.withSchedule || 0} con horario variable</small>
            </article>
            <article>
              <Clock3 size={18} />
              <span>Suplementarias</span>
              <strong>{formatHours(summary.supplementaryHours)}</strong>
              <small>{formatMoney(summary.supplementaryCost)} aprox.</small>
            </article>
            <article>
              <Clock3 size={18} />
              <span>Horas extra</span>
              <strong>{formatHours(summary.extraordinaryHours)}</strong>
              <small>{formatMoney(summary.extraordinaryCost)} aprox.</small>
            </article>
            <article>
              <DollarSign size={18} />
              <span>Costo variable</span>
              <strong>{formatMoney(summary.variableCost)}</strong>
              <small>Sup. + extra</small>
            </article>
            <article>
              <DollarSign size={18} />
              <span>Sueldo aprox.</span>
              <strong>{formatMoney(summary.estimatedSalary)}</strong>
              <small>Base {formatMoney(summary.baseSalary)}</small>
            </article>
          </>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.tableHeader}>
          <div>
            <h3>Sueldos por sucursal y area</h3>
            <p>{isLoading ? "Cargando..." : `${branchSummaries.length} sucursales en la vista`}</p>
          </div>
        </div>

        {isLoading ? (
          <div className={styles.areaSkeleton} aria-label="Cargando sueldos por area">
            {Array.from({ length: 4 }, (_, index) => (
              <span key={index} className={styles.skeletonCell} />
            ))}
          </div>
        ) : branchSummaries.length ? (
          <div className={styles.branchStack}>
            {branchSummaries.map((branch) => (
              <div key={branch.branchKey} className={styles.branchGroup}>
                <div className={styles.branchHeader}>
                  <div>
                    <strong>{branch.branchName}</strong>
                    <span>{branch.employees} empleados</span>
                  </div>
                  <div>
                    <span>Base {formatMoney(branch.baseSalary)}</span>
                    <strong>{formatMoney(branch.estimatedSalary)}</strong>
                  </div>
                </div>
                <div className={styles.areaGrid}>
                  {branch.areas.map((area) => (
                    <article key={`${branch.branchKey}-${area.areaKey}`}>
                      <div>
                        <strong>{area.areaName}</strong>
                        <span>{area.employees} empleados</span>
                      </div>
                      <dl>
                        <div>
                          <dt>Base</dt>
                          <dd>{formatMoney(area.baseSalary)}</dd>
                        </div>
                        <div>
                          <dt>Variable</dt>
                          <dd>{formatMoney(area.variableCost)}</dd>
                        </div>
                        <div>
                          <dt>Aprox.</dt>
                          <dd>{formatMoney(area.estimatedSalary)}</dd>
                        </div>
                      </dl>
                      <small>{formatHours(area.supplementaryHours)} supl. · {formatHours(area.extraordinaryHours)} extra</small>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>No hay areas para esta vista.</strong>
            <span>Cambia los filtros o muestra todos los empleados.</span>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.tableHeader}>
          <div>
            <h3>Empleados</h3>
            <p>{isLoading ? "Cargando..." : `${sortedRows.length} empleados en el filtro`}</p>
          </div>
        </div>

        {isLoading ? (
          <div className={styles.tableSkeleton} aria-label="Cargando resumen">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className={styles.skeletonRow}>
                <span className={styles.skeletonCell} />
                <span className={styles.skeletonCell} />
                <span className={styles.skeletonCell} />
                <span className={styles.skeletonPill} />
                <span className={styles.skeletonCell} />
              </div>
            ))}
          </div>
        ) : sortedRows.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Estructura</th>
                  <th>Suplementarias</th>
                  <th>Extras</th>
                  <th>Variable</th>
                  <th>Sueldo aprox.</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.employeeId}>
                    <td>
                      <strong>{row.employeeName}</strong>
                      <span>{row.employeeDni || "Sin DNI"}</span>
                    </td>
                    <td>
                      <strong>{row.branchName}</strong>
                      <span>{[row.areaName, row.roleName].filter(Boolean).join(" / ")}</span>
                    </td>
                    <td>
                      <strong>{formatHours(row.supplementaryHours)}</strong>
                      <span>{formatMoney(row.supplementaryCost)}</span>
                    </td>
                    <td>
                      <strong>{formatHours(row.extraordinaryHours)}</strong>
                      <span>{formatMoney(row.extraordinaryCost)}</span>
                    </td>
                    <td>{formatMoney(row.variableCost)}</td>
                    <td>
                      <strong>{formatMoney(row.estimatedSalary)}</strong>
                      <span>Base {formatMoney(row.salary)}</span>
                    </td>
                    <td>
                      <span className={row.hasSchedule ? styles.readyPill : styles.basePill}>{row.statusLabel}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>No hay empleados para este filtro.</strong>
            <span>Cambia la sucursal, area o rol para revisar otro grupo.</span>
          </div>
        )}
      </section>

      <section className={styles.quickGrid}>
        {QUICK_LINKS.map((item) => {
          const Icon = item.icon;

          return (
            <Link key={item.href} href={item.href}>
              <Icon size={18} />
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
