"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { AlertCircle, CalendarDays, CheckCircle2, ChevronDown, Save, Search, UserRound, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  formatEcuadorDateKey,
  formatEcuadorDateTime,
  formatTime24,
  getEcuadorParts,
} from "@/lib/datetime/ecuador";
import { planningModulePath } from "@/modules/planner/routes";
import styles from "@/modules/planner/styles/components/payroll/PayrollPunchesView.module.scss";

const FILTER_OPTIONS = [
  { value: "month", label: "Mes" },
  { value: "week", label: "Semana" },
  { value: "day", label: "Día" },
];

const OVERTIME_DECISION_OPTIONS = [
  { value: "", label: "Pendiente" },
  { value: "supplementary", label: "Sí, suplementaria" },
  { value: "not_applicable", label: "No aplica" },
];

const INCOMPLETE_DAY_OPTIONS = [
  { value: "", label: "Pendiente" },
  { value: "valid_day", label: "Validar día normal" },
  { value: "absence", label: "Marcar falta" },
];

const FILTER_MODE_VALUES = new Set(FILTER_OPTIONS.map((option) => option.value));

function formatDateTime(value) {
  return formatEcuadorDateTime(value);
}

function formatDate(value) {
  return formatEcuadorDateKey(value);
}

function formatMonth(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  const parts = getEcuadorParts(parsed);

  if (!parts) {
    return "";
  }

  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function formatWeek(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  const parts = getEcuadorParts(parsed);

  if (!parts) {
    return "";
  }

  const shifted = new Date(Date.UTC(parts.year, parts.monthIndex, parts.day));
  return format(shifted, "RRRR-'W'II");
}

function capitalizeLabel(value) {
  if (!value) {
    return "";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatCompactDateLabel(value) {
  if (!value) {
    return "--";
  }

  const parsed = parseISO(value);

  if (Number.isNaN(parsed.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    day: "numeric",
    weekday: "long",
    month: "long",
  }).format(parsed);
}

function formatHourForSchedule(value) {
  return formatTime24(value, "--");
}

function formatLunchDuration(minutes) {
  if (!minutes) {
    return "sin almuerzo";
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (!hours) {
    return `${remainingMinutes}m`;
  }

  if (!remainingMinutes) {
    return `${hours}h`;
  }

  return `${hours}h${remainingMinutes}`;
}

function buildScheduleLine(schedule) {
  if (!schedule) {
    return "Sin horario configurado";
  }

  if (schedule.dayType === "off_day") {
    return "No trabaja";
  }

  if (!schedule.startTime && !schedule.endTime) {
    return schedule.dayTypeLabel || "Horario incompleto";
  }

  const lunchLabel =
    schedule.hasLunch && schedule.lunchDurationMinutes > 0
      ? `almuerzo ${formatLunchDuration(schedule.lunchDurationMinutes)}`
      : "sin almuerzo";

  return `${formatHourForSchedule(schedule.startTime)} - ${lunchLabel} - ${formatHourForSchedule(schedule.endTime)}`;
}

function parseTimeLabelToMinutes(value) {
  if (!value || value === "--") {
    return null;
  }

  const [hours, minutes] = String(value).split(":").map(Number);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
}

function buildActualAttendanceSummary(day) {
  const checkIn = day.matched?.checkIn && day.matched.checkIn !== "--" ? day.matched.checkIn : "--";
  const checkOut = day.matched?.checkOut && day.matched.checkOut !== "--" ? day.matched.checkOut : "--";
  const lunchOutMinutes = parseTimeLabelToMinutes(day.matched?.lunchOut);
  const lunchInMinutes = parseTimeLabelToMinutes(day.matched?.lunchIn);

  let lunchLabel = "--";

  if (day.schedule?.hasLunch === false) {
    lunchLabel = "Sin almuerzo";
  } else if (lunchOutMinutes !== null && lunchInMinutes !== null && lunchInMinutes >= lunchOutMinutes) {
    lunchLabel = formatLunchDuration(lunchInMinutes - lunchOutMinutes);
  }

  return {
    checkIn,
    lunchLabel,
    checkOut,
  };
}

function formatWorkedHoursLabel(workedMinutes) {
  if (!Number.isFinite(workedMinutes) || workedMinutes < 0) {
    return "--";
  }

  const fullHours = Math.floor(workedMinutes / 60);
  return `${fullHours}h`;
}

function formatMinutesLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "--";
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (!hours) {
    return `${remainingMinutes}m`;
  }

  if (!remainingMinutes) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

function resolveDisplayedWorkedMinutes(day, incompleteDayDecision) {
  if (day.needsManualDayReview) {
    if (incompleteDayDecision === "valid_day") {
      return Math.min(day.scheduledWorkedMinutes || 0, 8 * 60);
    }

    if (incompleteDayDecision === "absence") {
      return 0;
    }

    return null;
  }

  if (day.schedule?.dayType === "weekend_overtime") {
    return 0;
  }

  return Number.isFinite(day.baseWorkedMinutes) ? day.baseWorkedMinutes : day.workedMinutes;
}

function formatExtraWorkedLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "";
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `+${hours}h ${String(remainingMinutes).padStart(2, "0")}m`;
}

function formatLateArrival(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "--";
  }

  return `${minutes}m`;
}

function getScheduleTypeTone(dayType) {
  if (dayType === "weekend_overtime") {
    return "overtime";
  }

  if (dayType === "holiday") {
    return "holiday";
  }

  if (dayType === "vacation") {
    return "vacation";
  }

  if (dayType === "off_day") {
    return "off";
  }

  return "workday";
}

function getValidMode(value) {
  return FILTER_MODE_VALUES.has(value) ? value : "month";
}

function buildFiltersQueryString({ employeeId, employeeName, mode, dayDate, weekValue, monthValue }) {
  const params = new URLSearchParams();

  if (employeeId) {
    params.set("employeeId", employeeId);
  }

  if (employeeName) {
    params.set("employeeName", employeeName);
  }

  params.set("mode", mode);

  if (mode === "day" && dayDate) {
    params.set("date", dayDate);
  }

  if (mode === "week" && weekValue) {
    params.set("week", weekValue);
  }

  if (mode === "month" && monthValue) {
    params.set("month", monthValue);
  }

  return params.toString();
}

export default function PayrollPunchesView() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const initialMode = getValidMode(searchParams.get("mode") || "month");
  const initialEmployeeId = searchParams.get("employeeId") || "";
  const initialEmployeeName = searchParams.get("employeeName") || "";
  const initialDayDate = searchParams.get("date") || formatDate(new Date());
  const initialWeekValue = searchParams.get("week") || formatWeek(new Date());
  const initialMonthValue = searchParams.get("month") || formatMonth(new Date());
  const [employees, setEmployees] = useState([]);
  const [isEmployeesLoading, setIsEmployeesLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [employeeQuery, setEmployeeQuery] = useState(initialEmployeeName);
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [mode, setMode] = useState(initialMode);
  const [dayDate, setDayDate] = useState(initialDayDate);
  const [weekValue, setWeekValue] = useState(initialWeekValue);
  const [monthValue, setMonthValue] = useState(initialMonthValue);
  const [result, setResult] = useState(null);
  const [overtimeDecisions, setOvertimeDecisions] = useState({});
  const [lateConfirmations, setLateConfirmations] = useState({});
  const [incompleteDayDecisions, setIncompleteDayDecisions] = useState({});
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [isPending, startTransition] = useTransition();
  const [isSavingSupplementary, startSavingSupplementary] = useTransition();
  const autocompleteRef = useRef(null);
  const hasAutoFetchedRef = useRef(false);
  const feedbackTimeoutRef = useRef(null);
  const isFilterDisabled = isEmployeesLoading || isPending || isSavingSupplementary;

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadEmployees() {
      try {
        if (!isCancelled) {
          setIsEmployeesLoading(true);
        }

        const response = await fetch("/api/company/employees");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo cargar la lista de empleados.");
        }

        if (!isCancelled) {
          setEmployees(payload.employees || []);
        }
      } catch (requestError) {
        if (!isCancelled) {
          setError(requestError.message);
        }
      } finally {
        if (!isCancelled) {
          setIsEmployeesLoading(false);
        }
      }
    }

    loadEmployees();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (!autocompleteRef.current?.contains(event.target)) {
        setIsAutocompleteOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = employeeQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return employees.slice(0, 8);
    }

    return employees
      .filter((employee) =>
        [employee.fullName, employee.organizationLabel, employee.roleName, employee.areaName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      )
      .slice(0, 8);
  }, [employees, employeeQuery]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === employeeId) || null,
    [employees, employeeId],
  );
  const visibleComparisons = useMemo(
    () => (result?.dailyComparisons || []).filter((day) => Boolean(day.schedule)),
    [result],
  );
  const candidateComparisons = useMemo(
    () => visibleComparisons.filter((day) => day.hasOvertimeCandidate),
    [visibleComparisons],
  );
  const lateCandidateComparisons = useMemo(
    () => visibleComparisons.filter((day) => day.hasLateArrival),
    [visibleComparisons],
  );
  const incompleteDayCandidateComparisons = useMemo(
    () => visibleComparisons.filter((day) => day.needsManualDayReview),
    [visibleComparisons],
  );
  const hasSupplementaryChanges = useMemo(
    () =>
      candidateComparisons.some(
        (day) => (overtimeDecisions[day.dateKey] ?? day.savedSupplementaryDecision ?? "") !== (day.savedSupplementaryDecision ?? ""),
      ),
    [candidateComparisons, overtimeDecisions],
  );
  const hasLateChanges = useMemo(
    () =>
      lateCandidateComparisons.some(
        (day) => (lateConfirmations[day.dateKey] ?? day.savedLateConfirmation ?? false) !== (day.savedLateConfirmation ?? false),
      ),
    [lateCandidateComparisons, lateConfirmations],
  );
  const hasIncompleteDayChanges = useMemo(
    () =>
      incompleteDayCandidateComparisons.some(
        (day) =>
          (incompleteDayDecisions[day.dateKey] ?? day.savedIncompleteDayDecision ?? "") !==
          (day.savedIncompleteDayDecision ?? ""),
      ),
    [incompleteDayCandidateComparisons, incompleteDayDecisions],
  );
  const supplementaryChangesCount = useMemo(
    () =>
      candidateComparisons.filter(
        (day) => (overtimeDecisions[day.dateKey] ?? day.savedSupplementaryDecision ?? "") !== (day.savedSupplementaryDecision ?? ""),
      ).length,
    [candidateComparisons, overtimeDecisions],
  );
  const lateChangesCount = useMemo(
    () =>
      lateCandidateComparisons.filter(
        (day) => (lateConfirmations[day.dateKey] ?? day.savedLateConfirmation ?? false) !== (day.savedLateConfirmation ?? false),
      ).length,
    [lateCandidateComparisons, lateConfirmations],
  );
  const incompleteDayChangesCount = useMemo(
    () =>
      incompleteDayCandidateComparisons.filter(
        (day) =>
          (incompleteDayDecisions[day.dateKey] ?? day.savedIncompleteDayDecision ?? "") !==
          (day.savedIncompleteDayDecision ?? ""),
      ).length,
    [incompleteDayCandidateComparisons, incompleteDayDecisions],
  );
  const totalChangesCount =
    supplementaryChangesCount + lateChangesCount + incompleteDayChangesCount;
  const estimateHref = useMemo(() => {
    if (!employeeId) {
      return "#";
    }

    const params = new URLSearchParams();
    params.set("employeeId", employeeId);
    params.set("employeeName", selectedEmployee?.fullName || employeeQuery || result?.employee?.fullName || "");
    params.set("month", mode === "month" ? monthValue : formatMonth(result?.range?.start || new Date()));

    return `${planningModulePath("/payroll/estimate")}?${params.toString()}`;
  }, [employeeId, employeeQuery, mode, monthValue, result?.employee?.fullName, result?.range?.start, selectedEmployee?.fullName]);

  function syncFiltersToUrl(nextFilters) {
    const queryString = buildFiltersQueryString(nextFilters);
    const href = queryString ? `${pathname}?${queryString}` : pathname;

    router.replace(href, { scroll: false });
  }

  async function runQuery(filterValues) {
    const params = new URLSearchParams({
      employeeId: filterValues.employeeId,
      mode: filterValues.mode,
    });

    if (filterValues.mode === "day") {
      params.set("date", filterValues.dayDate);
    } else if (filterValues.mode === "week") {
      params.set("week", filterValues.weekValue);
    } else {
      params.set("month", filterValues.monthValue);
    }

    const response = await fetch(`/api/planner/payroll/punches?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "No se pudieron consultar las picadas.");
    }

    return payload;
  }

  function showFeedback(type, message) {
    setFeedback({ type, message });

    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }

    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedback(null);
      feedbackTimeoutRef.current = null;
    }, 5000);
  }

  useEffect(() => {
    if (hasAutoFetchedRef.current || !employeeId) {
      return;
    }

    hasAutoFetchedRef.current = true;

    startTransition(async () => {
      try {
        const payload = await runQuery({
          employeeId,
          mode,
          dayDate,
          weekValue,
          monthValue,
        });

        setResult(payload);
        setFeedback(null);
      } catch (requestError) {
        setResult(null);
        setError(requestError.message);
      }
    });
  }, [dayDate, employeeId, mode, monthValue, weekValue]);

  function handleSelectEmployee(employee) {
    setEmployeeId(employee.id);
    setEmployeeQuery(employee.fullName);
    setIsAutocompleteOpen(false);
    setError("");
    setFeedback(null);

    syncFiltersToUrl({
      employeeId: employee.id,
      employeeName: employee.fullName,
      mode,
      dayDate,
      weekValue,
      monthValue,
    });
  }

  function handleEmployeeInputChange(event) {
    const nextValue = event.target.value;

    setEmployeeQuery(nextValue);
    setEmployeeId("");
    setIsAutocompleteOpen(true);
    setResult(null);
    setFeedback(null);
    syncFiltersToUrl({
      employeeId: "",
      employeeName: "",
      mode,
      dayDate,
      weekValue,
      monthValue,
    });
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!employeeId) {
      setError("Debes seleccionar un empleado desde la lista.");
      return;
    }

    setError("");
    setFeedback(null);

    const currentFilters = {
      employeeId,
      employeeName: selectedEmployee?.fullName || employeeQuery,
      mode,
      dayDate,
      weekValue,
      monthValue,
    };

    syncFiltersToUrl(currentFilters);

    startTransition(async () => {
      try {
        const payload = await runQuery(currentFilters);
        setResult(payload);
      } catch (requestError) {
        setResult(null);
        setError(requestError.message);
      }
    });
  }

  function handleSaveSupplementary() {
    if (
      !employeeId ||
      (!candidateComparisons.length &&
        !lateCandidateComparisons.length &&
        !incompleteDayCandidateComparisons.length)
    ) {
      showFeedback("error", "No hay decisiones pendientes para guardar.");
      return;
    }

    setError("");
    setFeedback(null);

    const decisions = candidateComparisons.map((day) => ({
      date: day.dateKey,
      decision: overtimeDecisions[day.dateKey] ?? day.savedSupplementaryDecision ?? "",
      candidateMinutes: day.overtimeCandidateMinutes || 0,
      candidateHours: day.overtimeCandidateHours || 0,
      scheduledEnd: day.schedule?.endTime
        ? `${day.dateKey}T${day.schedule.endTime}:00`
        : null,
      actualCheckOut:
        day.matched?.checkOut && day.matched.checkOut !== "--"
          ? `${day.dateKey}T${day.matched.checkOut}:00`
          : null,
    }));
    const lateDecisions = lateCandidateComparisons.map((day) => ({
      date: day.dateKey,
      confirmed: lateConfirmations[day.dateKey] ?? day.savedLateConfirmation ?? false,
      lateMinutes: day.lateArrivalMinutes || 0,
      scheduledStart: day.schedule?.startTime ? `${day.dateKey}T${day.schedule.startTime}:00` : null,
      actualCheckIn:
        day.matched?.checkIn && day.matched.checkIn !== "--"
          ? `${day.dateKey}T${day.matched.checkIn}:00`
          : null,
    }));
    const dayDecisions = incompleteDayCandidateComparisons.map((day) => ({
      date: day.dateKey,
      decision: incompleteDayDecisions[day.dateKey] ?? day.savedIncompleteDayDecision ?? "",
      punchCount: day.punchCount || 0,
      scheduledStart: day.schedule?.startTime ? `${day.dateKey}T${day.schedule.startTime}:00` : null,
      scheduledEnd: day.schedule?.endTime ? `${day.dateKey}T${day.schedule.endTime}:00` : null,
      actualCheckIn:
        day.matched?.checkIn && day.matched.checkIn !== "--"
          ? `${day.dateKey}T${day.matched.checkIn}:00`
          : null,
    }));

    startSavingSupplementary(async () => {
      try {
        const response = await fetch("/api/planner/payroll/supplementary-decisions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            employeeId,
            decisions,
            lateDecisions,
            dayDecisions,
          }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudieron guardar las horas suplementarias.");
        }

        setResult((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            dailyComparisons: current.dailyComparisons.map((day) => ({
              ...day,
              savedSupplementaryDecision:
                overtimeDecisions[day.dateKey] ?? day.savedSupplementaryDecision ?? "",
              savedLateConfirmation:
                lateConfirmations[day.dateKey] ?? day.savedLateConfirmation ?? false,
              savedIncompleteDayDecision:
                incompleteDayDecisions[day.dateKey] ?? day.savedIncompleteDayDecision ?? "",
            })),
          };
        });

        showFeedback("success", "Las decisiones de revisión se guardaron correctamente.");
      } catch (requestError) {
        showFeedback("error", requestError.message);
      }
    });
  }

  return (
    <section className={styles.panel}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.filtersGrid}>
          <div className={`${styles.field} ${styles.employeeField}`}>
            <label className={styles.label}>Empleado</label>
            <div ref={autocompleteRef} className={styles.autocomplete}>
              <div className={styles.searchWrap}>
                <Search size={16} />
                <input
                  value={employeeQuery}
                  onChange={handleEmployeeInputChange}
                  onFocus={() => setIsAutocompleteOpen(true)}
                  placeholder={isEmployeesLoading ? "Cargando empleados..." : "Escribe el nombre del empleado"}
                  className={styles.input}
                  disabled={isFilterDisabled}
                />
                <ChevronDown size={16} className={styles.chevron} />
              </div>

              {isAutocompleteOpen && !isEmployeesLoading ? (
                <div className={styles.autocompleteMenu}>
                  {filteredEmployees.length ? (
                    filteredEmployees.map((employee) => (
                      <button
                        key={employee.id}
                        type="button"
                        className={styles.autocompleteOption}
                        onClick={() => handleSelectEmployee(employee)}
                      >
                        <span className={styles.autocompleteName}>{employee.fullName}</span>
                        <span className={styles.autocompleteMeta}>
                          {employee.branch}
                          {employee.department ? ` · ${employee.department}` : ""}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className={styles.autocompleteEmpty}>No encontramos empleados con ese nombre.</div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Consulta</label>
            <select
              value={mode}
              onChange={(event) => {
                const nextMode = event.target.value;
                setMode(nextMode);
                setResult(null);
                syncFiltersToUrl({
                  employeeId,
                  employeeName: selectedEmployee?.fullName || employeeQuery,
                  mode: nextMode,
                  dayDate,
                  weekValue,
                  monthValue,
                });
              }}
              className={styles.select}
              disabled={isFilterDisabled}
            >
              {FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {mode === "month" ? (
            <div className={styles.field}>
              <label className={styles.label}>Mes</label>
              <input
                type="month"
                value={monthValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setMonthValue(nextValue);
                  setResult(null);
                  syncFiltersToUrl({
                    employeeId,
                    employeeName: selectedEmployee?.fullName || employeeQuery,
                    mode,
                    dayDate,
                    weekValue,
                    monthValue: nextValue,
                  });
                }}
                className={styles.input}
                disabled={isFilterDisabled}
              />
            </div>
          ) : null}

          {mode === "week" ? (
            <div className={styles.field}>
              <label className={styles.label}>Semana</label>
              <input
                type="week"
                value={weekValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setWeekValue(nextValue);
                  setResult(null);
                  syncFiltersToUrl({
                    employeeId,
                    employeeName: selectedEmployee?.fullName || employeeQuery,
                    mode,
                    dayDate,
                    weekValue: nextValue,
                    monthValue,
                  });
                }}
                className={styles.input}
                disabled={isFilterDisabled}
              />
            </div>
          ) : null}

          {mode === "day" ? (
            <div className={styles.field}>
              <label className={styles.label}>Día</label>
              <input
                type="date"
                value={dayDate}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setDayDate(nextValue);
                  setResult(null);
                  syncFiltersToUrl({
                    employeeId,
                    employeeName: selectedEmployee?.fullName || employeeQuery,
                    mode,
                    dayDate: nextValue,
                    weekValue,
                    monthValue,
                  });
                }}
                className={styles.input}
                disabled={isFilterDisabled}
              />
            </div>
          ) : null}
        </div>

        <div className={styles.actions}>
          <div className={styles.selectionHint}>
            <UserRound size={15} />
            <span>
              {selectedEmployee
                ? "Empleado seleccionado"
                : "Selecciona un empleado para consultar"}
            </span>
          </div>

          <button type="submit" disabled={isFilterDisabled || !employeeId} className={styles.submit}>
            <CalendarDays size={16} />
            {isPending ? "Consultando..." : "Consultar picadas"}
          </button>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
      </form>

      {feedback ? (
        <div
          className={`${styles.toast} ${
            feedback.type === "success" ? styles.toastSuccess : styles.toastError
          }`}
          role="status"
          aria-live="polite"
        >
          <div className={styles.toastIcon}>
            {feedback.type === "success" ? (
              <CheckCircle2 size={18} />
            ) : (
              <AlertCircle size={18} />
            )}
          </div>
          <div className={styles.toastContent}>
            <p className={styles.toastTitle}>
              {feedback.type === "success" ? "Operación exitosa" : "Algo necesita atención"}
            </p>
            <p className={styles.toastMessage}>{feedback.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className={styles.toastClose}
            aria-label="Cerrar notificación"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {result ? (
        <div className={styles.results}>
          <div className={styles.summary}>
            <div className={styles.summaryTop}>
              <div>
                <p className={styles.summaryText}>
                  {result.summary?.totalPunches || 0} picadas registradas entre{" "}
                  {formatDateTime(result.range?.start)} y {formatDateTime(result.range?.end)}
                </p>
              </div>

              <Link href={estimateHref} className={styles.estimateLink}>
                Revisar estimación
              </Link>
            </div>
          </div>

          <div className={styles.tableWrap}>
            {candidateComparisons.length ||
            lateCandidateComparisons.length ||
            incompleteDayCandidateComparisons.length ? (
              <div className={styles.tableToolbar}>
                <div className={styles.toolbarInfo}>
                  <span className={styles.toolbarTitle}>Revisión manual</span>
                  <span className={styles.toolbarText}>
                    {totalChangesCount > 0
                      ? `${totalChangesCount} cambio${totalChangesCount === 1 ? "" : "s"} pendiente${totalChangesCount === 1 ? "" : "s"}`
                      : "Sin cambios pendientes"}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  disabled={
                    (!hasSupplementaryChanges &&
                      !hasLateChanges &&
                      !hasIncompleteDayChanges) ||
                    isSavingSupplementary
                  }
                  onClick={handleSaveSupplementary}
                >
                  <Save size={16} />
                  {isSavingSupplementary ? "Guardando..." : "Guardar decisiones"}
                </button>
              </div>
            ) : null}
            <div className={styles.scroll}>
              <table className={styles.table}>
                <colgroup>
                  <col className={styles.colDay} />
                  <col className={styles.colSchedule} />
                  <col className={styles.colLate} />
                  <col className={styles.colHours} />
                  <col className={styles.colSupplementary} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Horario y picadas</th>
                    <th>Atraso</th>
                    <th>Horas</th>
                    <th>Revisión</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleComparisons.length ? (
                    visibleComparisons.map((day) => {
                      const currentIncompleteDayDecision =
                        incompleteDayDecisions[day.dateKey] ??
                        day.savedIncompleteDayDecision ??
                        "";
                      const actualSummary = buildActualAttendanceSummary(day);
                      const isResolvedSinglePunch =
                        day.needsManualDayReview && Boolean(currentIncompleteDayDecision);
                      const rowClassName =
                        day.hasMissingPunches && !isResolvedSinglePunch
                          ? styles.issueRow
                          : undefined;

                      return (
                        <tr key={day.dateKey} className={rowClassName}>
                          <td>
                          <span className={styles.dateLabel}>
                            {capitalizeLabel(formatCompactDateLabel(day.dateKey))}
                          </span>
                          </td>
                          <td>
                            <div className={styles.comparisonCell}>
                              <div className={styles.scheduleLine}>
                                <span
                                  className={`${styles.scheduleIndicator} ${styles[`tone${capitalizeLabel(getScheduleTypeTone(day.schedule?.dayType))}`]}`}
                                  title={day.schedule?.dayTypeLabel || "Horario"}
                                  aria-label={day.schedule?.dayTypeLabel || "Horario"}
                                />
                                <span className={styles.scheduleText}>
                                  {buildScheduleLine(day.schedule)}
                                </span>
                              </div>

                              <div className={styles.actualSummary}>
                                <span className={styles.actualSummaryItem}>
                                  <strong>Entrada:</strong> {actualSummary.checkIn}
                                </span>
                                <span className={styles.actualSummaryItem}>
                                  <strong>Almuerzo:</strong> {actualSummary.lunchLabel}
                                </span>
                                <span className={styles.actualSummaryItem}>
                                  <strong>Salida:</strong> {actualSummary.checkOut}
                                </span>
                              </div>

                              <div className={styles.punchesWrap}>
                                {day.punches?.length ? (
                                  day.punches.map((punch) => (
                                    <span key={punch.id} className={styles.punchChip}>
                                      {punch.time}
                                    </span>
                                  ))
                                ) : (
                                  <span className={styles.emptyInline}>Sin picadas</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className={styles.lateCell}>
                            {day.hasLateArrival ? (
                              <label
                                className={`${styles.lateToggle} ${
                                  (lateConfirmations[day.dateKey] ?? day.savedLateConfirmation ?? false)
                                    ? styles.lateToggleActive
                                    : ""
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={lateConfirmations[day.dateKey] ?? day.savedLateConfirmation ?? false}
                                  onChange={(event) =>
                                    setLateConfirmations((current) => ({
                                      ...current,
                                      [day.dateKey]: event.target.checked,
                                    }))
                                  }
                                />
                                <span className={styles.lateTag}>
                                  {formatLateArrival(day.lateArrivalMinutes)}
                                </span>
                                <span className={styles.lateState}>
                                  {(lateConfirmations[day.dateKey] ?? day.savedLateConfirmation ?? false)
                                    ? "Confirmado"
                                    : "Pendiente"}
                                </span>
                              </label>
                            ) : (
                              <span className={styles.emptyInline}>--</span>
                            )}
                          </td>
                          <td className={styles.hoursCell}>
                            {formatWorkedHoursLabel(
                              resolveDisplayedWorkedMinutes(day, currentIncompleteDayDecision),
                            )}
                          </td>
                          <td>
                            {day.needsManualDayReview ? (
                              <div className={styles.reviewField}>
                                <select
                                  value={currentIncompleteDayDecision}
                                  onChange={(event) =>
                                    setIncompleteDayDecisions((current) => ({
                                      ...current,
                                      [day.dateKey]: event.target.value,
                                    }))
                                  }
                                  className={styles.inlineSelect}
                                >
                                  {INCOMPLETE_DAY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <span className={styles.overtimeHint}>
                                  {day.missingPunchesReason ||
                                    "No cuenta con los registros necesarios. Define si cuenta el día normal o como falta."}
                                </span>
                              </div>
                          ) : day.schedule?.dayType === "weekend_overtime" &&
                            Number(day.extraWorkedMinutes || 0) > 0 ? (
                            <div className={styles.overtimeField}>
                              <span className={styles.staticReviewTag}>Extraordinaria</span>
                              <span className={styles.overtimeHint}>
                                {formatExtraWorkedLabel(day.extraWorkedMinutes)} fuera de base
                              </span>
                            </div>
                          ) : day.hasOvertimeCandidate ? (
                            <div className={styles.overtimeField}>
                              <select
                                value={overtimeDecisions[day.dateKey] ?? day.savedSupplementaryDecision ?? ""}
                                  onChange={(event) =>
                                    setOvertimeDecisions((current) => ({
                                      ...current,
                                      [day.dateKey]: event.target.value,
                                    }))
                                  }
                                  className={styles.inlineSelect}
                                >
                                  {OVERTIME_DECISION_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                              </select>
                              <span className={styles.overtimeHint}>
                                {formatMinutesLabel(day.overtimeCandidateMinutes)} requiere revisión
                                {day.lateDepartureToleranceMinutes ? ` · ${day.lateDepartureToleranceMinutes}m de tolerancia` : ""}
                                {" · "}
                                salida excedida {formatMinutesLabel(day.rawOvertimeCandidateMinutes)}
                              </span>
                            </div>
                          ) : (
                              <span className={styles.emptyInline}>--</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className={styles.emptyCell}>
                        No hay días con horario cargado para este período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
