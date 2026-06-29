"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Save } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { employeeDismissalLabel, isEmployeeDismissedInMonth } from "@/lib/employees";
import styles from "./MonthlyClosureView.module.scss";

function currentMonthKey() {
  return formatEcuadorMonthKey();
}

function baseCompletionStorageKey(month) {
  return `monthlyClosureCross:${month}`;
}

function readStoredBaseCompletionSelection(month) {
  if (typeof window === "undefined" || !month) {
    return {
      employeeIds: [],
      hasStoredSelection: false,
    };
  }

  try {
    const storedValue = window.sessionStorage.getItem(baseCompletionStorageKey(month));

    if (!storedValue) {
      return {
        employeeIds: [],
        hasStoredSelection: false,
      };
    }

    const parsedValue = JSON.parse(storedValue);

    if (Array.isArray(parsedValue)) {
      return {
        employeeIds: parsedValue.filter(Boolean).map(String),
        hasStoredSelection: true,
      };
    }

    return {
      employeeIds: Array.isArray(parsedValue?.employeeIds) ? parsedValue.employeeIds.filter(Boolean).map(String) : [],
      hasStoredSelection: parsedValue?.hasStoredSelection === true,
    };
  } catch {
    return {
      employeeIds: [],
      hasStoredSelection: false,
    };
  }
}

function storeBaseCompletionIds(month, employeeIds) {
  if (typeof window === "undefined" || !month) return;

  try {
    const nextEmployeeIds = employeeIds.filter(Boolean).map(String);
    window.sessionStorage.setItem(baseCompletionStorageKey(month), JSON.stringify({
      employeeIds: nextEmployeeIds,
      hasStoredSelection: true,
    }));
  } catch {
    // Session storage is only a convenience for navigation between closure screens.
  }
}

function clearStoredBaseCompletionIds(month) {
  if (typeof window === "undefined" || !month) return;

  try {
    window.sessionStorage.removeItem(baseCompletionStorageKey(month));
  } catch {
    // Ignore unavailable session storage.
  }
}

function readInitialState(defaultMonth = "") {
  if (typeof window === "undefined") {
    return {
      month: defaultMonth || currentMonthKey(),
      mode: "saved",
      baseCompletionEmployeeIds: [],
      hasBaseCompletionSelection: false,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const month = params.get("month") || defaultMonth || currentMonthKey();
  const urlBaseCompletionEmployeeIds = (params.get("baseCompletionEmployeeIds") || "").split(",").filter(Boolean);
  const storedSelection = readStoredBaseCompletionSelection(month);
  const hasUrlSelection = params.has("baseCompletionEmployeeIds");
  const hasBaseCompletionSelection = hasUrlSelection || storedSelection.hasStoredSelection;
  const baseCompletionEmployeeIds = hasUrlSelection ? urlBaseCompletionEmployeeIds : storedSelection.employeeIds;

  return {
    month,
    mode: params.get("mode") === "live" || hasBaseCompletionSelection ? "live" : "saved",
    closureId: params.get("closureId") || "",
    baseCompletionEmployeeIds,
    hasBaseCompletionSelection,
  };
}

function syncState(month, mode = "saved", closureId = "", baseCompletionEmployeeIds = []) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams();
  params.set("month", month);
  if (mode === "live") params.set("mode", "live");
  if (mode !== "live" && closureId) params.set("closureId", closureId);
  if (mode === "live" && baseCompletionEmployeeIds.length) {
    params.set("baseCompletionEmployeeIds", baseCompletionEmployeeIds.join(","));
  }
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function metricValue(value) {
  return value && value !== "0m" ? value : "0h00m";
}

function moneyLabel(value) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function minutesLabel(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(value / 60);
  const rest = value % 60;

  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function laborableValue(row) {
  return `${metricValue(row.regularWorkedLabel)} / ${metricValue(row.regularTargetLabel)}`;
}

function rawRegularWorkedMinutes(row) {
  return Math.max(0, (Number(row.regularWorkedMinutes) || 0) - (Number(row.baseCompletionMinutes) || 0));
}

function missingRegularMinutes(row) {
  return Math.max(0, (Number(row.regularTargetMinutes) || 0) - rawRegularWorkedMinutes(row));
}

function availableCompletionMinutes(row) {
  return Math.max(
    0,
    (Number(row.supplementaryMinutes) || 0) +
      (Number(row.extraordinaryMinutes) || 0) +
      (Number(row.baseCompletionMinutes) || 0),
  );
}

function canCompleteRow(row) {
  return missingRegularMinutes(row) > 0 && availableCompletionMinutes(row) > 0;
}

export default function MonthlyClosureView({ view = "summary", fixedMonth = "" }) {
  const isCrossView = view === "cross";
  const isPayrollView = view === "payroll";
  const isLiveOnlyView = isCrossView || isPayrollView;
  const hasFixedMonth = Boolean(fixedMonth);
  const [initialState] = useState(() => readInitialState(fixedMonth));
  const initialStateRef = useRef(initialState);
  const [month, setMonth] = useState(() => initialState.month);
  const [mode, setMode] = useState(() => (isLiveOnlyView ? "live" : initialState.mode));
  const [payload, setPayload] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isApplyingBaseCompletion, setIsApplyingBaseCompletion] = useState(false);
  const [hasPendingBaseCompletionChanges, setHasPendingBaseCompletionChanges] = useState(false);
  const [showOnlyCompletableRows, setShowOnlyCompletableRows] = useState(true);
  const [exportMode, setExportMode] = useState("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [selectedClosureId, setSelectedClosureId] = useState(() => initialState.closureId || "");
  const [baseCompletionEmployeeIds, setBaseCompletionEmployeeIds] = useState(() => initialState.baseCompletionEmployeeIds || []);
  const [error, setError] = useState("");

  const isLiveMode = mode === "live";
  const data = isLiveMode ? payload?.preview : (payload?.closure || payload?.preview) || null;
  const isClosed = Boolean(payload?.isClosed);
  const rows = (data?.rows || []).slice().sort((left, right) =>
    String(left.employeeName || "").localeCompare(String(right.employeeName || ""), "es"),
  );
  const closures = payload?.closures || [];
  const selectedClosureValue = selectedClosureId || payload?.closure?.id || "";
  const isUpdatingClosure = isSaving || (isLoading && Boolean(payload));
  const totals = data?.totals || {};
  const selectedCompletionSet = useMemo(() => new Set(baseCompletionEmployeeIds), [baseCompletionEmployeeIds]);
  const incompleteRows = rows.filter((row) => missingRegularMinutes(row) > 0);
  const completableRows = incompleteRows.filter(canCompleteRow);
  const displayedRows = isCrossView ? (showOnlyCompletableRows ? completableRows : incompleteRows) : rows;
  const allCompletableSelected = completableRows.length > 0 && completableRows.every((row) => selectedCompletionSet.has(row.employeeId));
  const areaRows = useMemo(() => {
    const groups = new Map();

    rows.forEach((row) => {
      const key = row.areaCode || row.areaName || "SIN_AREA";

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          areaName: row.areaName || row.areaCode || "Sin area",
          employees: 0,
          regularWorkedMinutes: 0,
          regularTargetMinutes: 0,
          supplementaryMinutes: 0,
          extraordinaryMinutes: 0,
          lateMinutes: 0,
          salaryTotal: 0,
          baseCompletionMinutes: 0,
        });
      }

      const group = groups.get(key);
      group.employees += 1;
      group.regularWorkedMinutes += Number(row.regularWorkedMinutes) || 0;
      group.regularTargetMinutes += Number(row.regularTargetMinutes) || 0;
      group.supplementaryMinutes += Number(row.supplementaryMinutes) || 0;
      group.extraordinaryMinutes += Number(row.extraordinaryMinutes) || 0;
      group.lateMinutes += Number(row.lateMinutes) || 0;
      group.salaryTotal += Number(row.salaryTotal) || 0;
      group.baseCompletionMinutes += Number(row.baseCompletionMinutes) || 0;
    });

    return [...groups.values()].sort((left, right) => left.areaName.localeCompare(right.areaName, "es"));
  }, [rows]);

  const loadClosure = useCallback(async (
    nextMonth,
    nextMode,
    nextClosureId = "",
    nextBaseCompletionEmployeeIds = [],
    shouldApplyDefaultBaseCompletion = false,
    isSilent = false,
  ) => {
    try {
      if (!isSilent) setIsLoading(true);
      setError("");

      const params = new URLSearchParams();
      params.set("month", nextMonth);
      if (nextMode === "live") params.set("mode", "live");
      if (nextMode !== "live" && nextClosureId) params.set("closureId", nextClosureId);
      params.set("completeBaseHours", nextBaseCompletionEmployeeIds.length ? "1" : "0");
      if (nextBaseCompletionEmployeeIds.length) {
        params.set("baseCompletionEmployeeIds", nextBaseCompletionEmployeeIds.join(","));
      }

      const response = await fetch(`/api/attendance/monthly-closure?${params.toString()}`);
      const nextPayload = await response.json();

      if (!response.ok) {
        throw new Error(nextPayload.error || "No se pudo cargar el cierre mensual.");
      }

      const nextData = nextMode === "live" ? nextPayload.preview : (nextPayload.closure || nextPayload.preview) || null;
      const completedIds = (nextData?.rows || [])
        .filter((row) => (Number(row.baseCompletionMinutes) || 0) > 0)
        .map((row) => row.employeeId)
        .filter(Boolean);
      const defaultIds = shouldApplyDefaultBaseCompletion && !nextBaseCompletionEmployeeIds.length
        ? (nextData?.rows || []).filter(canCompleteRow).map((row) => row.employeeId).filter(Boolean)
        : [];
      const selectedIds = nextBaseCompletionEmployeeIds.length
        ? completedIds
        : defaultIds.length
          ? defaultIds
          : completedIds;

      setPayload(nextPayload);
      setBaseCompletionEmployeeIds(selectedIds);
      setHasPendingBaseCompletionChanges(false);

      if (defaultIds.length) {
        setMode("live");
        storeBaseCompletionIds(nextMonth, defaultIds);
        syncState(nextMonth, "live", nextClosureId, defaultIds);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, []);

  function handleMonthChange(value) {
    const storedSelection = readStoredBaseCompletionSelection(value);
    const nextMode = isLiveOnlyView || storedSelection.hasStoredSelection ? "live" : "saved";

    setMonth(value);
    setMode(nextMode);
    setSelectedClosureId("");
    setBaseCompletionEmployeeIds(storedSelection.employeeIds);
    setHasPendingBaseCompletionChanges(false);
    syncState(value, nextMode, "", storedSelection.employeeIds);
    loadClosure(value, nextMode, "", storedSelection.employeeIds, isLiveOnlyView && !storedSelection.hasStoredSelection);
  }

  function handleModeChange(nextMode) {
    setMode(nextMode);
    syncState(month, nextMode, selectedClosureId, baseCompletionEmployeeIds);
    loadClosure(month, nextMode, selectedClosureId, baseCompletionEmployeeIds);
  }

  function handleClosureVersionChange(value) {
    setSelectedClosureId(value);
    setMode("saved");
    syncState(month, "saved", value, []);
    loadClosure(month, "saved", value, []);
  }

  function updateBaseCompletionSelection(nextEmployeeIds) {
    const normalizedEmployeeIds = nextEmployeeIds.filter(Boolean).map(String);
    const nextMode = isLiveOnlyView || normalizedEmployeeIds.length ? "live" : isClosed ? "saved" : mode;

    setBaseCompletionEmployeeIds(normalizedEmployeeIds);
    setMode(nextMode);
    setHasPendingBaseCompletionChanges(true);
  }

  function toggleBaseCompletion(employeeId) {
    const nextSet = new Set(baseCompletionEmployeeIds);

    if (nextSet.has(employeeId)) nextSet.delete(employeeId);
    else nextSet.add(employeeId);

    updateBaseCompletionSelection([...nextSet]);
  }

  function toggleAllCompletableRows() {
    updateBaseCompletionSelection(allCompletableSelected ? [] : completableRows.map((row) => row.employeeId).filter(Boolean));
  }

  async function applyBaseCompletionChanges() {
    if (isApplyingBaseCompletion || isLoading) return;

    const nextMode = "live";

    try {
      setIsApplyingBaseCompletion(true);
      setError("");
      setMode(nextMode);
      storeBaseCompletionIds(month, baseCompletionEmployeeIds);
      syncState(month, nextMode, selectedClosureId, baseCompletionEmployeeIds);
      await loadClosure(month, nextMode, selectedClosureId, baseCompletionEmployeeIds, false, true);
    } finally {
      setIsApplyingBaseCompletion(false);
    }
  }

  async function saveClosure() {
    if (isSaving) return;

    try {
      setIsSaving(true);
      setIsConfirmOpen(false);
      setError("");

      const response = await fetch("/api/attendance/monthly-closure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          month,
          completeBaseHours: baseCompletionEmployeeIds.length > 0,
          baseCompletionEmployeeIds,
        }),
      });
      const nextPayload = await response.json();

      if (!response.ok) {
        throw new Error(nextPayload.error || "No se pudo guardar el cierre mensual.");
      }

      setMode("saved");
      setSelectedClosureId("");
      syncState(month, "saved", "", []);
      clearStoredBaseCompletionIds(month);
      await loadClosure(month, "saved", "", []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSaving(false);
    }
  }

  function handleSaveRequest() {
    if (isSaving) return;
    setIsConfirmOpen(true);
  }

  async function exportClosure(nextExportMode) {
    if (exportMode || isLoading || !rows.length) return;
    const isDetailedExcel = nextExportMode === "detailed-xlsx";
    const isPayrollExcel = nextExportMode === "payroll-xlsx";

    try {
      setExportMode(nextExportMode);
      setError("");

      const params = new URLSearchParams();
      params.set("month", month);
      params.set("export", nextExportMode);
      if (isLiveMode) params.set("mode", "live");
      if (!isLiveMode && selectedClosureValue) params.set("closureId", selectedClosureValue);
      if (isLiveMode) {
        params.set("completeBaseHours", baseCompletionEmployeeIds.length ? "1" : "0");
        if (baseCompletionEmployeeIds.length) {
          params.set("baseCompletionEmployeeIds", baseCompletionEmployeeIds.join(","));
        }
      }

      const response = await fetch(`/api/attendance/monthly-closure?${params.toString()}`);

      if (!response.ok) {
        const message = await response.json().catch(() => null);
        throw new Error(message?.error || "No se pudo exportar el cierre mensual.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = isDetailedExcel
        ? `cierre-mensual-detallado-${month}.xlsx`
        : isPayrollExcel
          ? `formato-nomina-${month}.xlsx`
          : `cierre-mensual-${month}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setExportMode("");
    }
  }

  useEffect(() => {
    loadClosure(
      initialStateRef.current.month,
      isLiveOnlyView ? "live" : initialStateRef.current.mode,
      initialStateRef.current.closureId,
      initialStateRef.current.baseCompletionEmployeeIds,
      isLiveOnlyView && !initialStateRef.current.hasBaseCompletionSelection,
    );
  }, [isLiveOnlyView, loadClosure]);

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.filterGroup}>
          <label>
            <span>Mes</span>
            <input type="month" value={month} onChange={(event) => handleMonthChange(event.target.value)} disabled={hasFixedMonth} />
          </label>
          {!isLiveOnlyView && closures.length ? (
            <label>
              <span>Copia</span>
              <select value={selectedClosureValue} onChange={(event) => handleClosureVersionChange(event.target.value)} disabled={isSaving || isLoading}>
                {closures.map((closure) => (
                  <option key={closure.id} value={closure.id}>
                    v{closure.version}{closure.isLatest ? " · última" : ""} · {new Date(closure.closedAt).toLocaleString("es-EC")}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className={`${styles.actions} ${isCrossView ? styles.crossActions : ""}`}>
          {isCrossView ? (
            <>
              <label className={styles.switchControl}>
                <input
                  type="checkbox"
                  checked={showOnlyCompletableRows}
                  onChange={(event) => setShowOnlyCompletableRows(event.target.checked)}
                  disabled={isLoading || isApplyingBaseCompletion}
                />
                <span aria-hidden="true" />
                <strong>Solo con cruce</strong>
              </label>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={toggleAllCompletableRows}
                disabled={isSaving || isLoading || isApplyingBaseCompletion || !completableRows.length}
              >
                {allCompletableSelected ? "Quitar cruces" : "Cruzar todos"}
              </button>
              <button
                type="button"
                className={styles.saveButton}
                onClick={applyBaseCompletionChanges}
                disabled={isSaving || isLoading || isApplyingBaseCompletion || !hasPendingBaseCompletionChanges}
              >
                {isApplyingBaseCompletion ? <RefreshCw size={16} /> : <Save size={16} />}
                Guardar cambios
              </button>
            </>
          ) : isPayrollView ? (
            <button
              type="button"
              className={styles.exportButton}
              onClick={() => exportClosure("payroll-xlsx")}
              disabled={Boolean(exportMode) || isSaving || isLoading || !rows.length}
            >
              {exportMode === "payroll-xlsx" ? <RefreshCw size={16} /> : <Download size={16} />}
              Descargar formato nómina
            </button>
          ) : (
            <>
              <button
                type="button"
                className={styles.exportButton}
                onClick={() => exportClosure("detailed-xlsx")}
                disabled={Boolean(exportMode) || isSaving || isLoading || !rows.length}
              >
                {exportMode === "detailed-xlsx" ? <RefreshCw size={16} /> : <Download size={16} />}
                Excel completo
              </button>

              <button
                type="button"
                className={styles.exportButton}
                onClick={() => exportClosure("payroll-xlsx")}
                disabled={Boolean(exportMode) || isSaving || isLoading || !rows.length}
              >
                {exportMode === "payroll-xlsx" ? <RefreshCw size={16} /> : <Download size={16} />}
                Formato nómina
              </button>

              <button
                type="button"
                className={styles.saveButton}
                onClick={handleSaveRequest}
                disabled={(isClosed && !isLiveMode) || isSaving || isLoading}
              >
                {isSaving ? <RefreshCw size={16} /> : isClosed && !isLiveMode ? <CheckCircle2 size={16} /> : <Save size={16} />}
                {isClosed ? (isLiveMode ? "Actualizar cierre" : "Guardado") : "Guardar cierre"}
              </button>
            </>
          )}
        </div>
      </div>

      {!isLiveOnlyView && isClosed ? (
        <div className={`${styles.viewModeBar} ${isLiveMode ? styles.viewModeBarLive : ""}`}>
          <div>
            <span>Vista</span>
            <strong>{isLiveMode ? "Cálculo actual" : "Copia guardada"}</strong>
            <small>
              {isLiveMode
                ? "Muestra el cálculo con los datos actuales antes de guardar una nueva copia."
                : "Muestra la copia cerrada seleccionada para nómina y exportación."}
            </small>
          </div>
          <button
            type="button"
            className={styles.viewModeButton}
            onClick={() => handleModeChange(isLiveMode ? "saved" : "live")}
            disabled={isSaving || isLoading}
          >
            <RefreshCw size={16} />
            {isLiveMode ? "Volver a copia" : "Ver cálculo actual"}
          </button>
        </div>
      ) : null}

      {!isLiveOnlyView && !isLoading && data ? (
        <div className={styles.summaryGrid}>
          <article>
            <span>Laborables</span>
            <strong>{metricValue(totals.regularWorkedLabel)} / {metricValue(totals.regularTargetLabel)}</strong>
            <small>{totals.baseCompletionMinutes ? `Cruzadas ${metricValue(totals.baseCompletionLabel)}` : "Base registrada"}</small>
          </article>
          <article>
            <span>Suplementarias</span>
            <strong>{metricValue(totals.supplementaryLabel)}</strong>
            <small>{totals.supplementaryAmountLabel || "Valor adicional"}</small>
          </article>
          <article>
            <span>Extraordinarias</span>
            <strong>{metricValue(totals.extraordinaryLabel)}</strong>
            <small>{totals.extraordinaryAmountLabel || "Valor adicional"}</small>
          </article>
          <article>
            <span>Atrasos</span>
            <strong>{metricValue(totals.lateLabel)}</strong>
            <small>Control interno</small>
          </article>
          <article>
            <span>Sueldos</span>
            <strong>{totals.salaryTotalLabel || "$0.00"}</strong>
            <small>{totals.employees || 0} empleados</small>
          </article>
        </div>
      ) : null}

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
        <>
          {!isLiveOnlyView ? (
            <section className={styles.areaSection}>
            <div className={styles.sectionHeader}>
              <div>
                <span>Resumen operativo</span>
                <strong>Horas registradas por area</strong>
              </div>
              <small>{areaRows.length} areas</small>
            </div>
            <div className={styles.areaGrid}>
              {areaRows.map((area) => (
                <article key={area.key}>
                  <div>
                    <strong>{area.areaName}</strong>
                    <span>{area.employees} empleados</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Laborables</dt>
                      <dd>{metricValue(minutesLabel(area.regularWorkedMinutes))} / {metricValue(minutesLabel(area.regularTargetMinutes))}</dd>
                    </div>
                    <div>
                      <dt>HS</dt>
                      <dd>{metricValue(minutesLabel(area.supplementaryMinutes))}</dd>
                    </div>
                    <div>
                      <dt>HE</dt>
                      <dd>{metricValue(minutesLabel(area.extraordinaryMinutes))}</dd>
                    </div>
                    <div>
                      <dt>Atrasos</dt>
                      <dd>{metricValue(minutesLabel(area.lateMinutes))}</dd>
                    </div>
                    <div>
                      <dt>Gasto total</dt>
                      <dd>{moneyLabel(area.salaryTotal)}</dd>
                    </div>
                  </dl>
                  <small>{area.baseCompletionMinutes ? `Cruzadas ${metricValue(minutesLabel(area.baseCompletionMinutes))}` : "Sin cruces aplicados"}</small>
                </article>
              ))}
            </div>
            </section>
          ) : null}

          <div className={`${styles.tableShell} ${isPayrollView ? styles.payrollTableShell : ""} ${isUpdatingClosure ? styles.tableShellUpdating : ""}`} aria-busy={isUpdatingClosure}>
            {isUpdatingClosure ? (
              <>
                <span className={styles.loadingRail} aria-hidden="true" />
                <div className={styles.updateOverlay} role="status" aria-live="polite">
                  <RefreshCw size={18} />
                  <strong>{isSaving ? "Actualizando cierre..." : "Cargando cierre..."}</strong>
                </div>
              </>
            ) : null}
            <div className={styles.tableScroller}>
              <table>
                {isPayrollView ? (
                  <>
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Cédula</th>
                        <th>HS</th>
                        <th>HE</th>
                        <th>Sueldo total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRows.map((row, index) => {
                        const isDismissed = isEmployeeDismissedInMonth(row, month);
                        const dismissalTitle = isDismissed ? employeeDismissalLabel(row) : undefined;

                        return (
                        <tr
                          key={row.employeeId || `${row.employeeName}-${index}`}
                          className={isDismissed ? styles.dismissedRow : ""}
                          title={dismissalTitle}
                        >
                          <td>
                            <strong className={styles.employeeName}>{row.employeeName}</strong>
                          </td>
                          <td>
                            <span className={styles.dniValue}>{row.employeeDni || "--"}</span>
                          </td>
                          <td>
                            <span className={styles.metricValue}>{metricValue(row.supplementaryLabel)}</span>
                          </td>
                          <td>
                            <span className={styles.metricValue}>{metricValue(row.extraordinaryLabel)}</span>
                          </td>
                          <td>
                            <strong className={styles.salaryValue}>{row.salaryTotalLabel || "$0.00"}</strong>
                          </td>
                        </tr>
                        );
                      })}
                      {!displayedRows.length ? (
                        <tr>
                          <td colSpan={5} className={styles.emptyCell}>No hay empleados para generar nómina en este mes.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead>
                      <tr>
                        <th>Empleado</th>
                        {isCrossView ? <th>Cruzar horas</th> : null}
                        <th>Laborables</th>
                        <th>Suplementarias</th>
                        <th>Extraordinarias</th>
                        <th>Atrasos</th>
                        <th>Sueldo total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRows.map((row, index) => {
                        const isDismissed = isEmployeeDismissedInMonth(row, month);
                        const dismissalTitle = isDismissed ? employeeDismissalLabel(row) : undefined;

                        return (
                        <tr
                          key={row.employeeId || `${row.employeeName}-${index}`}
                          className={isDismissed ? styles.dismissedRow : ""}
                          title={dismissalTitle}
                        >
                          <td>
                            <strong className={styles.employeeName}>{row.employeeName}</strong>
                            <span>{row.branchName} · {row.areaName} · {row.roleName}</span>
                          </td>
                          {isCrossView ? (
                            <td>
                              {canCompleteRow(row) ? (
                                <label className={styles.rowSwitch}>
                                  <input
                                    type="checkbox"
                                  checked={selectedCompletionSet.has(row.employeeId)}
                                  onChange={() => toggleBaseCompletion(row.employeeId)}
                                  disabled={isSaving || isLoading || isApplyingBaseCompletion}
                                />
                                  <span aria-hidden="true" />
                                  <strong>{selectedCompletionSet.has(row.employeeId) ? "Aplicado" : "Cruzar"}</strong>
                                  <small>Faltan {metricValue(minutesLabel(missingRegularMinutes(row)))}</small>
                                </label>
                              ) : (
                                <span className={styles.notAvailable}>Sin horas disponibles</span>
                              )}
                            </td>
                          ) : null}
                          <td>
                            <span className={styles.metricValue}>{laborableValue(row)}</span>
                            {row.baseCompletionMinutes > 0 ? (
                              <span>Cruzadas {metricValue(row.baseCompletionLabel)}</span>
                            ) : null}
                          </td>
                          <td>
                            <span className={styles.metricValue}>{metricValue(row.supplementaryLabel)}</span>
                          </td>
                          <td>
                            <span className={styles.metricValue}>{metricValue(row.extraordinaryLabel)}</span>
                          </td>
                          <td>
                            <span className={styles.metricValue}>{metricValue(row.lateLabel)}</span>
                          </td>
                          <td>
                            <strong className={styles.salaryValue}>{row.salaryTotalLabel || "$0.00"}</strong>
                          </td>
                        </tr>
                        );
                      })}
                      {!displayedRows.length ? (
                        <tr>
                          <td colSpan={isCrossView ? 7 : 6} className={styles.emptyCell}>
                            {isCrossView
                              ? showOnlyCompletableRows
                                ? "No hay empleados con cruce disponible."
                                : "No hay empleados con horas laborables incompletas."
                              : "No hay empleados para cerrar en este mes."}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </div>
        </>
      )}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={isClosed ? "Actualizar cierre" : "Guardar cierre"}
        message={
          isClosed
            ? `Se guardará una nueva versión cruzando horas en ${baseCompletionEmployeeIds.length} empleados seleccionados. Nómina usará la última copia guardada.`
            : `Se guardará una copia fija cruzando horas en ${baseCompletionEmployeeIds.length} empleados seleccionados.`
        }
        confirmLabel={isClosed ? "Actualizar cierre" : "Guardar cierre"}
        cancelLabel="Cancelar"
        tone="warning"
        isPending={isSaving}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={saveClosure}
      />
    </section>
  );
}
