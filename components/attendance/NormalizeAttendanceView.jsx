"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Database,
  Save,
  Search,
  X,
} from "lucide-react";

import styles from "./NormalizeAttendanceView.module.scss";
import useClientReady from "@/hooks/useClientReady";
import {
  formatEcuadorDate,
  formatEcuadorDateTime,
  formatEcuadorDateKey,
  formatEcuadorTime,
  getEcuadorParts,
} from "@/lib/datetime/ecuador";
import { planningModulePath } from "@/lib/modules/planning/routes";

function formatDateTime(value) {
  return formatEcuadorDateTime(value);
}

function formatDate(value) {
  return formatEcuadorDate(value);
}

function formatTime(value) {
  return formatEcuadorTime(value);
}

function formatDayName(value) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "N/D";
  }

  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    weekday: "long",
  }).format(parsed);
}

function formatWeekLabel(value) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Semana desconocida";
  }

  const weekStart = startOfWeek(parsed, { weekStartsOn: 1 });
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  return `${format(weekStart, "d MMM", { locale: es })} al ${format(weekEnd, "d MMM yyyy", {
    locale: es,
  })}`;
}

function groupPunchesByWeek(punches) {
  const grouped = new Map();

  punches.forEach((punch) => {
    const parsed = new Date(punch.punchedAt);

    if (Number.isNaN(parsed.getTime())) {
      return;
    }

    const parts = getEcuadorParts(parsed);

    if (!parts) {
      return;
    }

    const shifted = new Date(Date.UTC(parts.year, parts.monthIndex, parts.day));
    const weekStart = startOfWeek(shifted, { weekStartsOn: 1 });
    const weekKey = weekStart.toISOString();

    if (!grouped.has(weekKey)) {
      grouped.set(weekKey, []);
    }

    grouped.get(weekKey).push(punch);
  });

  return [...grouped.entries()]
    .sort((left, right) => new Date(left[0]).getTime() - new Date(right[0]).getTime())
    .map(([weekKey, weekPunches]) => ({
      weekKey,
      label: formatWeekLabel(weekKey),
      punches: weekPunches.sort(
        (left, right) => new Date(left.punchedAt).getTime() - new Date(right.punchedAt).getTime(),
      ),
    }));
}

function groupPunchesByDay(punches) {
  const grouped = new Map();

  punches.forEach((punch) => {
    const parsed = new Date(punch.punchedAt);

    if (Number.isNaN(parsed.getTime())) {
      return;
    }

    const dayKey = formatEcuadorDateKey(parsed);

    if (!grouped.has(dayKey)) {
      grouped.set(dayKey, []);
    }

    grouped.get(dayKey).push(punch);
  });

  return [...grouped.entries()]
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
    .map(([dayKey, dayPunches]) => ({
      dayKey,
      punches: dayPunches.sort(
        (left, right) => new Date(left.punchedAt).getTime() - new Date(right.punchedAt).getTime(),
      ),
    }));
}

function getMatchLabel(status) {
  if (status === "matched") return "Listo";
  if (status === "inactive") return "Empleado inactivo";
  return "Sin empleado";
}

function getMatchClass(status) {
  if (status === "matched") return styles.matchOk;
  if (status === "inactive") return styles.matchWarning;
  return styles.matchDanger;
}

function getEmployeeKey(employee) {
  if (!employee) {
    return "";
  }

  return [
    employee?.matchedEmployeeId || "",
    employee?.biometricCode || "",
    employee?.fullName || "",
  ].join("|");
}

export default function NormalizeAttendanceView({ uploadId }) {
  const isClientReady = useClientReady();
  const [response, setResponse] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishingPunches, setIsPublishingPunches] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedEmployeeKey, setSelectedEmployeeKey] = useState("");
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);
  const employeeDetailRef = useRef(null);

  const totalRows = useMemo(
    () => response?.employees?.reduce((sum, employee) => sum + employee.punches.length, 0) || 0,
    [response],
  );

  const filteredEmployees = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return response?.employees || [];
    }

    return (response?.employees || []).filter((employee) => {
      const haystack = `${employee.fullName} ${employee.biometricCode} ${employee.department}`
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [response?.employees, search]);
  const selectedEmployee = useMemo(
    () => (response?.employees || []).find((employee) => getEmployeeKey(employee) === selectedEmployeeKey) || null,
    [response?.employees, selectedEmployeeKey],
  );
  const reconciliationNeedsAttention = Boolean(
    (response?.summary?.inactiveEmployees || 0) > 0 ||
      (response?.summary?.unmatchedEmployees || 0) > 0 ||
      (response?.summary?.duplicateMinutePunches || 0) > 0 ||
      (response?.summary?.irregularDays || 0) > 0,
  );
  const isNormalizationSaved = response?.source === "saved";
  const showBlockingOverlay = isSaving || isPublishingPunches;

  function showToast(type, message) {
    setToast({ type, message });

    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 5000);
  }

  async function handleSaveNormalization() {
    try {
      setIsSaving(true);
      const request = await fetch(`/api/attendance/upload/${uploadId}/normalize`, {
        method: "POST",
      });
      const payload = await request.json();

      if (!request.ok) {
        throw new Error(payload.error || "No se pudo guardar la normalización.");
      }

      setResponse(payload);
      showToast(
        "success",
        [
          payload.message || "Normalización guardada y picadas cargadas correctamente.",
          payload.publishSummary?.skippedUnmatchedEmployees
            ? `Se omitieron ${payload.publishSummary.skippedUnmatchedPunches} picadas sin empleado activo en la sucursal.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (requestError) {
      showToast("error", requestError.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePublishPunches() {
    try {
      setIsPublishingPunches(true);
      const request = await fetch(`/api/attendance/upload/${uploadId}/publish-punches`, {
        method: "POST",
      });
      const payload = await request.json();

      if (!request.ok) {
        throw new Error(payload.error || "No se pudieron cargar las picadas.");
      }

      setResponse((current) =>
        current
          ? {
              ...current,
              upload: {
                ...current.upload,
                punchesPublishedAt: payload.publishedAt,
              },
            }
          : current,
      );

      showToast(
        "success",
        [
          `Se cargaron ${payload.publishedPunches} picadas para ${payload.publishedEmployees} empleados.`,
          payload.skippedUnmatchedEmployees
            ? `Se omitieron ${payload.skippedUnmatchedPunches} picadas sin empleado activo en la sucursal.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (requestError) {
      showToast("error", requestError.message);
    } finally {
      setIsPublishingPunches(false);
    }
  }

  function handleSelectEmployee(employeeKey) {
    setSelectedEmployeeKey(employeeKey);
    window.requestAnimationFrame(() => {
      employeeDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      employeeDetailRef.current?.focus({ preventScroll: true });
    });
  }

  useEffect(() => {
    let isCancelled = false;

    async function fetchNormalizedUpload() {
      try {
        if (!isCancelled) {
          setIsLoading(true);
        }

        const request = await fetch(`/api/attendance/upload/${uploadId}/normalize`);
        const payload = await request.json();

        if (!request.ok) {
          throw new Error(payload.error || "No se pudo normalizar la carga.");
        }

        if (!isCancelled) {
          setResponse(payload);
          setSelectedEmployeeKey((current) => current || getEmployeeKey(payload.employees?.[0]));
        }
      } catch (requestError) {
        if (!isCancelled) {
          showToast("error", requestError.message);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchNormalizedUpload();

    return () => {
      isCancelled = true;

      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, [uploadId]);

  useEffect(() => {
    if (!isPublishingPunches && !isSaving) {
      return undefined;
    }

    function handleBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
      return "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isPublishingPunches, isSaving]);

  return (
    <>
      {showBlockingOverlay && isClientReady
        ? createPortal(
            <div className={styles.blockingOverlay} role="alert" aria-live="assertive">
              <div className={styles.blockingCard}>
                <div className={styles.loadingSpinner} />
                <h2 className={styles.blockingTitle}>
                  {isSaving ? "Guardando y cargando picadas" : "Cargando picadas al sistema"}
                </h2>
                <p className={styles.blockingMessage}>
                  No cierres esta página ni navegues a otra sección hasta que termine el proceso.
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}

      {toast ? (
        <div
          className={`${styles.toast} ${
            toast.type === "success" ? styles.toastSuccess : styles.toastError
          }`}
          role="status"
          aria-live="polite"
        >
          <div className={styles.toastIcon}>
            {toast.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          </div>
          <div className={styles.toastContent}>
            <p className={styles.toastTitle}>
              {toast.type === "success" ? "Operación exitosa" : "Algo necesita atención"}
            </p>
            <p className={styles.toastMessage}>{toast.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className={styles.toastClose}
            aria-label="Cerrar notificación"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      <section className={styles.panel}>
        <div className={styles.topBar}>
          <Link href={planningModulePath("/attendance/uploads")} className={styles.backLink}>
            <ArrowLeft size={16} />
            Volver a cargas
          </Link>
        </div>

        {isLoading ? (
          <div className={styles.loadingState}>
            <div className={styles.loadingSpinner} />
            <span>Normalizando archivo guardado...</span>
          </div>
        ) : response ? (
          <>
            <div className={styles.actionBar}>
              <div className={styles.badgeStack}>
                <div className={styles.sourceBadge}>
                  {response.source === "saved"
                    ? `Normalización guardada${
                        response.upload?.normalizedAt
                          ? ` · ${formatDateTime(response.upload.normalizedAt)}`
                          : ""
                      }`
                    : "Normalización temporal en memoria"}
                </div>

                <div className={styles.sourceBadgeSecondary}>
                  {response.upload?.punchesPublishedAt
                    ? `Picadas publicadas · ${formatDateTime(response.upload.punchesPublishedAt)}`
                    : "Picadas aún no publicadas en el SISTEMA"}
                </div>
              </div>

              <div className={styles.actionButtons}>
                {!isNormalizationSaved ? (
                  <button
                    type="button"
                    onClick={handleSaveNormalization}
                    disabled={isSaving}
                    className={styles.saveButton}
                  >
                    <Save size={16} />
                    {isSaving ? "Procesando..." : "Guardar y cargar picadas válidas"}
                  </button>
                ) : null}

                {isNormalizationSaved
                  ? response.upload?.punchesPublishedAt ? (
                      <div className={styles.publishedTag}>
                        <CheckCircle2 size={16} />
                        <span>
                          Picadas cargadas · {formatDateTime(response.upload.punchesPublishedAt)}
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handlePublishPunches}
                        disabled={isPublishingPunches}
                        className={styles.publishButton}
                      >
                        <Database size={16} />
                        {isPublishingPunches
                          ? "Cargando picadas..."
                          : "Cargar picadas al Sistema"}
                      </button>
                    )
                  : null}
              </div>
            </div>

            <div className={styles.summaryGrid}>
              {[
                { label: "Archivo", value: response.upload?.fileName || "N/D" },
                { label: "Sucursal", value: response.upload?.branchName || response.upload?.branchCode || "N/D" },
                { label: "Empleados", value: response.summary?.totalEmployees || 0 },
                { label: "Picadas", value: response.summary?.totalPunches || 0 },
                { label: "Registros", value: totalRows },
              ].map((item) => (
                <div key={item.label} className={styles.summaryCard}>
                  <p className={styles.summaryLabel}>{item.label}</p>
                  <p className={styles.summaryValue}>{item.value}</p>
                </div>
              ))}
            </div>

            <section
              className={`${styles.reconciliationPanel} ${
                reconciliationNeedsAttention ? styles.reconciliationWarning : styles.reconciliationOk
              }`}
            >
              <div className={styles.reconciliationHeader}>
                <div className={styles.reconciliationTitleBlock}>
                  <div className={styles.reconciliationIcon}>
                    {reconciliationNeedsAttention ? (
                      <AlertCircle size={19} />
                    ) : (
                      <CheckCircle2 size={19} />
                    )}
                  </div>
                  <div>
                    <h2 className={styles.reconciliationTitle}>Conciliación por sucursal</h2>
                    <p className={styles.reconciliationText}>
                      Solo se publican picadas con empleado activo en esta sucursal.
                    </p>
                  </div>
                </div>
                <div className={styles.reconciliationStats}>
                  <span>{response.summary?.matchedEmployees || 0} listos</span>
                  <span>{response.summary?.unmatchedEmployees || 0} sin empleado</span>
                  <span>{response.summary?.inactiveEmployees || 0} inactivos</span>
                  <span>{response.summary?.duplicateMinutePunches || 0} duplicadas</span>
                  <span>{response.summary?.irregularDays || 0} días irregulares</span>
                </div>
              </div>

              <div className={styles.reconciliationTableWrap}>
                <table className={styles.reconciliationTable}>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Empleado</th>
                      <th>Estado</th>
                      <th>Picadas</th>
                      <th>Duplicadas</th>
                      <th>Días irregulares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((employee) => {
                      const employeeKey = getEmployeeKey(employee);
                      const isSelected = selectedEmployeeKey === employeeKey;

                      return (
                      <tr
                        key={`reconcile-${employeeKey}`}
                        className={isSelected ? styles.selectedEmployeeRow : ""}
                        onClick={() => handleSelectEmployee(employeeKey)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleSelectEmployee(employeeKey);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <td className={styles.reconciliationCode}>
                          {employee.biometricCode || "s/n"}
                        </td>
                        <td>
                          <strong>{employee.matchedEmployeeName || employee.fullName}</strong>
                          <span>{employee.department || "Sin estructura"}</span>
                        </td>
                        <td>
                          <span
                            className={`${styles.matchBadge} ${getMatchClass(employee.matchStatus)}`}
                          >
                            {getMatchLabel(employee.matchStatus)}
                          </span>
                        </td>
                        <td>{employee.punchCount || 0}</td>
                        <td>{employee.duplicateMinuteCount || 0}</td>
                        <td>{employee.irregularDayCount || 0}</td>
                      </tr>
                      );
                    })}
                    {!filteredEmployees.length ? (
                      <tr>
                        <td colSpan={6} className={styles.emptyTableCell}>
                          No hay empleados que coincidan con el filtro actual.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <label className={styles.searchField}>
              <span className={styles.searchLabel}>Filtrar empleado encontrado</span>
              <div className={styles.searchInputWrap}>
                <Search size={16} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por nombre, código o departamento"
                  className={styles.searchInput}
                />
              </div>
            </label>

            <div
              ref={employeeDetailRef}
              className={styles.employeeList}
              tabIndex={-1}
              aria-live="polite"
            >
              {selectedEmployee ? (
                <article key={`${selectedEmployee.biometricCode}-${selectedEmployee.fullName}`} className={styles.employeeCard}>
                  <div className={styles.employeeHeader}>
                    <div>
                      <p className={styles.employeeName}>Picadas de {selectedEmployee.fullName}</p>
                      <p className={styles.employeeMeta}>
                        {selectedEmployee.biometricCode || "s/n"} · {selectedEmployee.department || "Sin departamento"}
                      </p>
                    </div>
                    <div className={styles.employeeCount}>
                      <FileSpreadsheet size={16} />
                      <span>{selectedEmployee.punchCount} picadas</span>
                    </div>
                  </div>

                  <div className={styles.punchList}>
                    {selectedEmployee.punches.length ? (
                      groupPunchesByWeek(selectedEmployee.punches).map((week) => (
                        <section key={`${selectedEmployee.biometricCode}-${week.weekKey}`} className={styles.weekGroup}>
                          <div className={styles.weekHeader}>
                            <span className={styles.weekTitle}>{week.label}</span>
                            <span className={styles.weekCount}>{week.punches.length} picadas</span>
                          </div>

                          <div className={styles.punchTableWrap}>
                            <table className={styles.punchTable}>
                              <colgroup>
                                <col className={styles.colDay} />
                                <col className={styles.colDate} />
                                <col className={styles.colPunches} />
                              </colgroup>
                              <thead>
                                <tr>
                                  <th>Día</th>
                                  <th>Fecha</th>
                                  <th>Picadas</th>
                                </tr>
                              </thead>
                              <tbody>
                                {groupPunchesByDay(week.punches).map((day) => (
                                  <tr
                                    key={`${selectedEmployee.biometricCode}-${week.weekKey}-${day.dayKey}`}
                                  >
                                    <td className={styles.punchDay}>
                                      {formatDayName(day.punches[0]?.punchedAt)}
                                    </td>
                                    <td className={styles.punchDate}>
                                      {formatDate(day.punches[0]?.punchedAt)}
                                    </td>
                                    <td>
                                      <div className={styles.punchChips}>
                                        {day.punches.length ? (
                                          day.punches.map((punch, index) => (
                                            <span
                                              key={`${day.dayKey}-${punch.punchedAt}-${index}`}
                                              className={styles.punchChip}
                                            >
                                              {formatTime(punch.punchedAt)}
                                            </span>
                                          ))
                                        ) : (
                                          <span className={styles.punchChipEmpty}>--</span>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      ))
                    ) : (
                      <div className={styles.emptyPunches}>No se encontraron picadas para este empleado.</div>
                    )}
                  </div>
                </article>
              ) : (
                <div className={styles.emptyEmployees}>
                  Selecciona un empleado en la tabla superior para revisar sus picadas.
                </div>
              )}
            </div>

            {response.parserLogs?.length ? (
              <div className={styles.logs}>
                <h3 className={styles.logsTitle}>Trazas del parser</h3>
                <ul className={styles.logsList}>
                  {response.parserLogs.slice(0, 16).map((log, index) => (
                    <li key={`${log}-${index}`}>{log}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </>
  );
}
