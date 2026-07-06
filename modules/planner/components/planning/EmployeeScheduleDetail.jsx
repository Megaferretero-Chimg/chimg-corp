"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";

import FloatingNotice from "@/components/ui/FloatingNotice";
import {
  getMonthWeekOptions,
  getWeekStartKey,
} from "@/modules/planner/lib/planning/scheduleAssignments";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import {
  ECUADOR_DAILY_BASE_HOURS,
  EXTRAORDINARY_SURCHARGE_MULTIPLIER,
  SUPPLEMENTARY_SURCHARGE_MULTIPLIER,
} from "@/modules/planner/lib/payroll/laborConstants";
import { calculatePayrollHourlyRate } from "@/modules/planner/lib/payroll/rates";
import { WEEK_DAYS } from "@/modules/planner/lib/schedules";
import styles from "@/modules/planner/styles/components/planning/EmployeeScheduleDetail.module.scss";

const DAY_LABELS = new Map(WEEK_DAYS.map((day) => [day.dayOfWeek, day.label]));
const WORKDAY_TYPES = new Set(["workday", "weekend_overtime"]);

function currentMonthKey() {
  return formatEcuadorMonthKey();
}

function formatClock(value) {
  return String(value || "").replace(":", "H");
}

function formatHourRange(startTime, endTime) {
  return `${formatClock(startTime)} A ${formatClock(endTime)}`;
}

function scheduleLine(day) {
  if (!day) {
    return "Sin horario";
  }

  if (day.dayType === "holiday") {
    return "Feriado";
  }

  if (day.dayType === "off_day") {
    return "Descanso";
  }

  if (!day.startTime || !day.endTime) {
    return "Horario incompleto";
  }

  if (day.lunchStartTime && day.lunchEndTime) {
    return `${formatHourRange(day.startTime, day.lunchStartTime)} ${formatHourRange(day.lunchEndTime, day.endTime)}`;
  }

  return formatHourRange(day.startTime, day.endTime);
}

function parseTimeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) {
    return null;
  }

  const [hours, minutes] = String(value).split(":").map(Number);

  return hours * 60 + minutes;
}

function workedNetMinutes(day) {
  const start = parseTimeToMinutes(day?.startTime);
  const end = parseTimeToMinutes(day?.endTime);

  if (start === null || end === null || end <= start) {
    return 0;
  }

  return Math.max(0, end - start - (Number(day?.lunchDurationMinutes) || 0));
}

function formatDuration(totalMinutes) {
  const safeMinutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (!hours) {
    return `${minutes}m`;
  }

  if (!minutes) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function lunchDurationLabel(day) {
  const lunchMinutes = Number(day?.lunchDurationMinutes) || 0;

  return lunchMinutes ? formatDuration(lunchMinutes) : "-";
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function isWorkedDay(day) {
  return Boolean(day?.startTime && day?.endTime && WORKDAY_TYPES.has(day?.dayType));
}

function createHourSummary() {
  return {
    workedDays: 0,
    laborMinutes: 0,
    supplementaryMinutes: 0,
    extraordinaryMinutes: 0,
    supplementaryAmount: 0,
    extraordinaryAmount: 0,
  };
}

function variableAmount(summary) {
  return summary.supplementaryAmount + summary.extraordinaryAmount;
}

function calculateWeekHourBreakdown(days = [], employee) {
  const dailyBaseMinutes = ECUADOR_DAILY_BASE_HOURS * 60;
  const salary = Number(employee?.salary) || 0;
  const hourlyRate = salary > 0 ? calculatePayrollHourlyRate(salary, ECUADOR_DAILY_BASE_HOURS * 30) : 0;
  const summary = createHourSummary();
  const daysByDate = new Map();
  const sortedDays = [...days].sort((left, right) => String(left?.dateKey || "").localeCompare(String(right?.dateKey || "")));
  let workedDays = 0;

  sortedDays.forEach((day) => {
    if (!isWorkedDay(day)) return;

    const netMinutes = workedNetMinutes(day);

    if (!netMinutes) return;

    const daySummary = createHourSummary();

    workedDays += 1;

    if (day.dayType === "weekend_overtime" || workedDays > 5) {
      daySummary.extraordinaryMinutes = netMinutes;
    } else {
      daySummary.laborMinutes = Math.min(netMinutes, dailyBaseMinutes);
      daySummary.supplementaryMinutes = Math.max(0, netMinutes - dailyBaseMinutes);
    }

    daySummary.supplementaryAmount = (daySummary.supplementaryMinutes / 60) * hourlyRate * SUPPLEMENTARY_SURCHARGE_MULTIPLIER;
    daySummary.extraordinaryAmount = (daySummary.extraordinaryMinutes / 60) * hourlyRate * EXTRAORDINARY_SURCHARGE_MULTIPLIER;
    daySummary.workedDays = 1;
    summary.workedDays += daySummary.workedDays;
    summary.laborMinutes += daySummary.laborMinutes;
    summary.supplementaryMinutes += daySummary.supplementaryMinutes;
    summary.extraordinaryMinutes += daySummary.extraordinaryMinutes;
    summary.supplementaryAmount += daySummary.supplementaryAmount;
    summary.extraordinaryAmount += daySummary.extraordinaryAmount;
    daysByDate.set(day.dateKey, daySummary);
  });

  return { summary, daysByDate };
}

function addHourSummaries(left, right) {
  return {
    workedDays: left.workedDays + right.workedDays,
    laborMinutes: left.laborMinutes + right.laborMinutes,
    supplementaryMinutes: left.supplementaryMinutes + right.supplementaryMinutes,
    extraordinaryMinutes: left.extraordinaryMinutes + right.extraordinaryMinutes,
    supplementaryAmount: left.supplementaryAmount + right.supplementaryAmount,
    extraordinaryAmount: left.extraordinaryAmount + right.extraordinaryAmount,
  };
}

function dayTone(dayType) {
  if (!dayType) {
    return styles.toneMissing;
  }

  if (dayType === "weekend_overtime") {
    return styles.toneExtra;
  }

  if (dayType === "holiday") {
    return styles.toneHoliday;
  }

  if (dayType === "off_day") {
    return styles.toneOff;
  }

  return styles.toneWork;
}

function isWeekendDay(day) {
  return day?.dayOfWeek === 0 || day?.dayOfWeek === 6;
}

function isExtraDay(day) {
  return day?.dayType === "weekend_overtime" && day?.startTime === "08:00" && day?.endTime === "14:00";
}

function dayDisplayTone(day) {
  if (!day || day.source === "empty") {
    return dayTone("");
  }

  if (day.dayType === "weekend_overtime" && !isExtraDay(day)) {
    return dayTone("workday");
  }

  return dayTone(day.dayType);
}

function employeeCoverageOptions(employee) {
  const assignments = Array.isArray(employee?.roleAssignments) ? employee.roleAssignments : [];
  const optionsByCode = new Map();

  assignments.forEach((role) => {
    const code = String(role?.code || "").trim();

    if (!code) return;

    optionsByCode.set(code, {
      code,
      name: role?.name || code,
    });
  });

  if (optionsByCode.size) {
    return [...optionsByCode.values()];
  }

  if (employee?.roleCode) {
    optionsByCode.set(employee.roleCode, {
      code: employee.roleCode,
      name: employee.roleName || employee.roleCode,
    });
  }

  return [...optionsByCode.values()];
}

function weekCoverageLabel(days, employee) {
  const options = employeeCoverageOptions(employee);

  if (options.length <= 1) {
    return "";
  }

  const optionByCode = new Map(options.map((option) => [option.code, option]));
  const roleDay = days.find((day) => day?.roleCode || day?.roleName);
  const roleCode = roleDay?.roleCode || employee?.roleCode || "";

  return optionByCode.get(roleCode)?.name || roleDay?.roleName || employee?.roleName || "";
}

function buildFullWeekDays(weekStartKey, plannedDays = []) {
  const plannedByDate = new Map(plannedDays.map((day) => [day.dateKey, day]));
  const weekStartDate = new Date(`${weekStartKey}T12:00:00`);

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStartDate, index);
    const dateKey = format(date, "yyyy-MM-dd");
    const plannedDay = plannedByDate.get(dateKey);

    if (plannedDay) {
      return plannedDay;
    }

    const dayOfWeek = date.getDay();

    return {
      dateKey,
      dayOfWeek,
      label: DAY_LABELS.get(dayOfWeek) || "",
      dayType: "",
      startTime: "",
      endTime: "",
      lunchDurationMinutes: 0,
      authorizedExtraMinutes: 0,
      source: "empty",
    };
  });
}

export default function EmployeeScheduleDetail({ employeeId, initialMonth = "" }) {
  const [monthKey, setMonthKey] = useState(initialMonth || currentMonthKey());
  const [employee, setEmployee] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const weeks = useMemo(() => getMonthWeekOptions(monthKey), [monthKey]);
  const daysByWeek = useMemo(() => {
    const grouped = new Map(weeks.map((week) => [week.weekStartKey, []]));

    (assignment?.generatedDays || []).forEach((day) => {
      const weekStartKey = getWeekStartKey(day.dateKey);

      if (!grouped.has(weekStartKey)) {
        grouped.set(weekStartKey, []);
      }

      grouped.get(weekStartKey).push(day);
    });

    return grouped;
  }, [assignment?.generatedDays, weeks]);
  const weekHourSummaries = useMemo(() => {
    const summaries = new Map();

    weeks.forEach((week) => {
      const days = buildFullWeekDays(week.weekStartKey, daysByWeek.get(week.weekStartKey) || []);

      summaries.set(week.weekStartKey, calculateWeekHourBreakdown(days, employee));
    });

    return summaries;
  }, [daysByWeek, employee, weeks]);
  const monthHourSummary = useMemo(() =>
    [...weekHourSummaries.values()].reduce(
      (total, weekBreakdown) => addHourSummaries(total, weekBreakdown.summary),
      createHourSummary(),
    ),
  [weekHourSummaries]);
  const baseSalary = Number(employee?.salary) || 0;
  const monthlyVariableAmount = variableAmount(monthHourSummary);
  const approximateSalary = baseSalary + monthlyVariableAmount;

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

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      setIsLoading(true);

      try {
        const [employeeResponse, assignmentResponse] = await Promise.all([
          fetch(`/api/company/employees/${employeeId}`),
          fetch(`/api/planner/planning/schedule-assignments?month=${monthKey}&employeeId=${employeeId}`),
        ]);
        const [employeePayload, assignmentPayload] = await Promise.all([
          employeeResponse.json(),
          assignmentResponse.json(),
        ]);

        if (!employeeResponse.ok) {
          throw new Error(employeePayload.error || "No se pudo cargar el empleado.");
        }

        if (!assignmentResponse.ok) {
          throw new Error(assignmentPayload.error || "No se pudo cargar el horario.");
        }

        if (!isCancelled) {
          const loadedAssignment = assignmentPayload.assignments?.[0] || null;

          setEmployee(employeePayload.employee || null);
          setAssignment(loadedAssignment);
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

    loadData();

    return () => {
      isCancelled = true;
      clearNoticeTimers();
    };
  }, [clearNoticeTimers, employeeId, monthKey, showNotice]);

  return (
    <div className={`${styles.stack} page-entrance`}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />

      {isLoading ? (
        <section className={`${styles.loadingPanel} page-entrance`} aria-live="polite">
          <div className={styles.skeletonToolbar}>
            <span className={styles.skeletonIdentity} />
            <span className={styles.skeletonMonth} />
          </div>
          <div className={styles.skeletonGrid}>
            {Array.from({ length: 3 }, (_, index) => (
              <article key={index} className={styles.skeletonCard}>
                <span className={styles.skeletonTitle} />
                <span className={styles.skeletonLine} />
                <span className={styles.skeletonLine} />
                <span className={styles.skeletonLineShort} />
              </article>
            ))}
          </div>
        </section>
      ) : (
        <>
          <section className={`${styles.toolbar} page-entrance page-entrance-delay-sm`}>
            <div className={styles.identity}>
              <p className={styles.eyebrow}>Empleado</p>
              <h2>{employee?.fullName || "Horario mensual"}</h2>
              <span>
                {[employee?.branchName || employee?.branchCode, employee?.areaName, employee?.roleName]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <label className={styles.monthField}>
              <span>Mes</span>
              <input
                type="month"
                value={monthKey}
                onChange={(event) => setMonthKey(event.target.value)}
                disabled={isLoading}
              />
            </label>
          </section>
          <section className={`${styles.totalSummary} page-entrance page-entrance-delay-md`}>
            <article>
              <span>Horas laborales</span>
              <strong>{formatDuration(monthHourSummary.laborMinutes)}</strong>
              <small>{monthHourSummary.workedDays} dia{monthHourSummary.workedDays === 1 ? "" : "s"} laborado{monthHourSummary.workedDays === 1 ? "" : "s"}</small>
            </article>
            <article>
              <span>Horas suplementarias</span>
              <strong>{formatDuration(monthHourSummary.supplementaryMinutes)}</strong>
              <small>{formatMoney(monthHourSummary.supplementaryAmount)} aprox.</small>
            </article>
            <article>
              <span>Horas extra</span>
              <strong>{formatDuration(monthHourSummary.extraordinaryMinutes)}</strong>
              <small>{formatMoney(monthHourSummary.extraordinaryAmount)} aprox.</small>
            </article>
            <article>
              <span>Total variable</span>
              <strong>{formatMoney(monthlyVariableAmount)}</strong>
            </article>
            <article>
              <span>Sueldo aprox.</span>
              <strong>{formatMoney(approximateSalary)}</strong>
              <small>Base {formatMoney(baseSalary)}</small>
            </article>
          </section>
          <section className={styles.weekGrid}>
            {weeks.map((week) => {
              const days = buildFullWeekDays(week.weekStartKey, daysByWeek.get(week.weekStartKey) || []);
              const coverageLabel = weekCoverageLabel(days, employee);
              const weekBreakdown = weekHourSummaries.get(week.weekStartKey) || {
                summary: createHourSummary(),
                daysByDate: new Map(),
              };
              const weekHourSummary = weekBreakdown.summary;

              return (
                <article
                  key={week.weekStartKey}
                  className={`${styles.weekCard} page-entrance ${week.weekStartKey === weeks[0]?.weekStartKey ? "page-entrance-delay-sm" : "page-entrance-delay-md"}`}
                >
                  <div className={styles.weekHeader}>
                    <div>
                      <p>{week.label}</p>
                      <h3>{week.rangeLabel}</h3>
                    </div>
                    <div className={styles.weekBadges}>
                      {coverageLabel ? (
                        <span className={styles.coverageBadge}>{coverageLabel}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className={styles.weekSummary}>
                    <article>
                      <span>Laborables</span>
                      <strong>{formatDuration(weekHourSummary.laborMinutes)}</strong>
                      <small>{weekHourSummary.workedDays} dia{weekHourSummary.workedDays === 1 ? "" : "s"} laborado{weekHourSummary.workedDays === 1 ? "" : "s"}</small>
                    </article>
                    <article>
                      <span>Suplementarias</span>
                      <strong>{formatDuration(weekHourSummary.supplementaryMinutes)}</strong>
                      <small>{formatMoney(weekHourSummary.supplementaryAmount)} aprox.</small>
                    </article>
                    <article>
                      <span>Extras</span>
                      <strong>{formatDuration(weekHourSummary.extraordinaryMinutes)}</strong>
                      <small>{formatMoney(weekHourSummary.extraordinaryAmount)} aprox.</small>
                    </article>
                  </div>
                  <div className={styles.dayList}>
                    {days.map((day) => {
                      const daySummary = weekBreakdown.daysByDate.get(day.dateKey) || createHourSummary();
                      const displayDay = day.source === "empty" ? null : day;

                      return (
                        <div
                          key={day.dateKey}
                          className={`${styles.dayRow} ${day.source === "empty" ? styles.dayRowMissing : ""} ${isWeekendDay(day) ? styles.dayRowWeekend : ""}`}
                        >
                          <div>
                            <strong>{day.label}</strong>
                            <span>{`${day.dateKey.slice(8, 10)}/${day.dateKey.slice(5, 7)}`}</span>
                          </div>
                          <div className={styles.dayDetail}>
                            <div className={styles.dayScheduleLine}>
                              <p className={dayDisplayTone(day)}>{scheduleLine(displayDay)}</p>
                              <span className={styles.lunchCell}>
                                <small>Alm.</small>
                                <strong>{lunchDurationLabel(displayDay)}</strong>
                              </span>
                            </div>
                            <div className={styles.dayMetrics}>
                              <span>
                                <small>Supl.</small>
                                <strong>{formatDuration(daySummary.supplementaryMinutes)}</strong>
                              </span>
                              <span>
                                <small>Extra</small>
                                <strong>{formatDuration(daySummary.extraordinaryMinutes)}</strong>
                              </span>
                              <span>
                                <small>Valor</small>
                                <strong>{formatMoney(variableAmount(daySummary))}</strong>
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
