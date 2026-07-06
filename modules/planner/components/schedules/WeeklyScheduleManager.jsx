"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Eraser,
  Search,
  Save,
  X,
} from "lucide-react";
import { addMonths, addWeeks, format } from "date-fns";
import { es } from "date-fns/locale";
import {
  buildDefaultWeeklySchedule,
  DAY_TYPES,
  formatWeekRangeLabel,
  formatWeekStartKey,
  normalizeWeekStartKey,
} from "@/modules/planner/lib/schedules";
import styles from "@/modules/planner/styles/components/schedules/WeeklyScheduleManager.module.scss";

const LUNCH_OPTIONS = [
  { value: 0, label: "Sin almuerzo" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hora" },
  { value: 90, label: "1h 30min" },
];

function getDayTypeMeta(dayType) {
  return DAY_TYPES.find((item) => item.value === dayType);
}

function serializeRows(rows) {
  return JSON.stringify(rows);
}

function parseTimeToMinutes(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
}

function normalizeLunchDurationMinutes(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(Math.round(value), 0);
  }

  const normalizedValue = String(value || "").trim().toLowerCase();

  if (!normalizedValue) {
    return 0;
  }

  if (/^\d+$/.test(normalizedValue)) {
    return Math.max(Number(normalizedValue), 0);
  }

  const hourMinuteMatch = normalizedValue.match(/^(\d+)\s*h(?:\s*(\d+)\s*min?)?$/);

  if (hourMinuteMatch) {
    const hours = Number(hourMinuteMatch[1] || 0);
    const minutes = Number(hourMinuteMatch[2] || 0);
    return Math.max(hours * 60 + minutes, 0);
  }

  const colonMatch = normalizedValue.match(/^(\d+):(\d{2})$/);

  if (colonMatch) {
    const hours = Number(colonMatch[1] || 0);
    const minutes = Number(colonMatch[2] || 0);
    return Math.max(hours * 60 + minutes, 0);
  }

  return 0;
}

function formatWorkedDuration(row, isReadOnly) {
  const typeMeta = getDayTypeMeta(row.dayType);

  if (!typeMeta?.isWorkingDay) {
    return isReadOnly ? "--" : "0h 00m";
  }

  const startMinutes = parseTimeToMinutes(row.startTime);
  const endMinutes = parseTimeToMinutes(row.endTime);

  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return "--";
  }

  const lunchMinutes = row.hasLunch === false ? 0 : normalizeLunchDurationMinutes(row.lunchDurationMinutes);
  const workedMinutes = Math.max(endMinutes - startMinutes - lunchMinutes, 0);
  const hours = Math.floor(workedMinutes / 60);
  const minutes = workedMinutes % 60;

  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function calculateWorkedMinutes(row) {
  const typeMeta = getDayTypeMeta(row.dayType);

  if (!typeMeta?.isWorkingDay) {
    return 0;
  }

  const startMinutes = parseTimeToMinutes(row.startTime);
  const endMinutes = parseTimeToMinutes(row.endTime);

  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return null;
  }

  const lunchMinutes = row.hasLunch === false ? 0 : normalizeLunchDurationMinutes(row.lunchDurationMinutes);
  return Math.max(endMinutes - startMinutes - lunchMinutes, 0);
}

function formatPotentialExtraLabel(row) {
  const typeMeta = getDayTypeMeta(row.dayType);
  const workedMinutes = calculateWorkedMinutes(row);

  if (!typeMeta?.isWorkingDay || workedMinutes === null || workedMinutes <= 0) {
    return { tone: "neutral", label: "--" };
  }

  if (row.dayType === "weekend_overtime") {
    const hours = Math.floor(workedMinutes / 60);
    const minutes = workedMinutes % 60;
    return {
      tone: "extraordinary",
      label: `${hours}h ${String(minutes).padStart(2, "0")}m extra`,
    };
  }

  const baseMinutes = 8 * 60;

  if (workedMinutes <= baseMinutes) {
    return { tone: "neutral", label: "--" };
  }

  const extraMinutes = workedMinutes - baseMinutes;
  const hours = Math.floor(extraMinutes / 60);
  const minutes = extraMinutes % 60;

  return {
    tone: "warning",
    label: `+${hours}h ${String(minutes).padStart(2, "0")}m`,
  };
}

function buildEmptyWeeklyRows() {
  return buildDefaultWeeklySchedule().map((row) => ({
    ...row,
    dayType: "workday",
    startTime: "",
    lunchDurationMinutes: 0,
    hasLunch: false,
    endTime: "",
    isWorkingDay: true,
    isPaidDay: false,
  }));
}

export default function WeeklyScheduleManager() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const employeeIdFromUrl = searchParams.get("employeeId") || "";
  const weekStartFromUrl = searchParams.get("weekStart") || "";
  const activeWeekStart = normalizeWeekStartKey(weekStartFromUrl);
  const activeWeekLabel = formatWeekRangeLabel(activeWeekStart);
  const activeMonthLabel = format(new Date(`${activeWeekStart}T00:00:00`), "MMMM yyyy", {
    locale: es,
  });
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [rows, setRows] = useState([]);
  const [contentAnimationKey, setContentAnimationKey] = useState(0);
  const [savedRowsSignature, setSavedRowsSignature] = useState("");
  const [toast, setToast] = useState(null);
  const [isPending, startTransition] = useTransition();
  const [isEmployeesLoading, setIsEmployeesLoading] = useState(true);
  const [isScheduleLoading, setIsScheduleLoading] = useState(false);
  const [hasLoadedSchedule, setHasLoadedSchedule] = useState(false);
  const [loadedScheduleKey, setLoadedScheduleKey] = useState("");
  const [isInitialSelectionResolved, setIsInitialSelectionResolved] = useState(false);
  const toastTimeoutRef = useRef(null);

  function updateRouteParams(nextValues) {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(nextValues).forEach(([key, value]) => {
      if (!value) {
        params.delete(key);
        return;
      }

      params.set(key, value);
    });

    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

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

  useEffect(() => {
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/employees");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo cargar la lista de empleados.");
        }

        const loadedEmployees = payload.employees || [];
        setEmployees(loadedEmployees);
      } catch (requestError) {
        showToast("error", requestError.message);
      } finally {
        setIsInitialSelectionResolved(true);
        setIsEmployeesLoading(false);
      }
    });

    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  async function loadEmployeeSchedule(employeeId, weekStart) {
    const response = await fetch(
      `/api/planner/work-schedules?employeeId=${employeeId}&weekStart=${weekStart}`,
    );
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "No se pudo cargar el horario del empleado.");
    }

    const loadedRows = payload.rows || [];
    setRows(loadedRows);
    setSavedRowsSignature(serializeRows(loadedRows));
  }

  useEffect(() => {
    let isCancelled = false;
    const requestedScheduleKey = `${employeeIdFromUrl}:${activeWeekStart}`;

    async function syncSelectedEmployee() {
      if (isEmployeesLoading) {
        return;
      }

      if (!employeeIdFromUrl) {
        if (!isCancelled) {
          setSelectedEmployeeId("");
          setRows([]);
          setSavedRowsSignature("");
          setHasLoadedSchedule(false);
          setLoadedScheduleKey("");
          setIsScheduleLoading(false);
          setIsInitialSelectionResolved(true);
        }
        return;
      }

      const employeeExists = employees.some((employee) => employee.id === employeeIdFromUrl);

      if (!employeeExists) {
        if (!isCancelled) {
          setSelectedEmployeeId("");
          setRows([]);
          setSavedRowsSignature("");
          setHasLoadedSchedule(false);
          setLoadedScheduleKey("");
          setIsScheduleLoading(false);
          setIsInitialSelectionResolved(true);
        }
        return;
      }

      if (requestedScheduleKey === loadedScheduleKey && hasLoadedSchedule) {
        if (!isCancelled) {
          setIsInitialSelectionResolved(true);
        }
        return;
      }

      if (!isCancelled) {
        setSelectedEmployeeId(employeeIdFromUrl);
        setContentAnimationKey((current) => current + 1);
        setRows([]);
        setSavedRowsSignature("");
        setIsScheduleLoading(true);
        setHasLoadedSchedule(false);
      }

      try {
        await loadEmployeeSchedule(employeeIdFromUrl, activeWeekStart);

        if (!isCancelled) {
          setHasLoadedSchedule(true);
          setLoadedScheduleKey(requestedScheduleKey);
        }
      } catch (requestError) {
        if (!isCancelled) {
          showToast("error", requestError.message);
        }
      } finally {
        if (!isCancelled) {
          setIsScheduleLoading(false);
          setIsInitialSelectionResolved(true);
        }
      }
    }

    syncSelectedEmployee();

    return () => {
      isCancelled = true;
    };
  }, [
    activeWeekStart,
    employeeIdFromUrl,
    employees,
    hasLoadedSchedule,
    isEmployeesLoading,
    loadedScheduleKey,
  ]);

  const filteredEmployees = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return employees.filter((employee) =>
      employee.fullName.toLowerCase().includes(normalizedSearch),
    );
  }, [employees, search]);

  function handleSelectEmployee(employeeId) {
    if (employeeId === employeeIdFromUrl) {
      return;
    }

    setToast(null);
    updateRouteParams({ employeeId, weekStart: activeWeekStart });
  }

  function handleWeekChange(nextWeekStart) {
    const normalizedWeekStart = normalizeWeekStartKey(nextWeekStart);

    if (normalizedWeekStart === activeWeekStart) {
      return;
    }

    setToast(null);
    updateRouteParams({ employeeId: employeeIdFromUrl, weekStart: normalizedWeekStart });
  }

  function shiftWeek(amount) {
    const shiftedWeekStart = formatWeekStartKey(
      addWeeks(new Date(`${activeWeekStart}T00:00:00`), amount),
    );
    handleWeekChange(shiftedWeekStart);
  }

  function shiftMonth(amount) {
    const shiftedWeekStart = formatWeekStartKey(
      addMonths(new Date(`${activeWeekStart}T00:00:00`), amount),
    );
    handleWeekChange(shiftedWeekStart);
  }

  function updateRow(dayOfWeek, updates) {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (row.dayOfWeek !== dayOfWeek) {
          return row;
        }

        const nextRow = { ...row, ...updates };
        const typeMeta = getDayTypeMeta(nextRow.dayType);

        if (!typeMeta?.isWorkingDay) {
          nextRow.startTime = "";
          nextRow.lunchDurationMinutes = 0;
          nextRow.hasLunch = false;
          nextRow.endTime = "";
        }

        if (typeMeta?.isWorkingDay && updates.dayType === "weekend_overtime" && row.dayOfWeek === 0) {
          nextRow.hasLunch = false;
          nextRow.lunchDurationMinutes = 0;
        }

        if (updates.hasLunch === false) {
          nextRow.lunchDurationMinutes = 0;
        }

        if (updates.lunchDurationMinutes === 0) {
          nextRow.hasLunch = false;
        }

        if (updates.lunchDurationMinutes > 0) {
          nextRow.hasLunch = true;
        }

        return nextRow;
      }),
    );
  }

  function handleSave() {
    if (!selectedEmployeeId) {
      showToast("error", "Selecciona primero un empleado.");
      return;
    }

    setToast(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/work-schedules", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            employeeId: selectedEmployeeId,
            weekStart: activeWeekStart,
            rows,
          }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar el horario.");
        }

        showToast(
          "success",
          `Horario semanal guardado correctamente para la semana del ${payload.weekLabel || activeWeekLabel}.`,
        );
        setSavedRowsSignature(serializeRows(rows));
      } catch (requestError) {
        showToast("error", requestError.message);
      }
    });
  }

  function handleClearAll() {
    if (!selectedEmployeeId) {
      showToast("error", "Selecciona primero un empleado.");
      return;
    }

    setRows(buildDefaultWeeklySchedule());
    setToast(null);
  }

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId);
  const isTableReadOnly = !selectedEmployee || isScheduleLoading || !hasLoadedSchedule;
  const displayRows =
    selectedEmployee && hasLoadedSchedule && rows.length ? rows : buildEmptyWeeklyRows();
  const hasUnsavedChanges =
    Boolean(selectedEmployeeId) &&
    rows.length > 0 &&
    serializeRows(rows) !== savedRowsSignature;
  const showInitialLoading =
    !isInitialSelectionResolved || (isEmployeesLoading && !selectedEmployeeId);

  return (
    <>
      {toast ? (
        <div
          className={`${styles.toast} ${
            toast.type === "success" ? styles.toastSuccess : styles.toastError
          }`}
          role="status"
          aria-live="polite"
        >
          <div className={styles.toastIcon}>
            {toast.type === "success" ? (
              <CheckCircle2 size={18} />
            ) : (
              <AlertCircle size={18} />
            )}
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

      <div className={styles.layout}>
        <section className={styles.sidePanel}>
        <div className={styles.panelHeader}>
          <p className={styles.eyebrow}>Paso 1</p>
          <h2 className={styles.title}>Selecciona un empleado</h2>
          <p className={styles.description}>
            Busca por nombre completo para comenzar a configurar o revisar horarios.
          </p>
        </div>

        <label className={styles.searchField}>
          <span className={styles.label}>Buscar por nombre</span>
          <div className={styles.searchInputWrap}>
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ej. Juan Pérez"
              className={styles.searchInput}
            />
          </div>
        </label>

        <div className={styles.employeeList}>
          {isEmployeesLoading ? (
            <div className={styles.employeeListLoading}>
              <div className={styles.loadingSpinner} />
              <span>Cargando empleados...</span>
            </div>
          ) : null}

          {!isEmployeesLoading
            ? filteredEmployees.map((employee) => (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => handleSelectEmployee(employee.id)}
                  className={`${styles.employeeItem} ${
                    selectedEmployeeId === employee.id ? styles.employeeItemActive : ""
                  }`}
                >
                  <span className={styles.employeeName}>{employee.fullName}</span>
                  <span className={styles.employeeMeta}>
                    {employee.branch} · {employee.organizationLabel || employee.department || "Sin estructura"} · {employee.biometricCode || "s/n"}
                  </span>
                </button>
              ))
            : null}

          {!isEmployeesLoading && !filteredEmployees.length ? (
            <div className={styles.emptyEmployees}>No hay empleados que coincidan con la búsqueda.</div>
          ) : null}
        </div>
        </section>

        <section key={contentAnimationKey} className={styles.mainPanel}>
        <div className={styles.mainHeader}>
          <div className={styles.mainHeaderCopy}>
            <p className={styles.eyebrow}>Paso 2</p>
            <h2 className={styles.title}>Configura la semana</h2>
            <p className={styles.description}>
              Define entradas, salidas, almuerzo, vacaciones, feriados y fines de semana extraordinarios para una semana específica.
            </p>
          </div>

          <div className={styles.headerActions}>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={!selectedEmployeeId || !rows.length || isPending}
              className={styles.clearButton}
            >
              <Eraser size={16} />
              Limpiar campos
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={!selectedEmployeeId || !rows.length || !hasUnsavedChanges || isPending}
              className={styles.saveButton}
            >
              <Save size={16} />
              {isPending ? "Guardando..." : "Guardar semana"}
            </button>
          </div>
        </div>

        {showInitialLoading ? (
          <div className={styles.placeholder}>
            Cargando contexto del horario...
          </div>
        ) : selectedEmployee ? (
          <div className={styles.employeeSummary}>
            <CalendarDays size={18} />
            <span>
              Configurando horario para <strong>{selectedEmployee.fullName}</strong> en la semana del{" "}
              <strong>{activeWeekLabel}</strong>
            </span>
          </div>
        ) : (
          <div className={styles.placeholder}>
            Selecciona un empleado para comenzar a configurar su horario semanal.
          </div>
        )}

        {selectedEmployee && !showInitialLoading ? (
          <div className={styles.scheduleToolbar}>
            <div className={styles.toolbarBlock}>
              <span className={styles.toolbarLabel}>Mes</span>
              <div className={styles.toolbarControls}>
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  className={styles.toolbarNavButton}
                  aria-label="Mes anterior"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className={styles.toolbarPill}>
                  <CalendarRange size={16} />
                  <span className={styles.toolbarPillText}>{activeMonthLabel}</span>
                </div>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  className={styles.toolbarNavButton}
                  aria-label="Mes siguiente"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className={styles.toolbarBlock}>
              <span className={styles.toolbarLabel}>Semana</span>
              <div className={styles.toolbarControls}>
                <button
                  type="button"
                  onClick={() => shiftWeek(-1)}
                  className={styles.toolbarNavButton}
                  aria-label="Semana anterior"
                >
                  <ChevronLeft size={16} />
                </button>
                <label className={styles.weekPicker}>
                  <input
                    type="date"
                    value={activeWeekStart}
                    onChange={(event) => handleWeekChange(event.target.value)}
                    className={styles.weekInput}
                  />
                  <span className={styles.toolbarPill}>
                    <CalendarDays size={16} />
                    <span className={styles.toolbarPillText}>{activeWeekLabel}</span>
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => shiftWeek(1)}
                  className={styles.toolbarNavButton}
                  aria-label="Semana siguiente"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className={`${styles.tableWrap} ${isTableReadOnly ? styles.tableWrapMuted : ""}`}>
          {selectedEmployee && isScheduleLoading ? (
            <div className={styles.tableOverlay}>
              <div className={styles.loadingSpinner} />
              <span>Cargando horario del empleado...</span>
            </div>
          ) : null}

          {!selectedEmployee && !showInitialLoading ? (
            <div className={styles.tableOverlay}>
              <span>Selecciona un empleado para habilitar la edición del horario.</span>
            </div>
          ) : null}

          {!selectedEmployee && showInitialLoading ? (
            <div className={styles.tableOverlay}>
              <div className={styles.loadingSpinner} />
              <span>Cargando contexto del horario...</span>
            </div>
          ) : null}

            <div className={styles.scroll}>
              <table className={styles.table}>
                <colgroup>
                  <col className={styles.colDay} />
                  <col className={styles.colType} />
                <col className={styles.colTime} />
                <col className={styles.colLunch} />
                <col className={styles.colTime} />
                <col className={styles.colTotal} />
                <col className={styles.colExtra} />
              </colgroup>
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Tipo</th>
                    <th>Entrada</th>
                  <th>Descuento almuerzo</th>
                  <th>Salida</th>
                  <th>Horas total</th>
                  <th>Extra potencial</th>
                </tr>
              </thead>
              <tbody>
                  {displayRows.map((row) => {
                    const typeMeta = getDayTypeMeta(row.dayType);
                    const disableTimeFields = !typeMeta?.isWorkingDay || isTableReadOnly;
                    const extraIndicator = formatPotentialExtraLabel(row);

                    return (
                      <tr key={row.dayOfWeek}>
                        <td>
                          <div className={styles.dayCell}>
                            <span className={styles.dayName}>{row.label}</span>
                            <span className={styles.dayHint}>
                              {row.dayOfWeek === 0 || row.dayOfWeek === 6
                                ? "Fin de semana"
                                : "Jornada ordinaria"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <select
                            value={row.dayType}
                            disabled={isTableReadOnly}
                            onChange={(event) =>
                              updateRow(row.dayOfWeek, { dayType: event.target.value })
                            }
                            className={styles.select}
                          >
                            {DAY_TYPES.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div className={styles.timeField}>
                            <Clock3 size={14} />
                            <input
                              type="time"
                              value={row.startTime}
                              disabled={disableTimeFields}
                              onChange={(event) =>
                                updateRow(row.dayOfWeek, { startTime: event.target.value })
                              }
                              className={styles.timeInput}
                            />
                          </div>
                        </td>
                        <td>
                          <select
                            value={row.lunchDurationMinutes}
                            disabled={disableTimeFields}
                            onChange={(event) =>
                              updateRow(row.dayOfWeek, {
                                lunchDurationMinutes: Number(event.target.value),
                              })
                            }
                            className={styles.select}
                          >
                            {LUNCH_OPTIONS.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div className={styles.timeField}>
                            <Clock3 size={14} />
                            <input
                              type="time"
                              value={row.endTime}
                              disabled={disableTimeFields}
                              onChange={(event) =>
                                updateRow(row.dayOfWeek, { endTime: event.target.value })
                              }
                              className={styles.timeInput}
                            />
                          </div>
                        </td>
                        <td>
                          <span className={styles.totalHoursValue}>
                            {formatWorkedDuration(row, isTableReadOnly)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`${styles.extraTag} ${
                              extraIndicator.tone === "warning"
                                ? styles.extraTagWarning
                                : extraIndicator.tone === "extraordinary"
                                  ? styles.extraTagExtraordinary
                                  : styles.extraTagNeutral
                            }`}
                          >
                            {extraIndicator.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
        </div>
        </section>
      </div>
    </>
  );
}
