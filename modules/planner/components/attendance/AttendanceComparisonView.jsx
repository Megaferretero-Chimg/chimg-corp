"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import EmployeeAutocomplete from "@/components/ui/EmployeeAutocomplete";
import SelectInput from "@/components/ui/SelectInput";
import { formatPayrollDefaultMonthKey } from "@/lib/datetime/ecuador";
import { employeeDismissalLabel, isEmployeeActiveInMonth, isEmployeeDismissedInMonth } from "@/modules/company/submodules/people/lib/employees";
import { planningModulePath } from "@/modules/planner/routes";
import { calculatePayrollAdditionalRate } from "@/modules/planner/lib/payroll/rates";
import styles from "@/modules/planner/styles/components/attendance/AttendanceComparisonView.module.scss";

function defaultMonthKey() {
  return formatPayrollDefaultMonthKey();
}

function readInitialFilters() {
  if (typeof window === "undefined") {
    return {
      month: defaultMonthKey(),
      branchCode: "",
      areaCode: "",
      roleCode: "",
      employeeId: "",
      onlyIssues: false,
    };
  }

  const params = new URLSearchParams(window.location.search);

  return {
    month: params.get("month") || defaultMonthKey(),
    branchCode: params.get("branchCode") || "",
    areaCode: params.get("areaCode") || "",
    roleCode: params.get("roleCode") || "",
    employeeId: params.get("employeeId") || "",
    onlyIssues: params.get("onlyIssues") === "1",
  };
}

function syncUrl(filters) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams();
  params.set("month", filters.month);

  if (filters.branchCode) params.set("branchCode", filters.branchCode);
  if (filters.areaCode) params.set("areaCode", filters.areaCode);
  if (filters.roleCode) params.set("roleCode", filters.roleCode);
  if (filters.employeeId) params.set("employeeId", filters.employeeId);
  if (filters.onlyIssues) params.set("onlyIssues", "1");

  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function minutesBadge(value) {
  return value && value !== "0m" ? value : "--";
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

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function operationalAlertCount(summary = {}) {
  if (summary.pendingOperationalAlertDays !== undefined) {
    return Number(summary.pendingOperationalAlertDays) || 0;
  }

  if (summary.operationalAlertDays !== undefined) {
    return Number(summary.operationalAlertDays) || 0;
  }

  if (summary.issueDays !== undefined) {
    return Number(summary.issueDays) || 0;
  }

  return (
    (Number(summary.absentDays) || 0) +
    (Number(summary.incompletePunchDays ?? summary.missingPunchDays) || 0) +
    (Number(summary.extraPunchDays) || 0) +
    (Number(summary.unplannedWorkDays) || 0)
  );
}

function hasControlBlockingAlert(day = {}) {
  const tags = (day.tags || []).map((tag) => {
    if (tag === "Falta almuerzo") return "Picadas incompletas";
    if (tag === "Tiempo adicional sin justificar") return "Tiempo adicional";
    return tag;
  });

  return tags.some((tag) => [
    "Sin picadas",
    "Picadas incompletas",
    "Picadas de más",
    "No planificado",
    "Trabajo sin horario",
  ].includes(tag));
}

function hasFinalControlDecision(day = {}) {
  return day.authorization?.isSaved === true &&
    day.authorization?.source !== "operational_exception";
}

function hasControlLateIssue(day = {}) {
  if (hasControlBlockingAlert(day)) return false;
  if (hasFinalControlDecision(day)) return false;
  if (day.authorization?.decision === "reviewed") return false;

  return (Number(day.lateMinutes) || 0) > 0 ||
    (Number(day.entryLateMinutes) || 0) > 0 ||
    (Number(day.lunchOverageMinutes ?? day.lunchOverageRemainderMinutes) || 0) > 0 ||
    (Number(day.earlyLeaveMinutes) || 0) > 0;
}

function hasControlAdditionalIssue(day = {}) {
  if (hasControlBlockingAlert(day) || hasControlLateIssue(day)) return false;
  if (hasFinalControlDecision(day)) return false;

  if ((day.tags || []).includes("Tiempo adicional")) return true;

  const hasPlannedTime =
    (Number(day.plannedRegularMinutes) || 0) > 0 ||
    (Number(day.plannedSupplementaryMinutes) || 0) > 0 ||
    (Number(day.plannedExtraordinaryMinutes) || 0) > 0 ||
    (Number(day.scheduledWorkedMinutes) || 0) > 0;
  const toleranceMinutes = hasPlannedTime
    ? Math.max(0, Number(day.lateDepartureToleranceMinutes ?? 20) || 0)
    : 0;
  const pendingSupplementaryMinutes = Math.max(
    Number(day.additionalSupplementaryMinutes) || 0,
    (Number(day.detectedSupplementaryMinutes) || 0) - (Number(day.supplementaryMinutes) || 0),
  );
  const pendingExtraordinaryMinutes = Math.max(
    0,
    (Number(day.detectedExtraordinaryMinutes) || 0) - (Number(day.extraordinaryMinutes) || 0),
  );

  return Math.max(pendingSupplementaryMinutes, pendingExtraordinaryMinutes) > toleranceMinutes;
}

function pendingUnfulfilledDaysCount(row = {}) {
  if (row.summary?.pendingLateDays !== undefined) {
    return Number(row.summary.pendingLateDays) || 0;
  }

  return (row.days || []).filter(hasControlLateIssue).length;
}

function additionalTimeCount(row = {}) {
  if (row.summary?.pendingAdditionalDays !== undefined) {
    return Number(row.summary.pendingAdditionalDays) || 0;
  }

  if (Array.isArray(row.days)) {
    return row.days.filter(hasControlAdditionalIssue).length;
  }

  return (Number(row.summary?.additionalSupplementaryMinutes) || 0) > 0 ? 1 : 0;
}

function MetricColumn({ label, value, tone = "neutral" }) {
  return (
    <span className={`${styles.metricItem} ${styles[`metricItem_${tone}`]}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function ControlCounter({ label, value, tone = "neutral" }) {
  return (
    <div className={`${styles.controlCounter} ${styles[`controlCounter_${tone}`]}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function FlatMetric({ label, value }) {
  return (
    <span className={styles.flatMetric}>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

export default function AttendanceComparisonView() {
  const router = useRouter();
  const [initialFilters] = useState(() => readInitialFilters());
  const initialFiltersRef = useRef(initialFilters);
  const [filters, setFilters] = useState(() => initialFilters);
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [rows, setRows] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [isLoadingCatalogs, setIsLoadingCatalogs] = useState(true);
  const [isLoadingComparison, setIsLoadingComparison] = useState(true);
  const [error, setError] = useState("");
  const isFilterDisabled = isLoadingCatalogs || isLoadingComparison;
  const comparableEmployees = useMemo(
    () => employees.filter((employee) => employee.punchesAffectHours !== false),
    [employees],
  );

  const filteredEmployees = useMemo(
    () =>
      comparableEmployees.filter((employee) => {
        if (!isEmployeeActiveInMonth(employee, filters.month)) return false;
        if (filters.branchCode && employee.branchCode !== filters.branchCode) return false;
        if (filters.areaCode && employee.areaCode !== filters.areaCode) return false;
        if (filters.roleCode && employee.roleCode !== filters.roleCode) return false;
        return true;
      }),
    [comparableEmployees, filters.areaCode, filters.branchCode, filters.month, filters.roleCode],
  );

  const areaOptions = useMemo(() => {
    const options = new Map();

    comparableEmployees.forEach((employee) => {
      if (!isEmployeeActiveInMonth(employee, filters.month)) return;
      if (filters.branchCode && employee.branchCode !== filters.branchCode) return;
      if (employee.areaCode) options.set(employee.areaCode, employee.areaName || employee.areaCode);
    });

    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1], "es"));
  }, [comparableEmployees, filters.branchCode, filters.month]);

  const roleOptions = useMemo(() => {
    const options = new Map();

    comparableEmployees.forEach((employee) => {
      if (!isEmployeeActiveInMonth(employee, filters.month)) return;
      if (filters.branchCode && employee.branchCode !== filters.branchCode) return;
      if (filters.areaCode && employee.areaCode !== filters.areaCode) return;
      if (employee.roleCode) options.set(employee.roleCode, employee.roleName || employee.roleCode);
    });

    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1], "es"));
  }, [comparableEmployees, filters.areaCode, filters.branchCode, filters.month]);

  const visibleRows = useMemo(
    () => {
      const search = normalizeSearch(employeeSearch);

      return rows.filter((row) => {
        if (filters.onlyIssues && operationalAlertCount(row.summary) <= 0) return false;
        if (filters.employeeId) return row.employee?.id === filters.employeeId;
        if (!search) return true;

        return normalizeSearch(row.employee?.fullName).includes(search);
      });
    },
    [employeeSearch, filters.employeeId, filters.onlyIssues, rows],
  );
  const hasActiveResultFilter = Boolean(
    filters.branchCode ||
    filters.areaCode ||
    filters.roleCode ||
    filters.employeeId ||
    filters.onlyIssues ||
    normalizeSearch(employeeSearch),
  );
  const groupedRows = useMemo(() => {
    const groups = new Map();

    visibleRows.forEach((row) => {
      const key = row.employee?.areaCode || "SIN_AREA";
      const label = row.employee?.areaName || "Sin área";

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label,
          rows: [],
        });
      }

      groups.get(key).rows.push(row);
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        rows: [...group.rows].sort((left, right) =>
          String(left.employee?.fullName || "").localeCompare(String(right.employee?.fullName || ""), "es"),
        ),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "es"));
  }, [visibleRows]);
  const summaryCounters = useMemo(() => {
    const totals = visibleRows.reduce((accumulator, row) => {
      const supplementaryMinutes = minutes(row.summary?.supplementaryMinutes);
      const extraordinaryMinutes = minutes(row.summary?.extraordinaryMinutes);
      const hourlyRate = Number(row.summary?.hourlyRateRaw) || 0;
      const supplementaryMultiplier = Number(row.summary?.supplementaryMultiplier) || 1.5;
      const extraordinaryMultiplier = Number(row.summary?.extraordinaryMultiplier) || 2;
      const plannedSalary = Number(row.summary?.salaryPlanned) || 0;
      const approvedSalary = Number(row.summary?.salaryApproved ?? row.summary?.salaryProjected) || 0;

      accumulator.supplementaryMinutes += supplementaryMinutes;
      accumulator.extraordinaryMinutes += extraordinaryMinutes;
      accumulator.supplementaryValue += (supplementaryMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, supplementaryMultiplier);
      accumulator.extraordinaryValue += (extraordinaryMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, extraordinaryMultiplier);
      accumulator.excessValue += Math.max(0, approvedSalary - plannedSalary);
      accumulator.salaryPlanned += plannedSalary;
      accumulator.salaryApproved += approvedSalary;
      accumulator.salaryTotal += approvedSalary;
      return accumulator;
    }, {
      supplementaryMinutes: 0,
      extraordinaryMinutes: 0,
      supplementaryValue: 0,
      extraordinaryValue: 0,
      excessValue: 0,
      salaryPlanned: 0,
      salaryApproved: 0,
      salaryTotal: 0,
    });

    return {
      ...totals,
      supplementaryLabel: formatMinutes(totals.supplementaryMinutes),
      extraordinaryLabel: formatMinutes(totals.extraordinaryMinutes),
      supplementaryValueLabel: moneyLabel(totals.supplementaryValue),
      extraordinaryValueLabel: moneyLabel(totals.extraordinaryValue),
      excessValueLabel: moneyLabel(totals.excessValue),
      salaryPlannedLabel: moneyLabel(totals.salaryPlanned),
      salaryApprovedLabel: moneyLabel(totals.salaryApproved),
      salaryTotalLabel: moneyLabel(totals.salaryTotal),
    };
  }, [visibleRows]);

  const selectedEmployeeName = useMemo(
    () => comparableEmployees.find((employee) => employee.id === filters.employeeId)?.fullName || "",
    [comparableEmployees, filters.employeeId],
  );

  function updateFilters(nextValues) {
    const nextFilters = {
      ...filters,
      ...nextValues,
    };

    setFilters(nextFilters);
    syncUrl(nextFilters);

    const shouldReload = ["month", "branchCode", "areaCode", "roleCode"].some((key) =>
      Object.prototype.hasOwnProperty.call(nextValues, key),
    );

    if (shouldReload) {
      loadComparison(nextFilters);
    }
  }

  const loadCatalogs = useCallback(async () => {
    try {
      setIsLoadingCatalogs(true);
      const [employeesResponse, branchesResponse] = await Promise.all([
        fetch("/api/company/employees?view=attendance-comparison"),
        fetch("/api/company/branches"),
      ]);
      const [employeesPayload, branchesPayload] = await Promise.all([
        employeesResponse.json(),
        branchesResponse.json(),
      ]);

      if (!employeesResponse.ok) {
        throw new Error(employeesPayload.error || "No se pudieron cargar los empleados.");
      }

      if (!branchesResponse.ok) {
        throw new Error(branchesPayload.error || "No se pudieron cargar las sucursales.");
      }

      setEmployees(employeesPayload.employees || []);
      setBranches(branchesPayload.branches || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsLoadingCatalogs(false);
    }
  }, []);

  const loadComparison = useCallback(async (nextFilters) => {
    try {
      setIsLoadingComparison(true);
      setError("");

      const targetFilters = nextFilters || initialFiltersRef.current;
      const params = new URLSearchParams();
      params.set("month", targetFilters.month);
      params.set("summaryOnly", "1");

      if (targetFilters.branchCode) params.set("branchCode", targetFilters.branchCode);
      if (targetFilters.areaCode) params.set("areaCode", targetFilters.areaCode);
      if (targetFilters.roleCode) params.set("roleCode", targetFilters.roleCode);

      const response = await fetch(`/api/planner/attendance/comparison?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo comparar la asistencia.");
      }

      setRows(payload.rows || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsLoadingComparison(false);
    }
  }, []);

  function handleFilterChange(key, value) {
    const nextValues = { [key]: value };

    if (key === "branchCode") {
      nextValues.areaCode = "";
      nextValues.roleCode = "";
      nextValues.employeeId = "";
      setEmployeeSearch("");
    }

    if (key === "areaCode") {
      nextValues.roleCode = "";
      nextValues.employeeId = "";
      setEmployeeSearch("");
    }

    if (key === "roleCode") {
      nextValues.employeeId = "";
      setEmployeeSearch("");
    }

    updateFilters(nextValues);
  }

  function handleEmployeeSearchChange(value) {
    setEmployeeSearch(value);
  }

  function selectEmployee(employee) {
    setEmployeeSearch(employee?.fullName || "");
    updateFilters({ employeeId: employee?.id || "" });
  }

  function buildEmployeeReportHref(employeeId) {
    const params = new URLSearchParams();
    params.set("month", filters.month);

    if (filters.branchCode) params.set("branchCode", filters.branchCode);
    if (filters.areaCode) params.set("areaCode", filters.areaCode);
    if (filters.roleCode) params.set("roleCode", filters.roleCode);
    if (filters.onlyIssues) params.set("onlyIssues", "1");

    return `${planningModulePath(`/attendance/comparison/${employeeId}`)}?${params.toString()}`;
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadCatalogs();
      loadComparison(initialFiltersRef.current);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadCatalogs, loadComparison]);

  function renderComparisonRows(rowsToRender) {
    return rowsToRender.map((row) => {
      const isDismissed = isEmployeeDismissedInMonth(row.employee, filters.month);
      const dismissalTitle = isDismissed ? employeeDismissalLabel(row.employee) : undefined;

      return (
        <tr
          key={row.employee.id}
          className={`${styles.clickableRow} ${isDismissed ? styles.dismissedRow : ""}`}
          title={dismissalTitle}
          role="button"
          tabIndex={0}
          onClick={() => router.push(buildEmployeeReportHref(row.employee.id))}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              router.push(buildEmployeeReportHref(row.employee.id));
            }
          }}
        >
          <td>
            <strong>{row.employee.fullName}</strong>
            <span>{row.employee.branchName} · {row.employee.areaName} · {row.employee.roleName}</span>
          </td>
          <td>
            <div className={styles.controlCounters}>
              <ControlCounter label="Alertas" value={operationalAlertCount(row.summary)} tone="danger" />
              <ControlCounter label="Faltantes" value={pendingUnfulfilledDaysCount(row)} tone="warning" />
              <ControlCounter label="Adicional" value={additionalTimeCount(row)} tone="additional" />
            </div>
          </td>
          <td>
            <div className={styles.flatMetrics}>
              <FlatMetric label="Planificado" value={minutesBadge(row.summary.regularTargetLabel || row.summary.plannedRegularLabel)} />
              <FlatMetric label="Registrado" value={minutesBadge(row.summary.regularWorkedLabel)} />
            </div>
          </td>
          <td>
            <div className={styles.flatMetrics}>
              <FlatMetric label="Planificado" value={minutesBadge(row.summary.plannedSupplementaryLabel)} />
              <FlatMetric label="Registrado" value={minutesBadge(row.summary.supplementaryLabel)} />
            </div>
          </td>
          <td>
            <div className={styles.flatMetrics}>
              <FlatMetric label="Planificado" value={minutesBadge(row.summary.plannedExtraordinaryLabel)} />
              <FlatMetric label="Registrado" value={minutesBadge(row.summary.extraordinaryLabel)} />
            </div>
          </td>
          <td>
            <div className={styles.flatMetrics}>
              <FlatMetric label="Planificado" value={row.summary.salaryPlannedLabel} />
              <FlatMetric label="Aprobado" value={row.summary.salaryApprovedLabel || row.summary.salaryProjectedLabel} />
            </div>
          </td>
        </tr>
      );
    });
  }

  function renderComparisonTable(rowsToRender, emptyText) {
    if (!rowsToRender.length) {
      return (
        <div className={`${styles.tableShell} ${isLoadingComparison ? styles.tableLoading : ""}`}>
          {isLoadingComparison ? <span className={styles.loadingRail} aria-hidden="true" /> : null}
          <div className={styles.emptyTableState}>{emptyText}</div>
        </div>
      );
    }

    return (
      <div className={`${styles.tableShell} ${isLoadingComparison ? styles.tableLoading : ""}`}>
        {isLoadingComparison ? <span className={styles.loadingRail} aria-hidden="true" /> : null}
        <div className={styles.tableScroller}>
          <table>
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Control</th>
                <th>Horas laborables</th>
                <th>Suplementarias</th>
                <th>Extraordinarias</th>
                <th>Sueldo</th>
              </tr>
            </thead>
            <tbody>
              {renderComparisonRows(rowsToRender)}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.filterGrid}>
          <label>
            <span>Mes</span>
            <input
              type="month"
              value={filters.month}
              onChange={(event) => handleFilterChange("month", event.target.value)}
              disabled={isFilterDisabled}
            />
          </label>

          <SelectInput
            label="Sucursal"
            value={filters.branchCode}
            onChange={(event) => handleFilterChange("branchCode", event.target.value)}
            disabled={isFilterDisabled}
            className={styles.selectField}
            labelClassName={styles.filterLabel}
            controlClassName={styles.selectControl}
            selectClassName={styles.selectButton}
          >
              <option value="">Todas</option>
              {branches.map((branch) => (
                <option key={branch.id || branch.code} value={branch.code}>
                  {branch.name || branch.code}
                </option>
              ))}
          </SelectInput>

          <SelectInput
            label="Área"
            value={filters.areaCode}
            onChange={(event) => handleFilterChange("areaCode", event.target.value)}
            disabled={isFilterDisabled}
            className={styles.selectField}
            labelClassName={styles.filterLabel}
            controlClassName={styles.selectControl}
            selectClassName={styles.selectButton}
          >
              <option value="">Todas</option>
              {areaOptions.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
          </SelectInput>

          <SelectInput
            label="Rol"
            value={filters.roleCode}
            onChange={(event) => handleFilterChange("roleCode", event.target.value)}
            disabled={isFilterDisabled}
            className={styles.selectField}
            labelClassName={styles.filterLabel}
            controlClassName={styles.selectControl}
            selectClassName={styles.selectButton}
          >
              <option value="">Todos</option>
              {roleOptions.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
          </SelectInput>

          <EmployeeAutocomplete
            employees={filteredEmployees}
            value={filters.employeeId}
            query={employeeSearch || selectedEmployeeName}
            onQueryChange={handleEmployeeSearchChange}
            onSelect={selectEmployee}
            onClearSelection={() => updateFilters({ employeeId: "" })}
            placeholder="Buscar empleado..."
            disabled={isFilterDisabled}
          />

          <label className={styles.toggleFilter}>
            <span>Alertas</span>
            <button
              type="button"
              className={`${styles.toggleButton} ${filters.onlyIssues ? styles.toggleButtonActive : ""}`}
              onClick={() => updateFilters({ onlyIssues: !filters.onlyIssues })}
              aria-pressed={filters.onlyIssues}
              disabled={isFilterDisabled}
            >
              {filters.onlyIssues ? "Alertas activas" : "Solo con alertas"}
            </button>
          </label>
        </div>

      </div>

      <div className={styles.summaryCards}>
        <article>
          <span>HS</span>
          <strong>{summaryCounters.supplementaryValueLabel}</strong>
          <small>{summaryCounters.supplementaryLabel} suplementarias</small>
        </article>
        <article>
          <span>HE</span>
          <strong>{summaryCounters.extraordinaryValueLabel}</strong>
          <small>{summaryCounters.extraordinaryLabel} extraordinarias</small>
        </article>
        <article>
          <span>Excedente</span>
          <strong>{summaryCounters.excessValueLabel}</strong>
          <small>Aprobado vs plan</small>
        </article>
        <article className={styles.salarySummaryCard}>
          <span>Total sueldos</span>
          <div className={styles.salarySummaryValues}>
            <span className={styles.salarySummarySecondary}>{summaryCounters.salaryPlannedLabel}</span>
            <small>Planificado</small>
            <strong>{summaryCounters.salaryApprovedLabel}</strong>
            <small>Aprobado</small>
          </div>
        </article>
      </div>

      {error ? (
        <div className={styles.errorBox}>
          <AlertTriangle size={17} />
          {error}
        </div>
      ) : null}

      {isLoadingComparison && !rows.length ? (
        <div className={styles.loadingScene} aria-hidden="true">
          <div className={styles.skeletonTable}>
            {Array.from({ length: 8 }).map((_, index) => <span key={index} />)}
          </div>
        </div>
      ) : hasActiveResultFilter ? (
        renderComparisonTable(
          visibleRows,
          filters.onlyIssues
            ? "No hay empleados con alertas para los filtros seleccionados."
            : "No hay empleados para los filtros seleccionados.",
        )
      ) : (
        <div className={styles.areaGroups}>
          {groupedRows.map((group) => (
            <section key={group.key} className={styles.areaGroup}>
              <div className={styles.areaHeader}>
                <strong>{group.label}</strong>
                <span>{group.rows.length} empleados</span>
              </div>
              {renderComparisonTable(group.rows, "No hay empleados en esta área.")}
            </section>
          ))}
          {!groupedRows.length ? renderComparisonTable([], "No hay empleados para el mes seleccionado.") : null}
        </div>
      )}

    </section>
  );
}
