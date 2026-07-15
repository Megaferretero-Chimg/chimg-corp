"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, RefreshCw, Save } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { employeeDismissalLabel, isEmployeeDismissedInMonth } from "@/modules/company/submodules/people/lib/employees";
import styles from "@/modules/planner/styles/components/attendance/MonthlyClosureView.module.scss";

function currentMonthKey() {
  return formatEcuadorMonthKey();
}

function readInitialState(defaultMonth = "") {
  if (typeof window === "undefined") {
    return {
      month: defaultMonth || currentMonthKey(),
      mode: "saved",
    };
  }

  const params = new URLSearchParams(window.location.search);
  const month = params.get("month") || defaultMonth || currentMonthKey();

  return {
    month,
    mode: params.get("mode") === "live" ? "live" : "saved",
    closureId: params.get("closureId") || "",
  };
}

function syncState(month, mode = "saved", closureId = "") {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams();
  params.set("month", month);
  if (mode === "live") params.set("mode", "live");
  if (mode !== "live" && closureId) params.set("closureId", closureId);
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
  const isSummaryView = view === "summary";
  const isLiveOnlyView = isCrossView;
  const hasFixedMonth = Boolean(fixedMonth);
  const [initialState] = useState(() => readInitialState(fixedMonth));
  const initialStateRef = useRef(initialState);
  const [month, setMonth] = useState(() => initialState.month);
  const [mode, setMode] = useState(() => (isLiveOnlyView ? "live" : initialState.mode));
  const [payload, setPayload] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [exportMode, setExportMode] = useState("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [selectedClosureId, setSelectedClosureId] = useState(() => initialState.closureId || "");
  const [error, setError] = useState("");

  const isLiveMode = mode === "live";
  const savedClosure = payload?.closure || null;
  const hasSavedCrossClosure = Boolean(savedClosure && savedClosure.completeBaseHours !== false);
  const requiresSavedCrossClosure = isPayrollView || isSummaryView;
  const data = requiresSavedCrossClosure && !hasSavedCrossClosure
    ? null
    : isLiveMode ? payload?.preview : (savedClosure || payload?.preview) || null;
  const isClosed = Boolean(payload?.isClosed);
  const rows = (data?.rows || []).slice().sort((left, right) =>
    String(left.employeeName || "").localeCompare(String(right.employeeName || ""), "es"),
  );
  const closures = payload?.closures || [];
  const selectedClosureValue = selectedClosureId || payload?.closure?.id || "";
  const isUpdatingClosure = isSaving || (isLoading && Boolean(payload));
  const totals = data?.totals || {};
  const incompleteRows = rows.filter((row) => missingRegularMinutes(row) > 0);
  const completableRows = incompleteRows.filter(canCompleteRow);
  const displayedRows = isCrossView ? completableRows : rows;
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

      const response = await fetch(`/api/planner/attendance/monthly-closure?${params.toString()}`);
      const nextPayload = await response.json();

      if (!response.ok) {
        throw new Error(nextPayload.error || "No se pudo cargar el cierre mensual.");
      }

      const nextData = nextMode === "live" ? nextPayload.preview : (nextPayload.closure || nextPayload.preview) || null;
      setPayload(nextPayload);

      if (shouldApplyDefaultBaseCompletion && nextMode !== "live") {
        setMode("live");
        syncState(nextMonth, "live", nextClosureId);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, []);

  function handleMonthChange(value) {
    const nextMode = isLiveOnlyView ? "live" : "saved";

    setMonth(value);
    setMode(nextMode);
    setSelectedClosureId("");
    syncState(value, nextMode, "");
    loadClosure(value, nextMode, "", isLiveOnlyView);
  }

  function handleModeChange(nextMode) {
    setMode(nextMode);
    syncState(month, nextMode, selectedClosureId);
    loadClosure(month, nextMode, selectedClosureId);
  }

  function handleClosureVersionChange(value) {
    setSelectedClosureId(value);
    setMode("saved");
    syncState(month, "saved", value);
    loadClosure(month, "saved", value);
  }

  async function saveClosure() {
    if (isSaving) return;

    try {
      setIsSaving(true);
      setIsConfirmOpen(false);
      setError("");

      const response = await fetch("/api/planner/attendance/monthly-closure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          month,
          completeBaseHours: true,
        }),
      });
      const nextPayload = await response.json();

      if (!response.ok) {
        throw new Error(nextPayload.error || "No se pudo guardar el cierre mensual.");
      }

      setMode("saved");
      setSelectedClosureId("");
      syncState(month, "saved", "");
      await loadClosure(month, "saved", "");
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
      const response = await fetch(`/api/planner/attendance/monthly-closure?${params.toString()}`);

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
      isLiveOnlyView,
    );
  }, [isLiveOnlyView, loadClosure]);

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.filterGroup}>
          <label>
            <span>Mes</span>
            <input type="month" value={month} onChange={(event) => handleMonthChange(event.target.value)} disabled={hasFixedMonth || isSaving || isLoading} />
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
            <button
              type="button"
              className={styles.saveButton}
              onClick={handleSaveRequest}
              disabled={isSaving || isLoading || !completableRows.length}
            >
              {isSaving ? <RefreshCw size={16} /> : <Save size={16} />}
              Guardar cruce
            </button>
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
                disabled={Boolean(exportMode) || isSaving || isLoading || !rows.length || !hasSavedCrossClosure}
              >
                {exportMode === "detailed-xlsx" ? <RefreshCw size={16} /> : <Download size={16} />}
                Excel completo
              </button>

              <button
                type="button"
                className={styles.exportButton}
                onClick={() => exportClosure("payroll-xlsx")}
                disabled={Boolean(exportMode) || isSaving || isLoading || !rows.length || !hasSavedCrossClosure}
              >
                {exportMode === "payroll-xlsx" ? <RefreshCw size={16} /> : <Download size={16} />}
                Formato nómina
              </button>
            </>
          )}
        </div>
      </div>

      {!isLiveOnlyView && !requiresSavedCrossClosure && isClosed ? (
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
          {!isLiveOnlyView && data ? (
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
            {!displayedRows.length ? (
              <div className={styles.emptyState}>
                {isPayrollView
                  ? "Primero guarda el cruce de horas para este mes."
                  : isCrossView
                    ? "No hay empleados que requieran cruce de horas."
                    : "Primero guarda el cruce de horas para este mes."}
              </div>
            ) : (
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
                            {(Number(row.regularShortfallDiscount) || 0) > 0 ? (
                              <span>Faltantes -{moneyLabel(row.regularShortfallDiscount)}</span>
                            ) : null}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead>
                      <tr>
                        <th>Empleado</th>
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
                          <td>
                            <span className={styles.metricValue}>{laborableValue(row)}</span>
                            {isCrossView ? (
                              <span>Faltan {metricValue(minutesLabel(missingRegularMinutes(row)))}</span>
                            ) : row.baseCompletionMinutes > 0 ? (
                              <span>Cruzadas {metricValue(row.baseCompletionLabel)}</span>
                            ) : null}
                          </td>
                          <td>
                            <span className={styles.metricValue}>{metricValue(row.supplementaryLabel)}</span>
                            {isCrossView ? (
                              <span>Disponible {metricValue(minutesLabel(Math.min(Number(row.supplementaryMinutes) || 0, missingRegularMinutes(row))))}</span>
                            ) : null}
                          </td>
                          <td>
                            <span className={styles.metricValue}>{metricValue(row.extraordinaryLabel)}</span>
                            {isCrossView ? (
                              <span>Disponible {metricValue(minutesLabel(Math.max(0, Math.min(Number(row.extraordinaryMinutes) || 0, missingRegularMinutes(row) - (Number(row.supplementaryMinutes) || 0)))))}</span>
                            ) : null}
                          </td>
                          <td>
                            <span className={styles.metricValue}>{metricValue(row.lateLabel)}</span>
                          </td>
                          <td>
                            <strong className={styles.salaryValue}>{row.salaryTotalLabel || "$0.00"}</strong>
                            {(Number(row.regularShortfallDiscount) || 0) > 0 ? (
                              <span>Faltantes -{moneyLabel(row.regularShortfallDiscount)}</span>
                            ) : null}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </>
                )}
                </table>
              </div>
            )}
          </div>
        </>
      )}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={isCrossView ? "Guardar cruce de horas" : isClosed ? "Actualizar cierre" : "Guardar cierre"}
        message={
          isCrossView
            ? "Se guardará una versión mensual con el cruce de horas revisado. Las siguientes pantallas usarán esta copia guardada."
            : isClosed
            ? "Se guardará una nueva versión con el cruce automático de horas. Nómina usará la última copia guardada."
            : "Se guardará una copia fija con el cruce automático de horas."
        }
        confirmLabel={isCrossView ? "Guardar cruce" : isClosed ? "Actualizar cierre" : "Guardar cierre"}
        cancelLabel="Cancelar"
        tone="warning"
        isPending={isSaving}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={saveClosure}
      />
    </section>
  );
}
