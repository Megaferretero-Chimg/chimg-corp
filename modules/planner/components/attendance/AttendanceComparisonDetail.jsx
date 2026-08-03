"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CircleCheck,
  ClipboardCheck,
  History,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import AutocompleteSelect from "@/components/ui/AutocompleteSelect";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import SelectInput from "@/components/ui/SelectInput";
import TimeInput24 from "@/components/ui/TimeInput24";
import {
  formatEcuadorDateTimeLabel,
  formatEcuadorMonthKey,
  formatTime24,
  formatTimeText24,
} from "@/lib/datetime/ecuador";
import { calculatePayrollAdditionalRate } from "@/modules/planner/lib/payroll/rates";
import styles from "@/modules/planner/styles/components/attendance/AttendanceComparisonDetail.module.scss";

function currentMonthKey() {
  return formatEcuadorMonthKey();
}

function minutesBadge(value) {
  return value && value !== "0m" ? value : "--";
}

function formatMinutes(value) {
  const minutes = Number(value) || 0;

  if (!minutes) return "--";

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatScheduleHour(value) {
  return formatTime24(value).replace(":", "H");
}

function formatScheduleText(value) {
  return formatTimeText24(value)
    .replace(/\b(\d{2}):(\d{2})\b/g, "$1H$2")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeScheduleText(value) {
  return formatTimeText24(value).replace(/\s+/g, " ").trim();
}

function scheduleTextsMatch(left, right) {
  return normalizeScheduleText(left).toUpperCase() === normalizeScheduleText(right).toUpperCase();
}

function formatDecisionTimestamp(value) {
  return formatEcuadorDateTimeLabel(value, { fallback: "Fecha no disponible" });
}

const INLINE_EXCEPTION_OPTIONS = [
  {
    value: "extra_day",
    label: "Día extra",
    description: "Aprueba como extraordinario el tiempo real entre las picadas de este día, sin crear una plantilla.",
  },
  {
    value: "schedule_change",
    label: "Cambiar planificación",
    description: "Autoriza el horario que debía aplicar en este día.",
  },
  {
    value: "missing_punch",
    label: "Picada omitida",
    description: "Completa la asistencia con picadas manuales o con el horario planificado.",
  },
  {
    value: "outside_work",
    label: "Trabajo externo",
    description: "Valida trabajo realizado fuera de la empresa.",
  },
  {
    value: "permission",
    label: "Permiso",
    description: "Justifica ausencia o salida por horas.",
  },
  {
    value: "permission_punches",
    label: "Permiso con picadas",
    description: "Vincula una picada de salida y otra de retorno para que no se consideren marcaciones en exceso.",
  },
];

function fullScheduleLabel(day) {
  if (!day?.startTime || !day?.endTime) {
    return day?.dayTypeLabel || "Sin horario";
  }

  if (day.lunchStartTime && day.lunchEndTime) {
    return `${formatScheduleHour(day.startTime)} A ${formatScheduleHour(day.lunchStartTime)} ${formatScheduleHour(day.lunchEndTime)} A ${formatScheduleHour(day.endTime)}`;
  }

  return `${formatScheduleHour(day.startTime)} A ${formatScheduleHour(day.endTime)}`;
}

function hasTemplateSchedule(row) {
  return ["workday", "weekend_overtime"].includes(row?.dayType) && row?.startTime && row?.endTime;
}

function templateScheduleRow(template, dateKey) {
  const dayOfWeek = dateFromDateKey(dateKey).getUTCDay();
  const rowsByDay = new Map((template?.weeklyRows || []).map((row) => [row.dayOfWeek, row]));
  const directRow = rowsByDay.get(dayOfWeek);
  const weekdayFallbackRow = [1, 2, 3, 4, 5]
    .map((weekday) => rowsByDay.get(weekday))
    .find(hasTemplateSchedule);
  const anyFallbackRow = [...rowsByDay.values()].find(hasTemplateSchedule);
  const row = hasTemplateSchedule(directRow)
    ? directRow
    : weekdayFallbackRow || anyFallbackRow;

  return row || null;
}

function templateScheduleLabel(template, dateKey) {
  const row = templateScheduleRow(template, dateKey);

  if (!row) {
    return "Descanso";
  }

  return fullScheduleLabel(row);
}

function displayScheduleLabel(day, templates = []) {
  if (day?.startTime && day?.endTime) {
    const scheduleLabel = fullScheduleLabel(day);
    return day?.isHoliday ? `Feriado · ${scheduleLabel}` : scheduleLabel;
  }

  const template = templates.find((candidate) => candidate.id === (day?.plannedTemplateId || ""));
  const templateLabel = template ? templateScheduleLabel(template, day.dateKey) : "";

  if (templateLabel && templateLabel !== "Descanso") {
    return day?.isHoliday ? `Feriado · ${templateLabel}` : templateLabel;
  }

  if (day?.isHoliday) {
    return "Feriado · Descanso";
  }

  return day?.dayTypeLabel || "Sin horario";
}

function scheduleTimeToMinutes(value) {
  const normalizedTime = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[H.]/g, ":");
  const compactTime = normalizedTime.match(/^\d{3,4}$/)
    ? `${normalizedTime.slice(0, -2)}:${normalizedTime.slice(-2)}`
    : normalizedTime;
  const [hours, minutes] = compactTime.split(":").map(Number);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 24 ||
    (hours === 24 && minutes !== 0) ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return (hours * 60) + minutes;
}

function netScheduledMinutesFromRow(row) {
  const start = scheduleTimeToMinutes(row?.startTime);
  const end = scheduleTimeToMinutes(row?.endTime);

  if (start === null || end === null || end <= start) return 0;

  const lunchStart = scheduleTimeToMinutes(row?.lunchStartTime);
  const lunchEnd = scheduleTimeToMinutes(row?.lunchEndTime);
  const lunchMinutes = lunchStart !== null && lunchEnd !== null && lunchEnd > lunchStart
    ? lunchEnd - lunchStart
    : Number(row?.lunchDurationMinutes) || 0;

  return Math.max(0, end - start - lunchMinutes);
}

function fallbackPlannedMinutes(day, templates = []) {
  const directMinutes = netScheduledMinutesFromRow(day);

  if (directMinutes > 0) return directMinutes;

  const template = templates.find((candidate) => candidate.id === (day?.plannedTemplateId || ""));
  const templateRow = template ? templateScheduleRow(template, day?.dateKey) : null;

  return netScheduledMinutesFromRow(templateRow);
}

function employeeMatchesTemplate(employee, template) {
  if (!employee || !template) return false;
  if (!template.roleCode) return true;
  if (template.roleCode === employee.roleCode) return true;

  return false;
}

function orderedAlignmentDistance(actualMinutes = [], expectedMinutes = []) {
  if (!actualMinutes.length || !expectedMinutes.length || actualMinutes.length > expectedMinutes.length) {
    return Number.MAX_SAFE_INTEGER;
  }

  let bestDistance = Number.MAX_SAFE_INTEGER;

  function compareFrom(actualIndex, expectedIndex, distance) {
    if (actualIndex === actualMinutes.length) {
      bestDistance = Math.min(bestDistance, distance);
      return;
    }

    const remainingActual = actualMinutes.length - actualIndex;
    const lastExpectedIndex = expectedMinutes.length - remainingActual;

    for (let index = expectedIndex; index <= lastExpectedIndex; index += 1) {
      const nextDistance = distance + Math.abs(actualMinutes[actualIndex] - expectedMinutes[index]);
      if (nextDistance >= bestDistance) continue;
      compareFrom(actualIndex + 1, index + 1, nextDistance);
    }
  }

  compareFrom(0, 0, 0);
  return bestDistance;
}

function templateDistanceFromPunches(punchMinutes = [], row = {}) {
  const templateStart = scheduleTimeToMinutes(row?.startTime);
  const templateLunchStart = scheduleTimeToMinutes(row?.lunchStartTime);
  const templateLunchEnd = scheduleTimeToMinutes(row?.lunchEndTime);
  const templateEnd = scheduleTimeToMinutes(row?.endTime);

  if (!punchMinutes.length || templateStart === null || templateEnd === null) {
    return Number.MAX_SAFE_INTEGER;
  }

  const expectedMinutes = [templateStart, templateLunchStart, templateLunchEnd, templateEnd]
    .filter((value) => value !== null);

  if (punchMinutes.length === 1) {
    const incompleteFullDayPenalty = expectedMinutes.length >= 4 ? 0 : 10_000;
    return incompleteFullDayPenalty + Math.abs(punchMinutes[0] - templateStart);
  }

  if (punchMinutes.length === 2) {
    return Math.abs(punchMinutes[0] - templateStart) +
      Math.abs(punchMinutes[punchMinutes.length - 1] - templateEnd);
  }

  if (expectedMinutes.length < 4) {
    return Number.MAX_SAFE_INTEGER - 1;
  }

  if (punchMinutes.length === 3) {
    return orderedAlignmentDistance(punchMinutes, expectedMinutes);
  }

  let bestDistance = Number.MAX_SAFE_INTEGER;

  for (let start = 0; start <= punchMinutes.length - 4; start += 1) {
    for (let second = start + 1; second <= punchMinutes.length - 3; second += 1) {
      for (let third = second + 1; third <= punchMinutes.length - 2; third += 1) {
        for (let end = third + 1; end < punchMinutes.length; end += 1) {
          bestDistance = Math.min(
            bestDistance,
            orderedAlignmentDistance(
              [punchMinutes[start], punchMinutes[second], punchMinutes[third], punchMinutes[end]],
              expectedMinutes,
            ),
          );
        }
      }
    }
  }

  return bestDistance;
}

function scheduleTemplateOptionsForDay(employee, templates = [], day) {
  if (!day?.dateKey) return [];

  const activePunches = activePunchesForDisplay(day);
  const punchMinutes = activePunches.map((punch) => scheduleTimeToMinutes(punch?.time));

  return templates
    .filter((template) => template?.isActive !== false && employeeMatchesTemplate(employee, template))
    .map((template) => {
      const row = templateScheduleRow(template, day.dateKey);
      const scheduleLabel = row ? fullScheduleLabel(row) : "";

      return {
        id: template.id,
        name: formatScheduleText(template.name) || "Plantilla",
        scheduleLabel,
        row,
        distance: templateDistanceFromPunches(punchMinutes, row),
      };
    })
    .filter((option) => option.row && option.scheduleLabel)
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name, "es"))
    .map((option, index) => ({ ...option, isRecommended: index === 0 }));
}

const WEEK_RANGE_FORMATTER = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

function dateFromDateKey(dateKey) {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

function addUtcDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function weekStartKey(dateKey) {
  const date = dateFromDateKey(dateKey);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addUtcDays(date, -daysSinceMonday).toISOString().slice(0, 10);
}

function isWeekendDateKey(dateKey) {
  const day = dateFromDateKey(dateKey).getUTCDay();
  return day === 0 || day === 6;
}

function isFirstWeekendDay(days = [], index) {
  const day = days[index];

  return Boolean(day && isWeekendDateKey(day.dateKey) && !isWeekendDateKey(days[index - 1]?.dateKey));
}

function isExtraPlannedDay(day) {
  return Boolean(day?.isHoliday) || day?.dayType === "weekend_overtime";
}

function formatWeekRange(days = []) {
  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  if (!firstDay || !lastDay) return "";

  return `${WEEK_RANGE_FORMATTER.format(dateFromDateKey(firstDay.dateKey))} - ${WEEK_RANGE_FORMATTER.format(dateFromDateKey(lastDay.dateKey))}`;
}

function groupDaysByWeek(days = []) {
  const groups = new Map();

  [...days]
    .sort((left, right) => String(left.dateKey || "").localeCompare(String(right.dateKey || "")))
    .forEach((day) => {
      const key = weekStartKey(day.dateKey);

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          days: [],
        });
      }

      groups.get(key).days.push(day);
    });

  return [...groups.values()].map((group, index) => ({
    ...group,
    label: `Semana ${index + 1}`,
    rangeLabel: formatWeekRange(group.days),
  }));
}

function moneyLabel(value) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function punchLabel(index, punchCount) {
  const labels = punchCount === 2
    ? ["ENT", "SAL"]
    : ["ENT", "ALM", "REG", "SAL"];

  return labels[index] || "Extra";
}

function punchDisplayLabel(punch, index, punchCount) {
  if (punch?.isIgnored) return "PIC";
  if (punch?.isPermissionPunch) return "PERM";
  return punch?.adjustedFrom ? `${punchLabel(index, punchCount)} AJ` : punchLabel(index, punchCount);
}

function activePunchesForDisplay(day) {
  return (day?.punches || []).filter((punch) => punch?.isIgnored !== true);
}

function punchDisplayLabelForDay(day, punch) {
  if (punch?.isIgnored) return "PIC";
  if (punch?.isPermissionPunch) return "PERM";

  const activePunches = activePunchesForDisplay(day).filter((candidate) => !candidate.isPermissionPunch);
  const activeIndex = activePunches.findIndex((candidate) => candidate.id === punch?.id);

  return punchDisplayLabel(punch, Math.max(0, activeIndex), activePunches.length);
}

function expectedPunchesFromScheduleDraft(draft) {
  if (
    !draft ||
    draft.type !== "schedule_change" ||
    draft.plannedDayType === "off_day" ||
    !draft.plannedStartTime ||
    !draft.plannedEndTime
  ) return 0;

  return draft.plannedLunchStartTime && draft.plannedLunchEndTime ? 4 : 2;
}

function createsExtraPunchLayer(day, draft) {
  const expectedPunches = expectedPunchesFromScheduleDraft(draft);
  const structuralPunches = activePunchesForDisplay(day).filter((punch) => !punch.isPermissionPunch);

  return expectedPunches > 0 && structuralPunches.length > expectedPunches;
}

function dayHasPlannedLunch(day) {
  if ((Number(day?.lunchDurationMinutes) || 0) > 0) return true;
  if (day?.lunchStartTime && day?.lunchEndTime) return true;

  const scheduleText = [
    day?.scheduleLabel,
    day?.templateName,
    day?.plannedTemplateName,
    day?.holidayPlannedScheduleLabel,
  ].filter(Boolean).join(" ");

  return (scheduleText.match(/\b\d{1,2}(?::|H)\d{2}\b/g) || []).length >= 4;
}

function hasInferredIncompletePunches(day) {
  if (!day || hasDayTag(day, "Picadas incompletas")) return false;
  if (day.executionException?.type === "missing_punch") return false;
  if ((Number(day.expectedPunches) || 0) <= 2) return false;
  if (!dayHasPlannedLunch(day)) return false;

  return activePunchesForDisplay(day).length === 2;
}

function hasSavedDayDecision(day) {
  return Boolean(day?.authorization?.isSaved && day.authorization.source !== "operational_exception");
}

function isScheduledExtraDay(day) {
  return day?.dayType === "weekend_overtime";
}

function hasPendingEntryLate(day) {
  if (!hasPlannedStart(day) || day?.plannedScheduleExists === false) return false;

  const entryLateMinutes = Number(day?.entryLateMinutes ?? day?.lateMinutes) || 0;
  const graceMinutes = Number(day?.graceMinutes) || 0;

  return day?.authorization?.lateResolved !== true &&
    (!isExtraordinaryDay(day) || isScheduledExtraDay(day)) &&
    entryLateMinutes > graceMinutes;
}

function hasPendingLunchOverage(day) {
  if (!hasPlannedStart(day) || day?.plannedScheduleExists === false) return false;

  const plannedLunchMinutes = Number(day?.lunchDiscountMinutes) || Number(day?.lunchDurationMinutes) || 0;
  const actualLunchMinutes = Number(day?.actualLunchMinutes) || 0;
  const graceMinutes = Number(day?.graceMinutes) || 0;

  return day?.authorization?.lateResolved !== true &&
    plannedLunchMinutes > 0 &&
    actualLunchMinutes - plannedLunchMinutes > graceMinutes;
}

function punchChipClass(day, index, punch) {
  const hasEntryWarning = index === 0 && hasPendingEntryLate(day);
  const hasLunchWarning = [1, 2].includes(index) && hasPendingLunchOverage(day);
  const classes = [];

  if (punch?.source === "manual") classes.push(styles.punchManual);
  if (hasEntryWarning || hasLunchWarning) classes.push(styles.punchWarning);

  return classes.join(" ") || undefined;
}

function isIgnorableRestDay(day) {
  return day.dayType === "off_day" && day.punchCount === 0;
}

function hasActiveExecutionException(day) {
  return Boolean(day?.executionException?.id);
}

function hasPlannedStart(day) {
  return ["workday", "weekend_overtime"].includes(day.dayType) ||
    Boolean(day?.startTime && day?.endTime) ||
    Number(day?.scheduledWorkedMinutes) > 0;
}

function isExtraordinaryDay(day) {
  return Boolean(day?.isHoliday) || ["weekend_overtime", "off_day"].includes(day?.dayType);
}

function additionalKindLabel(day, long = false) {
  if (isExtraordinaryDay(day)) return long ? "Extraordinarias" : "HE";
  return long ? "Suplementarias" : "HS";
}

function plannedRegularMinutes(day) {
  if (isExtraordinaryDay(day)) return 0;

  return Math.max(0, Number(day?.plannedRegularMinutes) || 0);
}

function plannedSupplementaryMinutes(day) {
  if (isExtraordinaryDay(day) || day?.payrollPolicy?.appliesSupplementaryHours === false) return 0;

  return Math.max(0, Number(day?.plannedSupplementaryMinutes) || 0);
}

function plannedExtraordinaryMinutes(day) {
  if (!isExtraordinaryDay(day) || day?.payrollPolicy?.appliesExtraordinaryHours === false) return 0;

  if (day?.weeklyAttendanceClassification === "extra") {
    return Math.max(
      0,
      Number(day?.plannedExtraordinaryMinutes) || 0,
      Number(day?.scheduledWorkedMinutes) || 0,
      Number(day?.authorizedExtraMinutes) || 0,
    );
  }

  if (day?.dayType === "weekend_overtime") {
    return Math.max(
      0,
      Number(day?.plannedExtraordinaryMinutes) || 0,
      Number(day?.scheduledWorkedMinutes) || 0,
      Number(day?.authorizedExtraMinutes) || 0,
    );
  }

  return Math.max(
    0,
    Number(day?.plannedExtraordinaryMinutes) || 0,
    Number(day?.scheduledWorkedMinutes) || 0,
    Number(day?.authorizedExtraMinutes) || 0,
  );
}

function plannedAdditionalMinutes(day) {
  return isExtraordinaryDay(day)
    ? plannedExtraordinaryMinutes(day)
    : plannedSupplementaryMinutes(day);
}

function plannedColumnLabel(day, templates = []) {
  if (day?.plannedScheduleExists === false) return "--";

  const extraordinaryMinutes = plannedExtraordinaryMinutes(day);

  if (day?.isHoliday && extraordinaryMinutes > 0) {
    return formatMinutes(extraordinaryMinutes);
  }

  if (Number(day?.scheduledWorkedMinutes) > 0) {
    return day.scheduledWorkedLabel;
  }

  const plannedMinutes = fallbackPlannedMinutes(day, templates);

  if (plannedMinutes > 0) {
    return formatMinutes(plannedMinutes);
  }

  return day?.dayTypeLabel || "--";
}

function registeredAdditionalMinutes(day) {
  return isExtraordinaryDay(day)
    ? Number(day?.detectedExtraordinaryMinutes) || 0
    : Number(day?.detectedSupplementaryMinutes) || 0;
}

function additionalAmountValue(minutes, day, summary = {}) {
  const hourlyRate = Number(summary.hourlyRateRaw ?? summary.hourlyRate) || 0;
  const multiplier = isExtraordinaryDay(day)
    ? Number(summary.extraordinaryMultiplier) || 2
    : Number(summary.supplementaryMultiplier) || 1.5;

  return (Math.max(0, Number(minutes) || 0) / 60) * calculatePayrollAdditionalRate(hourlyRate, multiplier);
}

function additionalAmountLabel(minutes, day, summary = {}) {
  return moneyLabel(additionalAmountValue(minutes, day, summary));
}

function additionalValueRows(day, summary = {}) {
  const kind = additionalKindLabel(day);
  const plannedMinutes = plannedAdditionalMinutes(day);
  const registeredMinutes = registeredAdditionalMinutes(day);
  const authorizedMinutes = isExtraordinaryDay(day)
    ? Math.max(0, Number(day?.authorization?.authorizedExtraordinaryMinutes) || 0)
    : Math.max(0, Number(day?.authorization?.authorizedSupplementaryMinutes) || 0);
  const hasSavedAuthorization = Boolean(day?.authorization?.isSaved) && authorizedMinutes > plannedMinutes;

  const rows = [
    {
      label: `${kind} plan.`,
      minutesLabel: plannedMinutes ? formatMinutes(plannedMinutes) : "--",
      amountLabel: additionalAmountLabel(plannedMinutes, day, summary),
    },
    {
      label: `${kind} det.`,
      minutesLabel: registeredMinutes ? formatMinutes(registeredMinutes) : "--",
      amountLabel: registeredMinutes
        ? additionalAmountLabel(registeredMinutes, day, summary)
        : "--",
      registered: true,
    },
  ];

  if (hasSavedAuthorization) {
    rows.push({
      label: `${kind} aprob.`,
      minutesLabel: authorizedMinutes ? formatMinutes(authorizedMinutes) : "--",
      amountLabel: additionalAmountLabel(authorizedMinutes, day, summary),
      approved: true,
    });
  }

  return rows;
}

function detectedLateIssueMinutes(day) {
  if (day?.plannedScheduleExists === false) return 0;
  if (isExtraordinaryDay(day) && !isScheduledExtraDay(day)) return 0;

  return Math.max(
    0,
    Number(day?.lateMinutes) || 0,
    Number(day?.authorization?.detectedLateMinutes) || 0,
    (Number(day?.entryLateMinutes) || 0) + (Number(day?.lunchOverageMinutes ?? day?.lunchOverageRemainderMinutes) || 0),
  );
}

function detectedEarlyLeaveIssueMinutes(day) {
  return Math.max(
    0,
    Number(day?.earlyLeaveMinutes) || 0,
    Number(day?.authorization?.detectedEarlyLeaveMinutes) || 0,
  );
}

function defaultAppliedLateMinutes(day) {
  if (!day) return 0;
  if (isExtraordinaryDay(day) && !isScheduledExtraDay(day)) return 0;

  if (day.authorization?.adjustedLateMinutes !== undefined && day.authorization?.adjustedLateMinutes !== null) {
    return Math.min(
      detectedLateIssueMinutes(day),
      Math.max(0, Number(day.authorization.adjustedLateMinutes) || 0),
    );
  }

  return detectedLateIssueMinutes(day);
}

function displayLateMinutes(day) {
  if (!day || isIgnorableRestDay(day)) return 0;
  const currentLateMinutes = detectedLateIssueMinutes(day);

  if (day.authorization?.adjustedLateMinutes !== undefined && day.authorization?.adjustedLateMinutes !== null) {
    return Math.min(
      currentLateMinutes,
      Math.max(0, Number(day.authorization.adjustedLateMinutes) || 0),
    );
  }

  return currentLateMinutes;
}

function displayEarlyLeaveMinutes(day) {
  if (!day || isIgnorableRestDay(day)) return 0;
  const currentEarlyLeaveMinutes = detectedEarlyLeaveIssueMinutes(day);

  if (day.authorization?.adjustedEarlyLeaveMinutes !== undefined && day.authorization?.adjustedEarlyLeaveMinutes !== null) {
    return Math.min(
      currentEarlyLeaveMinutes,
      Math.max(0, Number(day.authorization.adjustedEarlyLeaveMinutes) || 0),
    );
  }

  return currentEarlyLeaveMinutes;
}

function attendanceDelayMinutes(day) {
  if (!day || isIgnorableRestDay(day)) return 0;
  if (isExtraordinaryDay(day) && !isScheduledExtraDay(day)) return 0;

  return displayLateMinutes(day) + displayEarlyLeaveMinutes(day);
}

function attendanceEntryLateMinutes(day) {
  if (!day || isIgnorableRestDay(day)) return 0;
  if (isExtraordinaryDay(day) && !isScheduledExtraDay(day)) return 0;

  return Math.max(
    0,
    Number(day.entryLateMinutes) || 0,
    Number(day.authorization?.detectedEntryLateMinutes) || 0,
  );
}

function attendanceLunchLateMinutes(day) {
  if (!day || isIgnorableRestDay(day)) return 0;
  if (isExtraordinaryDay(day) && !isScheduledExtraDay(day)) return 0;

  return Math.max(0, Number(day.lunchOverageMinutes ?? day.lunchOverageRemainderMinutes) || 0);
}

function attendanceEarlyLeaveMinutes(day) {
  if (!day || isIgnorableRestDay(day)) return 0;
  if (isExtraordinaryDay(day) && !isScheduledExtraDay(day)) return 0;

  return displayEarlyLeaveMinutes(day);
}

function attendanceDelayParts(day) {
  return [
    { label: "Entrada", minutes: attendanceEntryLateMinutes(day) },
    { label: "Almuerzo", minutes: attendanceLunchLateMinutes(day) },
    { label: "Salida", minutes: attendanceEarlyLeaveMinutes(day) },
  ].filter((part) => part.minutes > 0);
}

function unresolvedLateMinutes(day) {
  if (!day || (isExtraordinaryDay(day) && !isScheduledExtraDay(day))) return 0;

  return Math.max(
    detectedLateIssueMinutes(day),
    displayLateMinutes(day),
    hasDayTag(day, "Atraso") ? Number(day.lateMinutes) || 0 : 0,
  );
}

function unresolvedEntryLateMinutes(day) {
  if (!day || (isExtraordinaryDay(day) && !isScheduledExtraDay(day))) return 0;

  return Math.max(0, Number(day.entryLateMinutes) || 0);
}

function applicableIssueMinutes(day, draft = {}) {
  const decision = draft.decision || day?.authorization?.decision || "";
  const draftLateMinutes = hourInputToMinutes(draft.late);
  const draftEarlyLeaveMinutes = hourInputToMinutes(draft.earlyLeave);
  const detectedLateMinutes = detectedLateIssueMinutes(day);
  const detectedEarlyLeaveMinutes = Number(day?.authorization?.detectedEarlyLeaveMinutes ?? day?.earlyLeaveMinutes) || 0;
  const lateMinutes = decision === "resolve_late"
    ? 0
    : decision === "justify_late"
    ? Math.max(0, Number(day?.lunchOverageMinutes ?? day?.lunchOverageRemainderMinutes) || 0)
    : ["pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
    ? 0
    : Math.min(Math.max(detectedLateMinutes, draftLateMinutes), draftLateMinutes);
  const earlyLeaveMinutes = ["pay_planned_day", "complete_regular_day", "justify_early_leave", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
    ? 0
    : Math.min(Math.max(detectedEarlyLeaveMinutes, draftEarlyLeaveMinutes), draftEarlyLeaveMinutes);

  const lunchOverageMinutes = Math.max(0, Number(day?.lunchOverageMinutes ?? day?.lunchOverageRemainderMinutes) || 0);
  const appliedLunchOverageMinutes = ["planned", "pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
    ? 0
    : lunchOverageMinutes;

  return {
    lateMinutes,
    earlyLeaveMinutes,
    lunchOverageMinutes,
    appliedLunchOverageMinutes,
    totalMinutes: lateMinutes + earlyLeaveMinutes,
  };
}

function hasIncoherentWorkedDay(day) {
  if (!day || isExtraordinaryDay(day) || isIgnorableRestDay(day)) return false;
  if (hasDayTag(day, "Sin picadas") || hasIncompletePunchTag(day) || hasDayTag(day, "Picadas de más")) return false;

  const plannedMinutes = Number(day.scheduledWorkedMinutes) || Number(day.plannedRegularMinutes) || 0;
  const workedMinutes = Number(day.workedMinutes) || 0;

  if (!plannedMinutes || !workedMinutes) return false;

  return workedMinutes < Math.min(4 * 60, plannedMinutes / 2);
}

function hasOperationalError(day) {
  return (day?.tags || []).some((tag) => [
    "Sin picadas",
    "Picadas incompletas",
    "Picadas de más",
    "No planificado",
    "Trabajo sin horario",
  ].includes(tag)) || hasIncompletePunchTag(day) || hasInferredIncompletePunches(day) || hasIncoherentWorkedDay(day);
}

function hasVisibleDayWarning(day) {
  if (hasOperationalError(day)) return false;

  return visibleDayTags(day).some((tag) => [
    "Atraso",
    "Salida anticipada",
    "Jornada incompleta",
    "Horas descontadas",
  ].includes(tag));
}

function hasReviewableDayAlert(day) {
  if (isIgnorableRestDay(day)) return false;
  return hasOperationalError(day);
}

function hasLateDayAlert(day) {
  if (isIgnorableRestDay(day)) return false;
  if (hasOperationalError(day)) return false;
  if (day?.authorization?.lateResolved === true) return false;

  return displayLateMinutes(day) > 0 || detectedEarlyLeaveIssueMinutes(day) > 0;
}

function hasAdditionalDayAlert(day) {
  if (isIgnorableRestDay(day)) return false;
  if (hasOperationalError(day)) return false;
  if (hasLateDayAlert(day)) return false;
  return hasUnapprovedExtraTime(day);
}

function dayRowClass(day) {
  const rowClasses = [];

  if (isWeekendDateKey(day.dateKey)) rowClasses.push(styles.weekendRow);

  if (isIgnorableRestDay(day) && !hasActiveExecutionException(day)) {
    rowClasses.push(styles.ignoredRestRow);
    return rowClasses.join(" ");
  }

  if (canOpenDayDecision(day)) rowClasses.push(styles.actionableRow);
  if (hasReviewableDayAlert(day)) rowClasses.push(styles.severeIssueRow);
  else if (hasLateDayAlert(day)) rowClasses.push(styles.issueRow);
  else if (hasAdditionalDayAlert(day)) rowClasses.push(styles.additionalIssueRow);

  return rowClasses.join(" ");
}

function hasAuthorizableTime(day) {
  return (Number(day.detectedSupplementaryMinutes) || 0) > 0 || (Number(day.detectedExtraordinaryMinutes) || 0) > 0;
}

function canManuallyAuthorizeHours(day) {
  if (hasAuthorizableTime(day)) return true;
  if (detectedLateIssueMinutes(day) > 0 || (Number(day.authorization?.detectedLateMinutes) || 0) > 0) return true;
  if ((Number(day.earlyLeaveMinutes) || 0) > 0 || (Number(day.authorization?.detectedEarlyLeaveMinutes) || 0) > 0) return true;

  if (day.dayType === "workday") {
    return day.payrollPolicy?.appliesSupplementaryHours !== false;
  }

  return (day.isHoliday || ["weekend_overtime", "off_day"].includes(day.dayType)) &&
    day.payrollPolicy?.appliesExtraordinaryHours !== false;
}

function canOpenDayDecision(day) {
  if (hasActiveExecutionException(day)) return true;

  return !isIgnorableRestDay(day) && canManuallyAuthorizeHours(day);
}

function issueTagClass(tag) {
  if ([
    "Ajustado a planificación",
    "Picadas justificadas",
    "Atraso justificado",
    "Salida justificada",
    "Revisado",
    "Jornada laboral completada",
    "Justificación operativa",
    "Trabajo fuera justificado",
    "Día extra aprobado",
    "Aprobado",
    "Dia planificado pagado",
    "Todo autorizado",
    "Según plan",
    "Planificado",
    "Ajustado",
    "Vacaciones",
  ].includes(tag)) {
    return `${styles.issueTag} ${styles.justifiedTag}`;
  }

  if ([
    "Sin picadas",
    "Picadas incompletas",
    "Picadas de más",
    "No planificado",
    "Trabajo sin horario",
    "Jornada incompleta",
  ].includes(tag)) return `${styles.issueTag} ${styles.severeTag}`;
  if (tag === "Tiempo adicional") return `${styles.issueTag} ${styles.additionalTag}`;
  return styles.issueTag;
}

function issueTagLabel(tag) {
  if (tag === "Tiempo adicional") return "Adicional";
  return tag;
}

const VISIBLE_DAY_TAGS = new Set([
  "Sin picadas",
  "Picadas incompletas",
  "Picadas de más",
  "No planificado",
  "Trabajo sin horario",
  "Tiempo adicional",
  "Atraso",
  "Salida anticipada",
  "Plan no completado",
  "Jornada laboral completada",
  "Justificación operativa",
  "Trabajo fuera justificado",
  "Aprobado",
  "No aprobado",
  "Vacaciones",
  "Horas descontadas",
  "Ajustado a planificación",
  "Picadas justificadas",
  "Atraso justificado",
  "Salida justificada",
  "Dia descontado",
]);

const RESOLUTION_DAY_TAGS = new Set([
  "Ajustado a planificación",
  "Picadas justificadas",
  "Atraso justificado",
  "Salida justificada",
  "Revisado",
  "Jornada laboral completada",
  "Justificación operativa",
  "Trabajo fuera justificado",
  "Aprobado",
  "No aprobado",
  "Horas descontadas",
  "Dia descontado",
  "Dia planificado pagado",
  "Todo autorizado",
  "Según plan",
  "Planificado",
  "Ajustado",
]);

function visibleDayTags(day) {
  const rawTags = day?.tags || [];
  const hasBlockingAlert = hasOperationalError(day);
  const hasPendingDelay = hasLateDayAlert(day);
  const hasPendingAdditional = hasAdditionalDayAlert(day);
  const detectedLateMinutes = Number(day?.authorization?.detectedLateMinutes) || 0;
  const detectedEarlyLeaveMinutes = Number(day?.authorization?.detectedEarlyLeaveMinutes) || 0;
  const additionalToleranceMinutes = Math.max(0, Number(day?.lateDepartureToleranceMinutes) || 0);
  const detectedAdditionalBeyondPlan =
    (Number(day?.detectedSupplementaryMinutes) || 0) - (Number(day?.plannedSupplementaryMinutes) || 0) > additionalToleranceMinutes ||
    (Number(day?.detectedExtraordinaryMinutes) || 0) - (Number(day?.plannedExtraordinaryMinutes) || 0) > additionalToleranceMinutes;
  const hasReviewContext =
    hasBlockingAlert ||
    hasPendingDelay ||
    hasPendingAdditional ||
    detectedLateMinutes > 0 ||
    detectedEarlyLeaveMinutes > 0 ||
    detectedAdditionalBeyondPlan;
  const normalizedTags = rawTags
    .map((tag) => tag === "Tiempo adicional sin justificar" ? "Tiempo adicional" : tag)
    .map((tag) => tag === "Falta almuerzo" ? "Picadas incompletas" : tag)
    .map((tag) => ["Atraso", "Salida anticipada"].includes(tag) ? "Plan no completado" : tag)
    .concat(hasInferredIncompletePunches(day) ? ["Picadas incompletas"] : [])
    .concat(
      hasPendingDelay && (displayLateMinutes(day) > 0 || (Number(day?.earlyLeaveMinutes) || 0) > 0)
        ? ["Plan no completado"]
        : [],
    );
  const tags = normalizedTags
    .filter((tag) => VISIBLE_DAY_TAGS.has(tag))
    .filter((tag) => tag !== "Revisado" || day?.authorization?.isSaved)
    .filter((tag) => !hasBlockingAlert || !["Plan no completado", "Tiempo adicional"].includes(tag))
    .filter((tag) => tag !== "Plan no completado" || hasPendingDelay)
    .filter((tag) => tag !== "Tiempo adicional" || hasPendingAdditional);
  const statusLabel = day?.authorization?.statusLabel || "";
  const displayTags = [...new Set(tags)];

  if (day?.dayType === "vacation" && !displayTags.includes("Vacaciones")) {
    displayTags.push("Vacaciones");
  }

  if (hasIncoherentWorkedDay(day) && !displayTags.includes("Jornada incompleta")) {
    displayTags.push("Jornada incompleta");
  }

  if (day?.authorization?.isSaved && statusLabel) {
    const pendingTags = displayTags.filter((tag) => !RESOLUTION_DAY_TAGS.has(tag));

    if (statusLabel === "Revisado" && !hasReviewContext) {
      return pendingTags;
    }

    return [...pendingTags, statusLabel];
  }

  return displayTags;
}

function weeklyComparisonTotals(days = [], summary = {}) {
  const totals = {
    plannedMinutes: 0,
    workedMinutes: 0,
    laborMinutes: 0,
    issueMinutes: 0,
    issueCount: 0,
    plannedHsMinutes: 0,
    detectedHsMinutes: 0,
    plannedHeMinutes: 0,
    detectedHeMinutes: 0,
    plannedHsAmount: 0,
    detectedHsAmount: 0,
    plannedHeAmount: 0,
    detectedHeAmount: 0,
  };

  days.forEach((day) => {
    if (isIgnorableRestDay(day)) {
      totals.issueCount += visibleDayTags(day).length;
      return;
    }

    const recognizedMinutes = isExtraordinaryDay(day)
      ? Math.max(0, Number(day?.extraordinaryMinutes) || 0)
      : Math.max(0, Number(day?.supplementaryMinutes) || 0);
    const plannedHsMinutes = plannedSupplementaryMinutes(day);
    const plannedHeMinutes = plannedExtraordinaryMinutes(day);

    totals.plannedMinutes += plannedRegularMinutes(day);
    totals.workedMinutes += Number(day.workedMinutes) || 0;
    totals.laborMinutes += Number(day.regularWorkedMinutes) || 0;
    totals.issueMinutes += displayLateMinutes(day) + displayEarlyLeaveMinutes(day);
    totals.issueCount += visibleDayTags(day).length;

    if (isExtraordinaryDay(day)) {
      totals.plannedHeMinutes += plannedHeMinutes;
      totals.detectedHeMinutes += recognizedMinutes;
      totals.plannedHeAmount += additionalAmountValue(plannedHeMinutes, day, summary);
      totals.detectedHeAmount += additionalAmountValue(recognizedMinutes, day, summary);
    } else {
      totals.plannedHsMinutes += plannedHsMinutes;
      totals.detectedHsMinutes += recognizedMinutes;
      totals.plannedHsAmount += additionalAmountValue(plannedHsMinutes, day, summary);
      totals.detectedHsAmount += additionalAmountValue(recognizedMinutes, day, summary);
    }
  });

  return totals;
}

function hasDayTag(day, tag) {
  return (day?.tags || []).includes(tag);
}

function hasIncompletePunchTag(day) {
  return hasDayTag(day, "Picadas incompletas");
}

function canAdjustAlertToPlanned(day) {
  return (
    (hasDayTag(day, "Sin picadas") || hasIncompletePunchTag(day)) &&
    hasPlannedStart(day) &&
    Number(day?.scheduledWorkedMinutes) > 0
  );
}

function hasNoSchedulePunches(day) {
  return hasDayTag(day, "No planificado") || hasDayTag(day, "Trabajo sin horario");
}

function inlineExceptionOptionsForDay(day) {
  if (!day) return INLINE_EXCEPTION_OPTIONS;

  if (hasNoSchedulePunches(day)) {
    return INLINE_EXCEPTION_OPTIONS.filter((option) => ["extra_day", "schedule_change"].includes(option.value));
  }

  if (hasIncompletePunchTag(day)) {
    return INLINE_EXCEPTION_OPTIONS.filter((option) => ["missing_punch", "schedule_change"].includes(option.value));
  }

  if (hasDayTag(day, "Sin picadas")) {
    return INLINE_EXCEPTION_OPTIONS.filter((option) => [
      "schedule_change",
      "missing_punch",
      "outside_work",
    ].includes(option.value));
  }

  if (displayLateMinutes(day) > 0 || (Number(day?.earlyLeaveMinutes) || 0) > 0) {
    return INLINE_EXCEPTION_OPTIONS.filter((option) =>
      ["permission", "schedule_change"].includes(option.value),
    );
  }

  if (hasUnapprovedExtraTime(day)) {
    return INLINE_EXCEPTION_OPTIONS.filter((option) => ["outside_work", "schedule_change"].includes(option.value));
  }

  return INLINE_EXCEPTION_OPTIONS;
}

function hasUnapprovedExtraTime(day) {
  if (day?.authorization?.additionalResolved === true) return false;

  const hasPlannedTime = (
    (Number(day?.plannedRegularMinutes) || 0) > 0 ||
    (Number(day?.plannedSupplementaryMinutes) || 0) > 0 ||
    (Number(day?.plannedExtraordinaryMinutes) || 0) > 0 ||
    (Number(day?.scheduledWorkedMinutes) || 0) > 0
  );
  const toleranceMinutes = hasPlannedTime
    ? Math.max(0, Number(day?.lateDepartureToleranceMinutes ?? 20) || 0)
    : 0;
  const unauthorizedSupplementaryMinutes = Math.max(
    Number(day?.additionalSupplementaryMinutes) || 0,
    (Number(day?.detectedSupplementaryMinutes) || 0) - (Number(day?.supplementaryMinutes) || 0),
  );
  const unauthorizedExtraordinaryMinutes = Math.max(
    0,
    (Number(day?.detectedExtraordinaryMinutes) || 0) - (Number(day?.extraordinaryMinutes) || 0),
  );

  return hasDayTag(day, "Tiempo adicional") ||
    unauthorizedSupplementaryMinutes > toleranceMinutes ||
    unauthorizedExtraordinaryMinutes > toleranceMinutes;
}

function isPlannedPaidDecision(decision) {
  return ["pay_planned_day", "justify_no_punches", "justify_incomplete_punches"].includes(decision);
}

function isCompleteRegularDayDecision(decision) {
  return decision === "complete_regular_day";
}

function detectedSupplementaryMinutes(day) {
  return Number(day?.detectedSupplementaryMinutes) || 0;
}

function detectedExtraordinaryMinutes(day) {
  return Number(day?.detectedExtraordinaryMinutes) || 0;
}

function draftSupplementaryMinutes(day) {
  if (isExtraordinaryDay(day)) return 0;
  const authorizedMinutes = Number(day?.authorization?.authorizedSupplementaryMinutes);

  if (Number.isFinite(authorizedMinutes)) {
    return authorizedMinutes;
  }

  return detectedSupplementaryMinutes(day);
}

function draftExtraordinaryMinutes(day) {
  if (!isExtraordinaryDay(day)) return 0;
  const authorizedMinutes = Number(day?.authorization?.authorizedExtraordinaryMinutes);

  if (Number.isFinite(authorizedMinutes)) {
    return authorizedMinutes;
  }

  return detectedExtraordinaryMinutes(day);
}

function minutesToHourInput(value) {
  const totalMinutes = Math.max(0, Number(value) || 0);
  return totalMinutes ? String(totalMinutes) : "";
}

function hourInputToMinutes(value) {
  const rawValue = String(value ?? "").trim().replace(",", ".");

  if (!rawValue) return 0;

  return Math.max(0, Math.round(Number(rawValue) || 0));
}

function buildActionDrafts(days = []) {
  return Object.fromEntries(days.map((day) => [
    day.dateKey,
    {
      supplementary: isExtraordinaryDay(day) ? "" : minutesToHourInput(draftSupplementaryMinutes(day)),
      extraordinary: isExtraordinaryDay(day) ? minutesToHourInput(draftExtraordinaryMinutes(day)) : "",
      late: minutesToHourInput(defaultAppliedLateMinutes(day)),
      earlyLeave: minutesToHourInput(day.authorization?.adjustedEarlyLeaveMinutes ?? day.earlyLeaveMinutes ?? 0),
      note: day.authorization?.note || "",
      decision: day.authorization?.isSaved ? day.authorization?.decision || "custom" : "custom",
    },
  ]));
}

function plannedAuthorizationMinutes(day) {
  const plannedSupplementaryMinutes = Math.min(
    isExtraordinaryDay(day) ? 0 : Number(day.detectedSupplementaryMinutes) || 0,
    Math.max(0, Number(day.plannedSupplementaryMinutes) || 0),
  );
  const extraordinaryPlanLimit = day.weeklyAttendanceClassification === "extra"
    ? Math.max(0, Number(day.plannedExtraordinaryMinutes) || 0)
    : day.dayType === "weekend_overtime"
        ? Number(day.scheduledWorkedMinutes) || 0
        : Number(day.plannedExtraordinaryMinutes) || 0;
  const plannedExtraordinaryMinutes = Math.min(
    isExtraordinaryDay(day) ? Number(day.detectedExtraordinaryMinutes) || 0 : 0,
    extraordinaryPlanLimit,
  );

  return {
    plannedSupplementaryMinutes,
    plannedExtraordinaryMinutes,
  };
}

function plannedPaidDayMinutes(day) {
  return {
    plannedRegularMinutes: Math.max(0, Number(day?.plannedRegularMinutes) || 0),
    plannedSupplementaryMinutes: Math.max(0, Number(day?.plannedSupplementaryMinutes) || 0),
    plannedExtraordinaryMinutes: Math.max(0, Number(day?.plannedExtraordinaryMinutes) || 0),
  };
}

function authorizationPayloadForDay(employeeId, day, decision, draft = {}) {
  const isExtraordinary = isExtraordinaryDay(day);
  const draftSupplementaryMinutes = isExtraordinary ? 0 : hourInputToMinutes(draft.supplementary);
  const draftExtraordinaryMinutes = isExtraordinary ? hourInputToMinutes(draft.extraordinary) : 0;
  const draftLateMinutes = draft.late === undefined || draft.late === null
    ? defaultAppliedLateMinutes(day)
    : hourInputToMinutes(draft.late);
  const draftEarlyLeaveMinutes = draft.earlyLeave === undefined || draft.earlyLeave === null
    ? Number(day.earlyLeaveMinutes) || 0
    : hourInputToMinutes(draft.earlyLeave);
  const plannedPaidMinutes = plannedPaidDayMinutes(day);
  const detectedSupplementaryMinutes = Math.max(
    isExtraordinary ? 0 : Number(day.detectedSupplementaryMinutes) || 0,
    draftSupplementaryMinutes,
    isPlannedPaidDecision(decision) ? plannedPaidMinutes.plannedSupplementaryMinutes : 0,
  );
  const detectedExtraordinaryMinutes = Math.max(
    isExtraordinary ? Number(day.detectedExtraordinaryMinutes) || 0 : 0,
    draftExtraordinaryMinutes,
    isPlannedPaidDecision(decision) ? plannedPaidMinutes.plannedExtraordinaryMinutes : 0,
  );
  const plannedMinutes = plannedAuthorizationMinutes(day);
  const authorizedSupplementaryMinutes = decision === "full"
    ? detectedSupplementaryMinutes
    : ["none", "discount_day"].includes(decision)
      ? 0
    : decision === "reviewed"
      ? 0
    : isCompleteRegularDayDecision(decision)
      ? 0
    : isPlannedPaidDecision(decision)
      ? Math.min(detectedSupplementaryMinutes, draftSupplementaryMinutes)
    : decision === "planned"
      ? plannedMinutes.plannedSupplementaryMinutes
      : Math.min(detectedSupplementaryMinutes, draftSupplementaryMinutes);
  const authorizedExtraordinaryMinutes = decision === "full"
    ? detectedExtraordinaryMinutes
    : ["none", "discount_day"].includes(decision)
      ? 0
    : decision === "reviewed"
      ? 0
    : isCompleteRegularDayDecision(decision)
      ? 0
    : isPlannedPaidDecision(decision)
      ? Math.min(detectedExtraordinaryMinutes, draftExtraordinaryMinutes)
    : decision === "planned"
      ? plannedMinutes.plannedExtraordinaryMinutes
      : Math.min(detectedExtraordinaryMinutes, draftExtraordinaryMinutes);
  const detectedLateMinutes = Math.max(detectedLateIssueMinutes(day), draftLateMinutes);
  const adjustedLateMinutes = decision === "justify_late"
    ? Math.max(0, Number(day?.lunchOverageMinutes ?? day?.lunchOverageRemainderMinutes) || 0)
    : ["none", "discount_day", "pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
    ? 0
    : decision === "full" && (draft.late === undefined || draft.late === null || String(draft.late).trim() === "")
      ? detectedLateMinutes
      : Math.min(detectedLateMinutes, draftLateMinutes);
  const detectedEarlyLeaveMinutes = Math.max(Number(day.earlyLeaveMinutes) || 0, draftEarlyLeaveMinutes);
  const adjustedEarlyLeaveMinutes = ["none", "discount_day", "pay_planned_day", "complete_regular_day", "justify_early_leave", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
    ? 0
    : Math.min(detectedEarlyLeaveMinutes, draftEarlyLeaveMinutes);

  return {
    employeeId,
    dateKey: day.dateKey,
    decision,
    authorizedSupplementaryMinutes,
    authorizedExtraordinaryMinutes,
    detectedSupplementaryMinutes,
    detectedExtraordinaryMinutes,
    detectedLateMinutes,
    adjustedLateMinutes,
    detectedEarlyLeaveMinutes,
    adjustedEarlyLeaveMinutes,
    additionalResolved: draft.additionalResolved === true || [
      "full",
      "planned",
      "none",
      "discount_day",
      "pay_planned_day",
      "complete_regular_day",
    ].includes(decision),
    lateResolved: draft.lateResolved === true || [
      "reviewed",
      "resolve_late",
      "justify_late",
      "justify_early_leave",
      "none",
      "discount_day",
      "pay_planned_day",
      "complete_regular_day",
    ].includes(decision),
    note: draft.note || "",
  };
}

function buildDecisionPreview(day, draft = {}, summary = {}) {
  const isExtraordinary = isExtraordinaryDay(day);
  const draftSupplementaryMinutes = isExtraordinary ? 0 : hourInputToMinutes(draft.supplementary);
  const draftExtraordinaryMinutes = isExtraordinary ? hourInputToMinutes(draft.extraordinary) : 0;
  const plannedPaidMinutes = plannedPaidDayMinutes(day);
  const detectedSupplementaryMinutes = Math.max(isExtraordinary ? 0 : Number(day?.detectedSupplementaryMinutes) || 0, draftSupplementaryMinutes);
  const detectedExtraordinaryMinutes = Math.max(isExtraordinary ? Number(day?.detectedExtraordinaryMinutes) || 0 : 0, draftExtraordinaryMinutes);
  const isPayPlannedDay = isPlannedPaidDecision(draft.decision);
  const isCompleteRegularDay = isCompleteRegularDayDecision(draft.decision);
  const rawSupplementaryMinutes = isPayPlannedDay
    ? plannedPaidMinutes.plannedSupplementaryMinutes
    : isCompleteRegularDay
      ? 0
    : Math.min(detectedSupplementaryMinutes, draftSupplementaryMinutes);
  const rawExtraordinaryMinutes = isPayPlannedDay
    ? plannedPaidMinutes.plannedExtraordinaryMinutes
    : isCompleteRegularDay
      ? 0
    : Math.min(detectedExtraordinaryMinutes, draftExtraordinaryMinutes);
  const supplementaryMinutes = isExtraordinary
    ? 0
    : rawSupplementaryMinutes;
  const extraordinaryMinutes = isExtraordinary
    ? rawExtraordinaryMinutes
    : 0;
  const issueMinutes = applicableIssueMinutes(day, draft);
  const hourlyRate = Number(summary.hourlyRateRaw ?? summary.hourlyRate) || 0;
  const supplementaryMultiplier = Number(summary.supplementaryMultiplier) || 1.5;
  const extraordinaryMultiplier = Number(summary.extraordinaryMultiplier) || 2;
  const supplementaryAmount = (supplementaryMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, supplementaryMultiplier);
  const extraordinaryAmount = (extraordinaryMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, extraordinaryMultiplier);
  const previewSupplementaryAmount = supplementaryAmount;
  const previewExtraordinaryAmount = extraordinaryAmount;
  const total = previewSupplementaryAmount + previewExtraordinaryAmount;
  const additionalMultiplier = isExtraordinary ? extraordinaryMultiplier : supplementaryMultiplier;
  const plannedAdditional = plannedAdditionalMinutes(day);
  const detectedAdditional = registeredAdditionalMinutes(day);
  const registeredAdditional = isExtraordinary ? extraordinaryMinutes : supplementaryMinutes;

  return {
    supplementaryLabel: supplementaryMinutes ? formatMinutes(supplementaryMinutes) : "--",
    extraordinaryLabel: extraordinaryMinutes ? formatMinutes(extraordinaryMinutes) : "--",
    additionalLabel: formatMinutes(registeredAdditional),
    plannedAdditionalLabel: formatMinutes(plannedAdditional),
    detectedAdditionalLabel: formatMinutes(detectedAdditional),
    registeredAdditionalLabel: formatMinutes(registeredAdditional),
    plannedAmountLabel: moneyLabel((plannedAdditional / 60) * calculatePayrollAdditionalRate(hourlyRate, additionalMultiplier)),
    detectedAmountLabel: moneyLabel((detectedAdditional / 60) * calculatePayrollAdditionalRate(hourlyRate, additionalMultiplier)),
    registeredAmountLabel: moneyLabel((registeredAdditional / 60) * calculatePayrollAdditionalRate(hourlyRate, additionalMultiplier)),
    additionalKindLabel: additionalKindLabel(day),
    additionalKindLongLabel: additionalKindLabel(day, true),
    lateLabel: issueMinutes.lateMinutes ? formatMinutes(issueMinutes.lateMinutes) : "--",
    earlyLeaveLabel: issueMinutes.earlyLeaveMinutes ? formatMinutes(issueMinutes.earlyLeaveMinutes) : "--",
    lunchOverageLabel: issueMinutes.lunchOverageMinutes ? formatMinutes(issueMinutes.lunchOverageMinutes) : "--",
    issueDiscountLabel: issueMinutes.totalMinutes ? formatMinutes(issueMinutes.totalMinutes) : "--",
    breakdown: [
      ...(issueMinutes.totalMinutes > 0 ? [{ label: "Plan no completado", valueLabel: formatMinutes(issueMinutes.totalMinutes) }] : []),
    ],
    totalLabel: moneyLabel(total),
    statusLabel: draft.decision === "full"
      ? "Vista previa: todo"
      : draft.decision === "reviewed"
        ? "Vista previa: revisado"
      : draft.decision === "justify_no_punches"
        ? "Vista previa: ajustado a planificación"
      : draft.decision === "justify_incomplete_punches"
        ? "Vista previa: picadas justificadas"
      : draft.decision === "justify_late"
        ? "Vista previa: atraso justificado"
      : draft.decision === "resolve_late"
        ? "Vista previa: atraso revisado"
      : draft.decision === "justify_early_leave"
        ? "Vista previa: salida justificada"
      : draft.decision === "pay_planned_day"
        ? "Vista previa: pagar plan"
      : draft.decision === "complete_regular_day"
        ? "Vista previa: completar laboral"
      : draft.decision === "discount_day"
        ? "Vista previa: anular día"
      : draft.decision === "planned"
        ? "Vista previa: plan"
        : draft.decision === "none"
          ? "Vista previa: adicional no aprobado"
          : "Vista previa: ajuste",
  };
}

function exceptionNoteForDay(day) {
  const tags = visibleDayTags(day).join(", ") || "Alerta de asistencia";
  const schedule = fullScheduleLabel(day);
  const punches = (day.punches || []).map((punch) => punch.time).filter(Boolean).join(", ") || "sin picadas";

  return `${tags}. Horario: ${schedule}. Picadas: ${punches}.`;
}

function firstPunchTime(day) {
  return activePunchesForDisplay(day)[0]?.time || "";
}

function lastPunchTime(day) {
  const punches = activePunchesForDisplay(day);
  return punches[punches.length - 1]?.time || "";
}

function defaultInlineExceptionType(day) {
  if (hasDayTag(day, "Sin picadas")) return "missing_punch";

  const options = inlineExceptionOptionsForDay(day);

  if (options.length) {
    return options[0].value;
  }

  if (hasNoSchedulePunches(day)) return "extra_day";
  if (hasIncompletePunchTag(day)) return "missing_punch";
  if (displayLateMinutes(day) > 0) return "permission";
  return "outside_work";
}

function buildInlineExceptionDraft(row, day, nextType = "", templates = []) {
  const type = nextType || defaultInlineExceptionType(day);
  const hasSchedule = Boolean(day?.startTime && day?.endTime);
  const startTime = hasSchedule ? day.startTime : firstPunchTime(day);
  const endTime = hasSchedule ? day.endTime : lastPunchTime(day);
  const recommendedTemplate = type === "schedule_change"
    ? scheduleTemplateOptionsForDay(row?.employee, templates, day)[0]
    : null;
  const recommendedRow = recommendedTemplate?.row;
  const activePunches = activePunchesForDisplay(day);
  const extraDayHasLunch = type === "extra_day" && activePunches.length === 4;
  const expectedPunches = Math.max(0, Number(day?.expectedPunches) || 0);
  const missingPunchCount = Math.min(4, Math.max(1, expectedPunches - activePunches.length));

  return {
    employeeName: row?.employee?.fullName || "",
    dateKey: day?.dateKey || "",
    dateLabel: day?.dateLabel || "",
    dayLabel: day?.dayLabel || "",
    type,
    punchCount: activePunches.length,
    startTime: ["outside_work", "permission"].includes(type) ? startTime : "",
    endTime: ["outside_work", "permission"].includes(type) ? endTime : "",
    plannedStartTime: type === "extra_day"
      ? firstPunchTime(day)
      : type === "schedule_change"
      ? recommendedRow?.startTime || (hasSchedule ? day.startTime : "")
      : "",
    plannedLunchStartTime: type === "extra_day" && extraDayHasLunch
      ? activePunches[1]?.time || ""
      : type === "schedule_change"
      ? recommendedRow?.lunchStartTime || (hasSchedule ? day?.lunchStartTime || "" : "")
      : "",
    plannedLunchEndTime: type === "extra_day" && extraDayHasLunch
      ? activePunches[2]?.time || ""
      : type === "schedule_change"
      ? recommendedRow?.lunchEndTime || (hasSchedule ? day?.lunchEndTime || "" : "")
      : "",
    plannedEndTime: type === "extra_day"
      ? lastPunchTime(day)
      : type === "schedule_change"
      ? recommendedRow?.endTime || (hasSchedule ? day.endTime : "")
      : "",
    plannedDayType: "workday",
    templateId: recommendedTemplate?.id || "",
    missingPunchMode: "manual",
    manualPunchTimes: Array.from({ length: missingPunchCount }, () => ""),
    allowSupplementaryTime: type === "outside_work",
    permissionPayTreatment: "without_discount",
    permissionPunchIds: [],
    permissionPunchTimes: [],
    discountMinutes: 0,
    notes: exceptionNoteForDay(day),
  };
}

function inlineExceptionPayload(employeeId, draft) {
  const common = {
    planningSource: "attendance_comparison",
    employeeId,
    dateKey: draft.dateKey,
    type: draft.type,
    resolution: ["schedule_change", "extra_day"].includes(draft.type) ? "reschedule" : "approved_work_time",
    notes: draft.notes,
    autoResolve: true,
  };

  if (draft.type === "extra_day") {
    return {
      ...common,
      type: "schedule_change",
      scope: "full_day",
      effect: "planning_change",
      attendanceMode: "use_punches",
      payMode: "regular_and_extra",
      plannedDayType: "workday",
      plannedStartTime: draft.plannedStartTime,
      plannedLunchStartTime: draft.plannedLunchStartTime,
      plannedLunchEndTime: draft.plannedLunchEndTime,
      plannedEndTime: draft.plannedEndTime,
      applicableWeekdays: [dateFromDateKey(draft.dateKey).getUTCDay()],
      isExtraDay: true,
      allowSupplementaryTime: true,
    };
  }

  if (draft.type === "schedule_change") {
    const isRestDay = draft.plannedDayType === "off_day";

    return {
      ...common,
      scope: "full_day",
      effect: "planning_change",
      attendanceMode: "use_punches",
      payMode: "no_pay_change",
      plannedDayType: isRestDay ? "off_day" : "workday",
      plannedStartTime: isRestDay ? "" : draft.plannedStartTime,
      plannedLunchStartTime: isRestDay ? "" : draft.plannedLunchStartTime,
      plannedLunchEndTime: isRestDay ? "" : draft.plannedLunchEndTime,
      plannedEndTime: isRestDay ? "" : draft.plannedEndTime,
      applicableWeekdays: [dateFromDateKey(draft.dateKey).getUTCDay()],
    };
  }

  if (draft.type === "missing_punch") {
    if (draft.missingPunchMode === "manual") {
      return {
        ...common,
        scope: "missing_punch",
        effect: "manual_punch",
        attendanceMode: "add_manual_punch",
        payMode: "no_pay_change",
        manualPunchTime: draft.manualPunchTime,
        countsAsWorkedTime: true,
        allowSupplementaryTime: true,
      };
    }

    return {
      ...common,
      scope: "missing_punch",
      effect: "external_work",
      attendanceMode: "use_authorized_schedule",
      payMode: draft.allowSupplementaryTime ? "regular_and_extra" : "regular_only",
      allowSupplementaryTime: Boolean(draft.allowSupplementaryTime),
    };
  }

  if (draft.type === "outside_work") {
    return {
      ...common,
      scope: "outside_work",
      effect: "external_work",
      attendanceMode: "use_authorized_schedule",
      payMode: draft.allowSupplementaryTime ? "regular_and_extra" : "regular_only",
      startTime: draft.startTime,
      endTime: draft.endTime,
      countsAsWorkedTime: true,
      allowSupplementaryTime: Boolean(draft.allowSupplementaryTime),
    };
  }

  if (draft.type === "permission_punches") {
    const permissionHasDiscount = draft.permissionPayTreatment === "with_discount";

    return {
      ...common,
      type: "permission",
      resolution: permissionHasDiscount ? "discount_day" : "approved_work_time",
      scope: "exit_return",
      effect: permissionHasDiscount ? "unpaid_absence" : "paid_partial_leave",
      attendanceMode: "use_punches",
      payMode: permissionHasDiscount ? "discount" : "regular_only",
      startTime: draft.startTime,
      endTime: draft.endTime,
      permissionPunchIds: draft.permissionPunchIds,
      permissionPunchTimes: draft.permissionPunchTimes,
      discountMinutes: permissionHasDiscount ? Math.max(1, Number(draft.discountMinutes) || 0) : 0,
      countsAsWorkedTime: !permissionHasDiscount,
    };
  }

  const permissionHasDiscount = draft.permissionPayTreatment === "with_discount";

  return {
    ...common,
    resolution: permissionHasDiscount ? "discount_day" : "approved_work_time",
    scope: "partial_day",
    effect: permissionHasDiscount ? "unpaid_absence" : "paid_partial_leave",
    attendanceMode: "ignore_attendance",
    payMode: permissionHasDiscount ? "discount" : "regular_only",
    startTime: draft.startTime,
    endTime: draft.endTime,
    countsAsWorkedTime: !permissionHasDiscount,
  };
}

function quickActionNote(decision) {
  const notes = {
    discount_day: "Decisión: día sin tiempo trabajado validado para pago.",
    justify_no_punches: "Ajuste: se usan los valores del horario planificado.",
    justify_incomplete_punches: "Ajuste: picadas incompletas cubiertas con el horario planificado.",
    justify_late: "Justificación: atraso reconocido.",
    resolve_late: "Revisión: atraso validado, se conservan los minutos para descuento.",
    justify_early_leave: "Justificación: salida anticipada reconocida.",
    pay_planned_day: "Justificación: día planificado pagado.",
    complete_regular_day: "Justificación: jornada laboral completada sin adicionales.",
    reviewed: "Revisión: alerta validada sin cambio de valores.",
  };

  return notes[decision] || "";
}

function ToolButtonLabel({ Icon, label, count }) {
  return (
    <>
      {Icon ? <Icon size={16} aria-hidden="true" /> : null}
      <span className={styles.actionButtonText}>{label}</span>
      {count !== undefined ? <span className={styles.actionButtonCount}>{count}</span> : null}
    </>
  );
}

export default function AttendanceComparisonDetail({ employeeId, initialFilters = {} }) {
  const [stableInitialFilters] = useState(() => ({
    month: initialFilters.month || currentMonthKey(),
    branchCode: initialFilters.branchCode || "",
    areaCode: initialFilters.areaCode || "",
    roleCode: initialFilters.roleCode || "",
    onlyAdditional: Boolean(initialFilters.onlyAdditional),
    onlyLate: Boolean(initialFilters.onlyLate) && !Boolean(initialFilters.onlyAdditional),
    onlyIssues: Boolean(initialFilters.onlyIssues) && !Boolean(initialFilters.onlyLate) && !Boolean(initialFilters.onlyAdditional),
  }));
  const initialFiltersRef = useRef(stableInitialFilters);
  const [month, setMonth] = useState(() => stableInitialFilters.month);
  const [row, setRow] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionDrafts, setActionDrafts] = useState({});
  const [savingDay, setSavingDay] = useState("");
  const [savingBulkAction, setSavingBulkAction] = useState("");
  const [selectedDayKey, setSelectedDayKey] = useState("");
  const [pendingDeletePunch, setPendingDeletePunch] = useState(null);
  const [isSavingPunch, setIsSavingPunch] = useState(false);
  const [showOnlyIssueDays, setShowOnlyIssueDays] = useState(() => stableInitialFilters.onlyIssues);
  const [showOnlyLateDays, setShowOnlyLateDays] = useState(() => stableInitialFilters.onlyLate);
  const [showOnlyAdditionalDays, setShowOnlyAdditionalDays] = useState(() => stableInitialFilters.onlyAdditional);
  const [selectedLateDayKeys, setSelectedLateDayKeys] = useState([]);
  const [pendingSelectedLateAction, setPendingSelectedLateAction] = useState("");
  const [selectedLateNote, setSelectedLateNote] = useState("");
  const [selectedAdditionalApprovalMode, setSelectedAdditionalApprovalMode] = useState("all");
  const [selectedAdditionalApprovalMax, setSelectedAdditionalApprovalMax] = useState("");
  const [exceptionDraft, setExceptionDraft] = useState(null);
  const [isSavingException, setIsSavingException] = useState(false);
  const [pendingAdditionalApproval, setPendingAdditionalApproval] = useState(null);
  const [pendingManualAdditionalApproval, setPendingManualAdditionalApproval] = useState(null);
  const [isSavingManualAdditional, setIsSavingManualAdditional] = useState(false);
  const [decisionHistory, setDecisionHistory] = useState([]);
  const [isLoadingDecisionHistory, setIsLoadingDecisionHistory] = useState(false);
  const [pendingHistoryDelete, setPendingHistoryDelete] = useState(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState("");
  const decisionHistoryRequestRef = useRef(0);
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);

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

  const clearNotice = useCallback(() => {
    clearNoticeTimers();
    setNotice(null);
  }, [clearNoticeTimers]);

  const filters = {
    ...stableInitialFilters,
    month,
    onlyIssues: showOnlyIssueDays,
    onlyLate: showOnlyLateDays,
    onlyAdditional: showOnlyAdditionalDays,
  };
  const selectedDay = row?.days?.find((day) => day.dateKey === selectedDayKey) || null;
  const monthlyUnfulfilledMinutes = (row?.days || []).reduce(
    (total, day) => total + attendanceDelayMinutes(day),
    0,
  );
  const monthlyUnfulfilledDays = (row?.days || []).filter(
    (day) => attendanceDelayMinutes(day) > 0,
  ).length;
  const exceptionOptions = exceptionDraft ? inlineExceptionOptionsForDay(selectedDay) : [];
  const exceptionTemplateOptions = exceptionDraft?.type === "schedule_change"
    && exceptionDraft?.plannedDayType !== "off_day"
    ? scheduleTemplateOptionsForDay(row?.employee, templates, selectedDay)
    : [];
  const scheduleChangeCreatesExtraPunchLayer = createsExtraPunchLayer(selectedDay, exceptionDraft);
  const reviewableIssueDays = row?.days?.filter(hasReviewableDayAlert) || [];
  const lateIssueDays = row?.days?.filter(hasLateDayAlert) || [];
  const additionalIssueDays = row?.days?.filter(hasAdditionalDayAlert) || [];
  const visibleReportDays = (row?.days || [])
    .filter((day) => !showOnlyIssueDays || hasReviewableDayAlert(day))
    .filter((day) => !showOnlyLateDays || hasLateDayAlert(day))
    .filter((day) => !showOnlyAdditionalDays || hasAdditionalDayAlert(day));
  const visibleLateDays = visibleReportDays.filter(hasLateDayAlert);
  const visibleAdditionalDays = visibleReportDays.filter(hasAdditionalDayAlert);
  const selectableReviewDays = showOnlyAdditionalDays ? visibleAdditionalDays : visibleLateDays;
  const selectedLateDays = selectableReviewDays.filter((day) => selectedLateDayKeys.includes(day.dateKey));
  const selectedAdditionalDetectedTotal = selectedLateDays.reduce(
    (total, day) => total + detectedAdditionalMinutesForDay(day),
    0,
  );
  const allVisibleLateDaysSelected = Boolean(selectableReviewDays.length) && selectedLateDays.length === selectableReviewDays.length;
  const visibleWeekGroups = groupDaysByWeek(visibleReportDays);
  const selectedDraft = selectedDay ? actionDrafts[selectedDay.dateKey] || {} : {};
  const selectedPreview = selectedDay ? buildDecisionPreview(selectedDay, selectedDraft, row?.summary || {}) : null;
  const selectedIsReviewed = Boolean(
    selectedDay?.authorization?.isSaved &&
    ["reviewed", "resolve_late"].includes(selectedDay.authorization.decision),
  );
  const selectedHasIncompletePunches = selectedDay ? hasIncompletePunchTag(selectedDay) : false;
  const selectedHasOperationalStage = selectedDay ? hasReviewableDayAlert(selectedDay) : false;
  const selectedHasLateStage = selectedDay ? hasLateDayAlert(selectedDay) : false;
  const selectedHasCleanableAlert = selectedHasOperationalStage;
  const selectedCanDiscountPlannedDay = selectedDay
    ? (hasDayTag(selectedDay, "Sin picadas") || hasIncompletePunchTag(selectedDay)) &&
      activePunchesForDisplay(selectedDay).length === 0
    : false;
  const selectedCanUsePlannedDay = selectedDay ? canAdjustAlertToPlanned(selectedDay) : false;
  const selectedHasAdditionalStage = selectedDay ? hasAdditionalDayAlert(selectedDay) : false;
  const selectedHasOnlyAdditionalTime = selectedDay
    ? selectedHasAdditionalStage &&
      hasUnapprovedExtraTime(selectedDay) &&
      !hasNoSchedulePunches(selectedDay)
    : false;
  const selectedHasQuickActions = selectedHasOnlyAdditionalTime || (
    !selectedIsReviewed && Boolean(
      selectedHasCleanableAlert ||
      hasNoSchedulePunches(selectedDay) ||
      selectedCanDiscountPlannedDay ||
      selectedHasLateStage ||
      selectedCanUsePlannedDay
    )
  );
  const selectedCanAuthorizeManualAdditional = Boolean(
    selectedDay
    && !selectedHasOperationalStage
    && !selectedHasLateStage
    && !selectedHasAdditionalStage
    && selectedDay.dayType !== "vacation"
    && !["employment_pending", "employment_ended"].includes(selectedDay.source),
  );
  const selectedPlannedDayDecision = selectedHasIncompletePunches ? "justify_incomplete_punches" : "justify_no_punches";

  function syncUrl(nextMonth, nextFilters = {}) {
    if (typeof window === "undefined") return;

    let nextOnlyIssues = nextFilters.onlyIssues ?? showOnlyIssueDays;
    let nextOnlyLate = nextFilters.onlyLate ?? showOnlyLateDays;
    let nextOnlyAdditional = nextFilters.onlyAdditional ?? showOnlyAdditionalDays;

    if (nextFilters.onlyIssues === true) {
      nextOnlyLate = false;
      nextOnlyAdditional = false;
    }

    if (nextFilters.onlyLate === true) {
      nextOnlyIssues = false;
      nextOnlyAdditional = false;
    }

    if (nextFilters.onlyAdditional === true) {
      nextOnlyIssues = false;
      nextOnlyLate = false;
    }

    if ([nextOnlyIssues, nextOnlyLate, nextOnlyAdditional].filter(Boolean).length > 1) {
      nextOnlyIssues = false;
      nextOnlyLate = false;
      nextOnlyAdditional = false;
    }

    const params = new URLSearchParams();
    params.set("month", nextMonth);

    if (filters.branchCode) params.set("branchCode", filters.branchCode);
    if (filters.areaCode) params.set("areaCode", filters.areaCode);
    if (filters.roleCode) params.set("roleCode", filters.roleCode);
    if (nextOnlyIssues) params.set("onlyIssues", "1");
    if (nextOnlyLate) params.set("onlyLate", "1");
    if (nextOnlyAdditional) params.set("onlyAdditional", "1");

    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  const loadReport = useCallback(async (nextMonth, options = {}) => {
    try {
      if (!options.background) {
        setIsLoading(true);
      }
      setError("");

      const targetMonth = nextMonth || initialFiltersRef.current.month;
      const params = new URLSearchParams();
      params.set("month", targetMonth);
      params.set("employeeId", employeeId);

      const response = await fetch(`/api/planner/attendance/comparison?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo cargar el reporte.");
      }

      const nextRow = payload.rows?.[0] || null;
      setRow(nextRow);
      setActionDrafts(buildActionDrafts(nextRow?.days || []));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      if (!options.background) {
        setIsLoading(false);
      }
    }
  }, [employeeId]);

  const loadDecisionHistory = useCallback(async (dateKey) => {
    const requestId = decisionHistoryRequestRef.current + 1;
    decisionHistoryRequestRef.current = requestId;

    if (!dateKey) {
      setDecisionHistory([]);
      setIsLoadingDecisionHistory(false);
      return;
    }

    try {
      setIsLoadingDecisionHistory(true);
      const params = new URLSearchParams({ employeeId, dateKey });
      const response = await fetch(`/api/planner/attendance/decision-history?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo cargar el historial de decisiones.");
      }

      if (decisionHistoryRequestRef.current === requestId) {
        setDecisionHistory(payload.history || []);
      }
    } catch (requestError) {
      if (decisionHistoryRequestRef.current === requestId) {
        setDecisionHistory([]);
        setError(requestError.message);
      }
    } finally {
      if (decisionHistoryRequestRef.current === requestId) {
        setIsLoadingDecisionHistory(false);
      }
    }
  }, [employeeId]);

  useEffect(() => {
    async function refreshHistory() {
      await loadDecisionHistory(selectedDayKey);
    }

    refreshHistory();
  }, [loadDecisionHistory, selectedDayKey]);

  useEffect(() => {
    let isCancelled = false;

    async function loadTemplates() {
      try {
        const response = await fetch("/api/planner/planning/base-schedules");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudieron cargar las plantillas.");
        }

        if (!isCancelled) {
          setTemplates(payload.templates || []);
        }
      } catch (requestError) {
        if (!isCancelled) {
          setError(requestError.message);
        }
      }
    }

    loadTemplates();

    return () => {
      isCancelled = true;
    };
  }, []);

  function handleMonthChange(value) {
    clearNotice();
    setMonth(value);
    syncUrl(value);
    loadReport(value);
  }

  function toggleOnlyIssueDays() {
    const nextValue = !showOnlyIssueDays;
    setShowOnlyIssueDays(nextValue);
    setShowOnlyLateDays(false);
    setShowOnlyAdditionalDays(false);
    setSelectedLateDayKeys([]);
    syncUrl(month, { onlyIssues: nextValue, onlyLate: false, onlyAdditional: false });
  }

  function toggleOnlyLateDays() {
    const nextValue = !showOnlyLateDays;
    setShowOnlyIssueDays(false);
    setShowOnlyLateDays(nextValue);
    setShowOnlyAdditionalDays(false);
    setSelectedLateDayKeys([]);
    syncUrl(month, { onlyIssues: false, onlyLate: nextValue, onlyAdditional: false });
  }

  function toggleOnlyAdditionalDays() {
    const nextValue = !showOnlyAdditionalDays;
    setShowOnlyIssueDays(false);
    setShowOnlyLateDays(false);
    setShowOnlyAdditionalDays(nextValue);
    setSelectedLateDayKeys([]);
    syncUrl(month, { onlyIssues: false, onlyLate: false, onlyAdditional: nextValue });
  }

  function showAllDays() {
    setShowOnlyIssueDays(false);
    setShowOnlyLateDays(false);
    setShowOnlyAdditionalDays(false);
    setSelectedLateDayKeys([]);
    syncUrl(month, { onlyIssues: false, onlyLate: false, onlyAdditional: false });
  }

  function toggleLateDaySelection(dateKey) {
    setSelectedLateDayKeys((current) =>
      current.includes(dateKey)
        ? current.filter((key) => key !== dateKey)
        : [...current, dateKey],
    );
  }

  function toggleVisibleLateDaySelection() {
    setSelectedLateDayKeys(allVisibleLateDaysSelected ? [] : selectableReviewDays.map((day) => day.dateKey));
  }

  function openSelectedLateDecision(decision) {
    if (!selectedLateDays.length) return;
    setSelectedLateNote(decision === "justify_late" ? "" : decision === "approve_additional" ? "Tiempo adicional aprobado." : "Atraso revisado, se conserva el descuento detectado.");
    setSelectedAdditionalApprovalMode("all");
    setSelectedAdditionalApprovalMax("");
    setPendingSelectedLateAction(decision);
  }

  function closeSelectedLateDecision() {
    if (!savingBulkAction) {
      setPendingSelectedLateAction("");
      setSelectedLateNote("");
      setSelectedAdditionalApprovalMode("all");
      setSelectedAdditionalApprovalMax("");
    }
  }

  function openInlineException(day, type = "") {
    setExceptionDraft(buildInlineExceptionDraft(row, day, type, templates));
  }

  function closeInlineException() {
    if (!isSavingException) {
      setExceptionDraft(null);
    }
  }

  function updateExceptionDraft(field, value) {
    setExceptionDraft((current) => current ? { ...current, [field]: value } : current);
  }

  function togglePermissionPunch(punch) {
    setExceptionDraft((current) => {
      if (!current || current.type !== "permission_punches") return current;

      const currentIds = current.permissionPunchIds || [];
      const isSelected = currentIds.includes(punch.id);
      const nextIds = isSelected
        ? currentIds.filter((id) => id !== punch.id)
        : currentIds.length < 2
          ? [...currentIds, punch.id]
          : currentIds;
      const punchesById = new Map((selectedDay?.punches || []).map((item) => [item.id, item]));
      const selectedPunches = nextIds
        .map((id) => punchesById.get(id))
        .filter(Boolean)
        .sort((left, right) => String(left.time || "").localeCompare(String(right.time || "")));
      const permissionPunchIds = selectedPunches.map((item) => item.id);
      const permissionPunchTimes = selectedPunches.map((item) => item.time);
      const startTime = permissionPunchTimes[0] || "";
      const endTime = permissionPunchTimes[1] || "";
      const startMinutes = scheduleTimeToMinutes(startTime);
      const endMinutes = scheduleTimeToMinutes(endTime);
      const intervalMinutes = startMinutes !== null && endMinutes !== null && endMinutes > startMinutes
        ? endMinutes - startMinutes
        : 0;

      return {
        ...current,
        permissionPunchIds,
        permissionPunchTimes,
        startTime,
        endTime,
        discountMinutes: current.permissionPayTreatment === "with_discount" ? intervalMinutes : 0,
      };
    });
  }

  function updatePermissionPayTreatment(value) {
    setExceptionDraft((current) => {
      if (!current) return current;

      const startMinutes = scheduleTimeToMinutes(current.startTime);
      const endMinutes = scheduleTimeToMinutes(current.endTime);
      const intervalMinutes = startMinutes !== null && endMinutes !== null && endMinutes > startMinutes
        ? endMinutes - startMinutes
        : 0;

      return {
        ...current,
        permissionPayTreatment: value,
        discountMinutes: value === "with_discount"
          ? Math.max(1, Number(current.discountMinutes) || intervalMinutes)
          : 0,
      };
    });
  }

  function updateManualPunchTime(index, value) {
    setExceptionDraft((current) => {
      if (!current) return current;

      const manualPunchTimes = [...(current.manualPunchTimes || [""])];
      manualPunchTimes[index] = value;

      return { ...current, manualPunchTimes };
    });
  }

  function addManualPunchTime() {
    setExceptionDraft((current) => {
      if (!current || (current.manualPunchTimes || []).length >= 4) return current;
      return { ...current, manualPunchTimes: [...(current.manualPunchTimes || []), ""] };
    });
  }

  function removeManualPunchTime(index) {
    setExceptionDraft((current) => {
      if (!current) return current;

      const manualPunchTimes = (current.manualPunchTimes || []).filter((_, currentIndex) => currentIndex !== index);

      return { ...current, manualPunchTimes: manualPunchTimes.length ? manualPunchTimes : [""] };
    });
  }

  function selectExceptionType(type) {
    if (!selectedDay) return;
    setExceptionDraft(buildInlineExceptionDraft(row, selectedDay, type, templates));
  }

  function selectExceptionTemplate(templateId) {
    const option = exceptionTemplateOptions.find((candidate) => candidate.id === templateId);

    if (!option?.row) {
      updateExceptionDraft("templateId", "");
      return;
    }

    setExceptionDraft((current) => current ? {
      ...current,
      templateId,
      plannedStartTime: option.row.startTime || current.plannedStartTime,
      plannedLunchStartTime: option.row.lunchStartTime || "",
      plannedLunchEndTime: option.row.lunchEndTime || "",
      plannedEndTime: option.row.endTime || current.plannedEndTime,
    } : current);
  }

  function isExceptionDraftValid(draft) {
    if (!draft) return false;
    if (String(draft.notes || "").trim().length < 4) return false;

    if (draft.type === "schedule_change") {
      if (draft.plannedDayType === "off_day") return true;

      const requiresTemplate = exceptionTemplateOptions.length > 0;
      return Boolean(
        draft.plannedStartTime &&
        draft.plannedEndTime &&
        (!requiresTemplate || draft.templateId)
      );
    }

    if (draft.type === "extra_day") {
      return [2, 4].includes(Number(draft.punchCount))
        && Boolean(draft.plannedStartTime && draft.plannedEndTime);
    }

    if (draft.type === "missing_punch" && draft.missingPunchMode === "manual") {
      const manualPunchTimes = (draft.manualPunchTimes || [])
        .map((time) => formatTime24(time))
        .filter(Boolean);
      const uniqueManualTimes = new Set(manualPunchTimes);
      const existingPunchTimes = new Set(activePunchesForDisplay(selectedDay).map((punch) => punch.time));

      return Boolean(
        manualPunchTimes.length &&
        manualPunchTimes.length === (draft.manualPunchTimes || []).length &&
        uniqueManualTimes.size === manualPunchTimes.length &&
        manualPunchTimes.every((time) => !existingPunchTimes.has(time))
      );
    }

    if (draft.type === "permission_punches") {
      return draft.permissionPunchIds?.length === 2
        && Boolean(draft.startTime && draft.endTime)
        && (
          draft.permissionPayTreatment !== "with_discount"
          || Number(draft.discountMinutes) > 0
        );
    }

    if (["outside_work", "permission"].includes(draft.type)) {
      return Boolean(draft.startTime && draft.endTime);
    }

    return true;
  }

  async function saveInlineException() {
    if (!exceptionDraft || !isExceptionDraftValid(exceptionDraft)) return;

    try {
      setIsSavingException(true);
      setError("");
      clearNotice();

      if (exceptionDraft.type === "missing_punch" && exceptionDraft.missingPunchMode === "manual") {
        const manualPunchTimes = exceptionDraft.manualPunchTimes.map((time) => formatTime24(time));

        for (const manualPunchTime of manualPunchTimes) {
          const exceptionResponse = await fetch("/api/planner/planning/exceptions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(inlineExceptionPayload(employeeId, {
              ...exceptionDraft,
              manualPunchTime,
            })),
          });
          const exceptionPayload = await exceptionResponse.json();

          if (!exceptionResponse.ok) {
            throw new Error(exceptionPayload.error || "No se pudo registrar la picada manual.");
          }
        }

        const dayKey = exceptionDraft.dateKey;
        const punchCount = manualPunchTimes.length;

        setExceptionDraft(null);
        setSelectedDayKey(dayKey);
        await loadReport(month, { background: true });
        await loadDecisionHistory(dayKey);
        showNotice(
          "success",
          punchCount === 1
            ? "Picada manual registrada y jornada recalculada."
            : `${punchCount} picadas manuales registradas y jornada recalculada.`,
        );
        return;
      }

      const response = await fetch("/api/planner/planning/exceptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(inlineExceptionPayload(employeeId, exceptionDraft)),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo crear la excepción.");
      }

      const dayKey = exceptionDraft.dateKey;
      const wasResolved = payload.exception?.resolution && payload.exception.resolution !== "pending";
      setExceptionDraft(null);
      setSelectedDayKey(dayKey);
      await loadReport(month, { background: true });
      await loadDecisionHistory(dayKey);
      showNotice(
        "success",
        wasResolved
          ? `Excepción aplicada correctamente para ${exceptionDraft.dayLabel} ${exceptionDraft.dateLabel}.`
          : `Excepción enviada a aprobación para ${exceptionDraft.dayLabel} ${exceptionDraft.dateLabel}.`,
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSavingException(false);
    }
  }

  function quickActionDraft(day, decision, currentDraft = {}) {
    const plannedMinutes = plannedAuthorizationMinutes(day);
    const plannedPaidMinutes = plannedPaidDayMinutes(day);
    const isExtraordinary = isExtraordinaryDay(day);
    const detectedLateInput = minutesToHourInput(unresolvedLateMinutes(day));
    const detectedEarlyLeaveInput = minutesToHourInput(day.authorization?.detectedEarlyLeaveMinutes ?? day.earlyLeaveMinutes ?? 0);

    return {
      ...currentDraft,
      supplementary: isExtraordinary
        ? ""
        : ["none", "discount_day"].includes(decision)
          ? ""
        : decision === "full"
        ? minutesToHourInput(day.detectedSupplementaryMinutes || 0)
        : ["justify_late", "resolve_late"].includes(decision)
          ? (currentDraft.supplementary || "")
        : decision === "justify_early_leave"
          ? (currentDraft.supplementary || "")
        : decision === "reviewed"
          ? (currentDraft.supplementary || "")
        : isCompleteRegularDayDecision(decision)
          ? ""
        : decision === "justify_no_punches"
          ? ""
        : isPlannedPaidDecision(decision)
          ? minutesToHourInput(plannedPaidMinutes.plannedSupplementaryMinutes)
        : decision === "planned"
          ? minutesToHourInput(plannedMinutes.plannedSupplementaryMinutes)
          : "",
      extraordinary: !isExtraordinary
        ? ""
        : ["none", "discount_day"].includes(decision)
          ? ""
        : decision === "full"
        ? minutesToHourInput(day.detectedExtraordinaryMinutes || 0)
        : ["justify_late", "resolve_late"].includes(decision)
          ? (currentDraft.extraordinary || "")
        : decision === "justify_early_leave"
          ? (currentDraft.extraordinary || "")
        : decision === "reviewed"
          ? (currentDraft.extraordinary || "")
        : isCompleteRegularDayDecision(decision)
          ? ""
        : decision === "justify_no_punches"
          ? ""
        : isPlannedPaidDecision(decision)
          ? minutesToHourInput(plannedPaidMinutes.plannedExtraordinaryMinutes)
        : decision === "planned"
          ? minutesToHourInput(plannedMinutes.plannedExtraordinaryMinutes)
          : "",
      late: ["none", "discount_day", "planned", "pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches", "justify_late"].includes(decision)
        ? ""
        : decision === "resolve_late"
          ? detectedLateInput
        : decision === "reviewed"
          ? (currentDraft.late ?? detectedLateInput)
          : detectedLateInput,
      earlyLeave: ["none", "discount_day", "planned", "pay_planned_day", "complete_regular_day", "justify_early_leave", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
        ? ""
        : decision === "reviewed"
          ? (currentDraft.earlyLeave ?? detectedEarlyLeaveInput)
          : detectedEarlyLeaveInput,
      note: quickActionNote(decision) || currentDraft.note || "",
      decision,
    };
  }

  async function applyQuickAction(day, decision) {
    const draft = quickActionDraft(day, decision, actionDrafts[day.dateKey] || {});
    await saveDayAction(day, draft);
  }

  function openDeletePunch(day, punch) {
    if (punch?.isIgnored) return;

    setPendingDeletePunch({
      dayLabel: day.dayLabel,
      dateLabel: day.dateLabel,
      dateKey: day.dateKey,
      punch,
      reason: "",
    });
  }

  function updateDeletePunchReason(value) {
    setPendingDeletePunch((current) => current ? { ...current, reason: value } : current);
  }

  function closeDeletePunch() {
    if (!isSavingPunch) setPendingDeletePunch(null);
  }

  async function deleteSelectedPunch() {
    if (!pendingDeletePunch?.punch?.id) return;

    try {
      setIsSavingPunch(true);
      setError("");

      const response = await fetch(`/api/planner/attendance/punches/${pendingDeletePunch.punch.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: pendingDeletePunch.reason,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo anular la picada.");
      }

      setSelectedDayKey(pendingDeletePunch.dateKey);
      setPendingDeletePunch(null);
      await loadReport(month, { background: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSavingPunch(false);
    }
  }

  function openDayDecision(day) {
    if (!canOpenDayDecision(day)) return;
    setSelectedDayKey(day.dateKey);
  }

  function closeDayDecision() {
    setExceptionDraft(null);
    setPendingAdditionalApproval(null);
    setPendingManualAdditionalApproval(null);
    setPendingHistoryDelete(null);

    if (selectedDay) {
      setActionDrafts((current) => ({
        ...current,
        [selectedDay.dateKey]: buildActionDrafts([selectedDay])[selectedDay.dateKey],
      }));
    }

    setSelectedDayKey("");
  }

  function detectedAdditionalMinutesForDay(day) {
    if (!day) return 0;

    return isExtraordinaryDay(day)
      ? Math.max(0, Number(day.detectedExtraordinaryMinutes) || 0)
      : Math.max(0, Number(day.detectedSupplementaryMinutes) || 0);
  }

  function openAdditionalApproval(day) {
    const detectedMinutes = detectedAdditionalMinutesForDay(day);
    const plannedMinutes = Math.min(detectedMinutes, plannedAdditionalMinutes(day));
    const maximumExcessMinutes = Math.max(0, detectedMinutes - plannedMinutes);
    const currentApprovedMinutes = isExtraordinaryDay(day)
      ? Number(day?.authorization?.authorizedExtraordinaryMinutes) || 0
      : Number(day?.authorization?.authorizedSupplementaryMinutes) || 0;
    const isEdit = hasSavedDayDecision(day);
    const currentApprovedExcessMinutes = Math.max(0, currentApprovedMinutes - plannedMinutes);
    const approvalMode = isEdit
      ? currentApprovedExcessMinutes <= 0
        ? "planned"
        : currentApprovedMinutes >= detectedMinutes
          ? "all"
          : "custom"
      : plannedMinutes > 0
        ? "planned"
        : "all";

    setPendingAdditionalApproval({
      dateKey: day.dateKey,
      minutes: String((isEdit ? currentApprovedExcessMinutes : maximumExcessMinutes) || ""),
      detectedMinutes,
      plannedMinutes,
      maximumExcessMinutes,
      approvalMode,
      isEdit,
      note: !isEdit && plannedMinutes > 0 ? "Se mantiene el tiempo planificado." : "Excedente autorizado.",
    });
  }

  function updateAdditionalApproval(field, value) {
    setPendingAdditionalApproval((current) => current ? { ...current, [field]: value } : current);
  }

  function selectAdditionalApprovalMode(approvalMode) {
    setPendingAdditionalApproval((current) => {
      if (!current) return current;

      const hasDefaultApprovalNote = !current.note || current.note === "Excedente autorizado.";
      const hasDefaultPlannedNote = current.note === "Se mantiene el tiempo planificado.";

      return {
        ...current,
        approvalMode,
        note: approvalMode === "planned" && hasDefaultApprovalNote
          ? "Se mantiene el tiempo planificado."
          : approvalMode !== "planned" && hasDefaultPlannedNote
            ? "Excedente autorizado."
            : current.note,
      };
    });
  }

  async function saveAdditionalApproval() {
    if (!selectedDay || !pendingAdditionalApproval) return;

    const detectedMinutes = detectedAdditionalMinutesForDay(selectedDay);
    const isPlannedOnly = pendingAdditionalApproval.approvalMode === "planned";
    const plannedMinutes = Math.min(detectedMinutes, pendingAdditionalApproval.plannedMinutes || 0);
    const approvedMinutes = isPlannedOnly
      ? plannedMinutes
      : pendingAdditionalApproval.approvalMode === "all"
        ? detectedMinutes
        : Math.min(detectedMinutes, plannedMinutes + hourInputToMinutes(pendingAdditionalApproval.minutes));
    const approvedExcessMinutes = Math.max(0, approvedMinutes - plannedMinutes);
    const draft = {
      ...(actionDrafts[selectedDay.dateKey] || {}),
      decision: "custom",
      supplementary: isExtraordinaryDay(selectedDay) ? "" : minutesToHourInput(approvedMinutes),
      extraordinary: isExtraordinaryDay(selectedDay) ? minutesToHourInput(approvedMinutes) : "",
      late: minutesToHourInput(defaultAppliedLateMinutes(selectedDay)),
      earlyLeave: minutesToHourInput(
        selectedDay.authorization?.adjustedEarlyLeaveMinutes ?? selectedDay.earlyLeaveMinutes ?? 0,
      ),
      note: pendingAdditionalApproval.note || (isPlannedOnly
        ? "Se mantiene el tiempo planificado."
        : "Excedente autorizado."),
      additionalResolved: true,
    };

    const wasSaved = await saveDayAction(
      selectedDay,
      draft,
      isPlannedOnly
        ? `${formatMinutes(plannedMinutes)} planificados; no se autorizó tiempo por encima del plan.`
        : `${formatMinutes(approvedExcessMinutes)} por encima del plan ${pendingAdditionalApproval.isEdit ? "actualizados" : "autorizados"}.`,
    );

    if (wasSaved) {
      setPendingAdditionalApproval(null);
    }
  }

  function openManualAdditionalApproval(day) {
    const isExtraordinary = isExtraordinaryDay(day);
    const currentMinutes = isExtraordinary
      ? Number(day?.authorization?.manualExtraordinaryMinutes) || 0
      : Number(day?.authorization?.manualSupplementaryMinutes) || 0;

    setPendingManualAdditionalApproval({
      dateKey: day.dateKey,
      minutes: minutesToHourInput(currentMinutes),
      reason: day?.authorization?.manualAdditionalReason || "",
      isEdit: currentMinutes > 0,
    });
  }

  function updateManualAdditionalApproval(field, value) {
    setPendingManualAdditionalApproval((current) => current ? { ...current, [field]: value } : current);
  }

  async function saveManualAdditionalApproval() {
    if (!selectedDay || !pendingManualAdditionalApproval) return;

    const manualMinutes = hourInputToMinutes(pendingManualAdditionalApproval.minutes);
    const reason = String(pendingManualAdditionalApproval.reason || "").trim();
    const isExtraordinary = isExtraordinaryDay(selectedDay);
    const baselinePayload = authorizationPayloadForDay(
      employeeId,
      selectedDay,
      "custom",
      actionDrafts[selectedDay.dateKey] || {},
    );

    try {
      setIsSavingManualAdditional(true);
      setError("");
      clearNotice();

      const response = await fetch("/api/planner/attendance/day-decisions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...baselinePayload,
          action: "manual_additional",
          manualSupplementaryMinutes: isExtraordinary ? 0 : manualMinutes,
          manualExtraordinaryMinutes: isExtraordinary ? manualMinutes : 0,
          manualAdditionalReason: reason,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo aprobar el tiempo adicional.");
      }

      const dayKey = selectedDay.dateKey;
      const wasEdit = pendingManualAdditionalApproval.isEdit;

      setPendingManualAdditionalApproval(null);
      setSelectedDayKey(dayKey);
      await loadReport(month, { background: true });
      await loadDecisionHistory(dayKey);
      showNotice(
        "success",
        wasEdit
          ? "Tiempo adicional manual actualizado correctamente."
          : "Tiempo adicional manual aprobado correctamente.",
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSavingManualAdditional(false);
    }
  }

  async function saveDayAction(day, overrideDraft = null, successMessage = "Decisión guardada correctamente.") {
    const draft = overrideDraft || actionDrafts[day.dateKey] || {};
    const decision = [
      "full",
      "planned",
      "none",
      "discount_day",
      "pay_planned_day",
      "complete_regular_day",
      "reviewed",
      "justify_early_leave",
      "justify_no_punches",
      "justify_incomplete_punches",
      "justify_late",
      "resolve_late",
    ].includes(draft.decision) ? draft.decision : "custom";

    try {
      setSavingDay(day.dateKey);
      setError("");
      clearNotice();

      const response = await fetch("/api/planner/attendance/day-decisions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(authorizationPayloadForDay(employeeId, day, decision, draft)),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo guardar la decisión.");
      }

      setSelectedDayKey("");
      await loadReport(month);
      showNotice("success", successMessage);
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setSavingDay("");
    }
  }

  async function deleteHistoryDecision() {
    if (!pendingHistoryDelete || !selectedDay) return;

    const item = pendingHistoryDelete.item;

    try {
      setDeletingHistoryId(item.id);
      setError("");
      clearNotice();

      const isException = item.kind === "operational_exception";
      const response = await fetch(
        isException
          ? `/api/planner/planning/exceptions/${item.sourceId}`
          : "/api/planner/attendance/day-decisions",
        {
          method: "DELETE",
          headers: isException ? undefined : { "Content-Type": "application/json" },
          body: isException
            ? undefined
            : JSON.stringify({ employeeId, dateKey: selectedDay.dateKey }),
        },
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo desactivar la decisión.");
      }

      const dateKey = selectedDay.dateKey;
      setPendingHistoryDelete(null);
      await loadReport(month, { background: true });
      await loadDecisionHistory(dateKey);
      showNotice("success", payload.message || "Decisión desactivada correctamente. El antecedente permanece en el historial.");
    } catch (requestError) {
      showNotice("error", requestError.message);
    } finally {
      setDeletingHistoryId("");
    }
  }

  async function saveSelectedLateDecision() {
    if (!pendingSelectedLateAction || !selectedLateDays.length) return;

    const note = String(selectedLateNote || "").trim();

    if (pendingSelectedLateAction === "justify_late" && note.length < 4) {
      setError("Agrega una nota para justificar los atrasos seleccionados.");
      return;
    }

    const maxAdditionalMinutes = hourInputToMinutes(selectedAdditionalApprovalMax);

    if (
      pendingSelectedLateAction === "approve_additional" &&
      selectedAdditionalApprovalMode === "max" &&
      maxAdditionalMinutes <= 0
    ) {
      setError("Indica el máximo de minutos a aprobar por día.");
      return;
    }

    try {
      setSavingBulkAction(pendingSelectedLateAction);
      setError("");
      clearNotice();
      const selectedDayCount = selectedLateDays.length;

      for (const day of selectedLateDays) {
        const detectedAdditionalMinutes = detectedAdditionalMinutesForDay(day);
        const plannedPayableMinutes = Math.min(detectedAdditionalMinutes, plannedAdditionalMinutes(day));
        const detectedExcessMinutes = Math.max(0, detectedAdditionalMinutes - plannedPayableMinutes);
        const approvedAdditionalMinutes = pendingSelectedLateAction === "approve_additional"
          ? selectedAdditionalApprovalMode === "max"
            ? plannedPayableMinutes + Math.min(detectedExcessMinutes, maxAdditionalMinutes)
            : selectedAdditionalApprovalMode === "planned"
              ? plannedPayableMinutes
            : detectedAdditionalMinutes
          : 0;
        const decision = pendingSelectedLateAction === "justify_late"
          ? "justify_late"
          : pendingSelectedLateAction === "approve_additional"
            ? "custom"
            : "resolve_late";
        const draft = pendingSelectedLateAction === "approve_additional"
          ? {
            ...quickActionDraft(day, "custom", {}),
            supplementary: isExtraordinaryDay(day) ? "" : minutesToHourInput(approvedAdditionalMinutes),
            extraordinary: isExtraordinaryDay(day) ? minutesToHourInput(approvedAdditionalMinutes) : "",
            late: minutesToHourInput(defaultAppliedLateMinutes(day)),
            earlyLeave: minutesToHourInput(
              day.authorization?.adjustedEarlyLeaveMinutes ?? day.earlyLeaveMinutes ?? 0,
            ),
            note: note || (selectedAdditionalApprovalMode === "planned"
              ? "Se mantiene el tiempo planificado."
              : "Excedente autorizado."),
            additionalResolved: true,
            decision,
          }
          : {
            ...quickActionDraft(day, decision, {}),
            note: note || "Atraso revisado, se conserva el descuento detectado.",
            lateResolved: true,
            decision,
          };
        const response = await fetch("/api/planner/attendance/day-decisions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(authorizationPayloadForDay(employeeId, day, decision, draft)),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudieron guardar los días seleccionados.");
        }
      }

      setPendingSelectedLateAction("");
      setSelectedLateNote("");
      setSelectedAdditionalApprovalMode("all");
      setSelectedAdditionalApprovalMax("");
      setSelectedLateDayKeys([]);
      await loadReport(month);
      showNotice(
        "success",
        pendingSelectedLateAction === "approve_additional"
          ? `Tiempo adicional resuelto en ${selectedDayCount} ${selectedDayCount === 1 ? "día" : "días"}.`
          : `Decisión guardada en ${selectedDayCount} ${selectedDayCount === 1 ? "día" : "días"}.`,
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingBulkAction("");
    }
  }

  useEffect(() => {
    loadReport(initialFiltersRef.current.month);
  }, [loadReport]);

  useEffect(() => () => {
    clearNoticeTimers();
  }, [clearNoticeTimers]);

  return (
    <section className={styles.panel}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />

      {error ? (
        <div className={styles.errorBox}>
          <AlertTriangle size={17} />
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className={styles.loadingScene} aria-hidden="true">
          <span className={styles.skeletonTitle} />
          {Array.from({ length: 10 }).map((_, index) => <span key={index} className={styles.skeletonRow} />)}
        </div>
      ) : row ? (
        <>
          <div className={styles.identityPanel}>
            <div className={styles.employeeIdentity}>
              <strong>{row.employee.fullName}</strong>
              <div className={styles.identityMeta}>
                <span>{row.employee.branchName}</span>
                <span>{row.employee.areaName}</span>
                <span>{row.employee.roleName}</span>
              </div>
            </div>

            <label className={styles.monthControl}>
              <span>Mes</span>
              <input type="month" value={month} onChange={(event) => handleMonthChange(event.target.value)} disabled={isLoading} />
            </label>
          </div>

          <div className={styles.metricGrid}>
            <article className={styles.salaryMetric}>
              <span>Sueldo</span>
              <strong>{row.summary.salaryRealLabel}</strong>
              <small>Base {row.summary.salaryExpectedLabel}</small>
            </article>
            <article>
              <span>Laborales</span>
              <strong>{minutesBadge(row.summary.regularWorkedLabel)}</strong>
              <small>Planificadas {minutesBadge(row.summary.plannedRegularLabel)}</small>
            </article>
            <article>
              <span>Suplementarias</span>
              <strong>{minutesBadge(row.summary.supplementaryLabel)}</strong>
              <small>Planificadas {minutesBadge(row.summary.plannedSupplementaryLabel)}</small>
            </article>
            <article>
              <span>Extraordinarias</span>
              <strong>{minutesBadge(row.summary.extraordinaryLabel)}</strong>
              <small>Planificadas {minutesBadge(row.summary.plannedExtraordinaryLabel)}</small>
            </article>
            <article className={styles.potentialExtraMetric}>
              <span>Tiempo adicional posible</span>
              <strong>{minutesBadge(row.summary.potentialExtraLabel)}</strong>
            </article>
            <article>
              <span>Tiempo no cumplido</span>
              <strong>{minutesBadge(formatMinutes(monthlyUnfulfilledMinutes))}</strong>
              <small>{monthlyUnfulfilledDays} días con diferencias</small>
            </article>
          </div>

          <div className={styles.bulkActions}>
            <div className={styles.reviewFilters}>
              <button
                type="button"
                className={`${styles.issueDaysToggle} ${styles.issueDaysToggleAll} ${!showOnlyIssueDays && !showOnlyLateDays && !showOnlyAdditionalDays ? styles.issueDaysToggleAllActive : ""}`}
                onClick={showAllDays}
                aria-pressed={!showOnlyIssueDays && !showOnlyLateDays && !showOnlyAdditionalDays}
              >
                Todos
                <span>{row?.days?.length || 0}</span>
              </button>
              <button
                type="button"
                className={`${styles.issueDaysToggle} ${styles.issueDaysToggleAlerts} ${showOnlyIssueDays ? styles.issueDaysToggleAlertsActive : ""}`}
                onClick={toggleOnlyIssueDays}
                aria-pressed={showOnlyIssueDays}
              >
                Alertas
                <span>{reviewableIssueDays.length}</span>
              </button>
              <button
                type="button"
                className={`${styles.issueDaysToggle} ${styles.issueDaysToggleLate} ${showOnlyLateDays ? styles.issueDaysToggleLateActive : ""}`}
                onClick={toggleOnlyLateDays}
                aria-pressed={showOnlyLateDays}
              >
                Faltantes
                <span>{lateIssueDays.length}</span>
              </button>
              <button
                type="button"
                className={`${styles.issueDaysToggle} ${styles.issueDaysToggleAdditional} ${showOnlyAdditionalDays ? styles.issueDaysToggleAdditionalActive : ""}`}
                onClick={toggleOnlyAdditionalDays}
                aria-pressed={showOnlyAdditionalDays}
              >
                Tiempo adicional
                <span>{additionalIssueDays.length}</span>
              </button>
            </div>
          </div>

          {showOnlyLateDays || showOnlyAdditionalDays ? (
            <div className={styles.selectionActions}>
              <div className={styles.selectionSummaryGroup}>
                <label className={styles.masterSelection} title={allVisibleLateDaysSelected ? "Quitar selección" : showOnlyAdditionalDays ? "Seleccionar tiempo adicional" : "Seleccionar todos los faltantes"}>
                  <input
                    type="checkbox"
                    checked={allVisibleLateDaysSelected}
                    onChange={toggleVisibleLateDaySelection}
                    disabled={!selectableReviewDays.length || Boolean(savingBulkAction)}
                    aria-label={allVisibleLateDaysSelected ? "Quitar selección visible" : showOnlyAdditionalDays ? "Seleccionar tiempo adicional visible" : "Seleccionar faltantes visibles"}
                  />
                  <span aria-hidden="true" />
                </label>
                <div className={styles.selectionSummary}>
                  <span>{selectedLateDays.length}/{selectableReviewDays.length}</span>
                </div>
              </div>
              <div className={styles.selectionToolbar}>
                {showOnlyAdditionalDays ? (
                  <button
                    type="button"
                    className={`${styles.toolbarButton} ${styles.toolbarButtonPrimary}`}
                    onClick={() => openSelectedLateDecision("approve_additional")}
                    disabled={!selectedLateDays.length || Boolean(savingBulkAction)}
                  >
                    <ToolButtonLabel Icon={CircleCheck} label="Aprobar adicional" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`${styles.toolbarButton} ${styles.toolbarButtonPrimary}`}
                      onClick={() => openSelectedLateDecision("justify_late")}
                      disabled={!selectedLateDays.length || Boolean(savingBulkAction)}
                    >
                      <ToolButtonLabel Icon={ShieldCheck} label="Justificar" />
                    </button>
                    <button
                      type="button"
                      className={styles.toolbarButton}
                      onClick={() => openSelectedLateDecision("resolve_late")}
                      disabled={!selectedLateDays.length || Boolean(savingBulkAction)}
                    >
                      <ToolButtonLabel Icon={ClipboardCheck} label="Marcar revisados" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : null}

          <div className={styles.weekBlocks}>
            {visibleWeekGroups.map((week) => {
              const totals = weeklyComparisonTotals(week.days, row.summary);
              const registeredTotalAmount = totals.detectedHsAmount + totals.detectedHeAmount;
              const plannedTotalAmount = totals.plannedHsAmount + totals.plannedHeAmount;

              return (
                <section key={week.key} className={styles.weekBlock}>
                  <div className={styles.weekBlockHeader}>
                    <strong>{week.label}</strong>
                    <span>{week.rangeLabel}</span>
                  </div>

                  <div className={styles.tableScroller}>
                    <table className={showOnlyLateDays || showOnlyAdditionalDays ? styles.tableWithSelection : undefined}>
                      <thead>
                        <tr>
                          {showOnlyLateDays || showOnlyAdditionalDays ? (
                            <th className={styles.selectionColumn} aria-label="Seleccionar" />
                          ) : null}
                          <th>Día</th>
                          <th>Horario y picadas</th>
                          <th>Planificado</th>
                          <th>Trabajado</th>
                          <th>Tiempo no cumplido</th>
                          <th>Adicional / valor</th>
                          <th>Avisos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {week.days.map((day, dayIndex) => (
                          <Fragment key={day.dateKey}>
                            {isFirstWeekendDay(week.days, dayIndex) ? (
                              <tr className={styles.weekendSeparatorRow}>
                                <td colSpan={showOnlyLateDays || showOnlyAdditionalDays ? 8 : 7}>
                                  <span>Fin de semana</span>
                                </td>
                              </tr>
                            ) : null}
                            <tr
                              className={dayRowClass(day)}
                              onClick={() => openDayDecision(day)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  openDayDecision(day);
                                }
                              }}
                              tabIndex={canOpenDayDecision(day) ? 0 : undefined}
                              role={canOpenDayDecision(day) ? "button" : undefined}
                            >
                              {showOnlyLateDays || showOnlyAdditionalDays ? (
                                <td className={styles.selectionColumn}>
                                  {(showOnlyAdditionalDays ? hasAdditionalDayAlert(day) : hasLateDayAlert(day)) ? (
                                    <label
                                      className={`${styles.daySelection} ${selectedLateDayKeys.includes(day.dateKey) ? styles.daySelectionActive : ""}`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                      }}
                                      onKeyDown={(event) => event.stopPropagation()}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedLateDayKeys.includes(day.dateKey)}
                                        onChange={() => toggleLateDaySelection(day.dateKey)}
                                        aria-label={`Seleccionar ${showOnlyAdditionalDays ? "tiempo adicional" : "faltante"} de ${day.dayLabel} ${day.dateLabel}`}
                                      />
                                      <span aria-hidden="true" />
                                    </label>
                                  ) : null}
                                </td>
                              ) : null}
                              <td>
                                <strong>{day.dayLabel}</strong>
                                <span>{day.dateLabel}</span>
                                {isExtraPlannedDay(day) ? (
                                  <div className={styles.dayBadges}>
                                    <small className={styles.extraDayBadge}>Día extra</small>
                                  </div>
                                ) : null}
                              </td>
                              <td>
                                <div className={styles.timelineCell}>
                                  <div className={styles.scheduleLine}>
                                    <span>{displayScheduleLabel(day, templates)}</span>
                                  </div>
                                  <div className={styles.punchLine}>
                                    {activePunchesForDisplay(day).length
                                      ? activePunchesForDisplay(day).map((punch, index) => (
                                        <span
                                          key={punch.id}
                                          className={punchChipClass(day, index, punch)}
                                          title={punch.source === "manual"
                                            ? "Picada registrada manualmente"
                                            : punch.adjustedFrom
                                              ? `Picada real: ${punch.adjustedFrom}`
                                              : undefined}
                                        >
                                          <small>{punchDisplayLabelForDay(day, punch)} </small>
                                          {punch.time}
                                        </span>
                                      ))
                                      : <span><small>Picadas </small>Sin registros</span>}
                                  </div>
                                </div>
                              </td>
                              <td>
                                <strong>{plannedColumnLabel(day, templates)}</strong>
                              </td>
                              <td>
                                <strong>{isIgnorableRestDay(day) ? "--" : day.workedLabel}</strong>
                              </td>
                              <td>
                                {hasPlannedStart(day) ? (
                                  <>
                                    <strong>{attendanceDelayMinutes(day) ? formatMinutes(attendanceDelayMinutes(day)) : "--"}</strong>
                                    {attendanceDelayParts(day).length > 1
                                      ? attendanceDelayParts(day).map((part) => (
                                        <span key={part.label}>{part.label} {formatMinutes(part.minutes)}</span>
                                      ))
                                      : null}
                                  </>
                                ) : (
                                  <strong>--</strong>
                                )}
                              </td>
                              <td>
                                {isIgnorableRestDay(day) ? (
                                  <strong>--</strong>
                                ) : (
                                  <div className={styles.additionalValueList}>
                                    {additionalValueRows(day, row.summary).map((item) => (
                                      <div
                                        key={item.label}
                                        className={item.approved
                                          ? styles.approvedAdditionalValue
                                          : item.registered
                                            ? styles.registeredAdditionalValue
                                            : undefined}
                                      >
                                        <span>{item.label}</span>
                                        <strong>{item.minutesLabel}</strong>
                                        <small>{item.amountLabel}</small>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td>
                                {visibleDayTags(day).length ? (
                                  <div className={styles.issueTags}>
                                    {visibleDayTags(day).map((tag) => <span key={tag} className={issueTagClass(tag)}>{issueTagLabel(tag)}</span>)}
                                  </div>
                                ) : (
                                  <span className={styles.emptyIssue}>--</span>
                                )}
                              </td>
                            </tr>
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className={styles.weekTotalPanel}>
                    <div className={styles.weekTotalTitle}>
                      <strong>Total semana</strong>
                      <span>{week.rangeLabel}</span>
                    </div>
                    <div className={styles.weekTotalMetrics}>
                      <span>
                        <small>Laborables</small>
                        <div className={styles.weekTotalMetricRows}>
                          <div>
                            <em>Plan.</em>
                            <b>{formatMinutes(totals.plannedMinutes)}</b>
                          </div>
                          <div className={styles.weekTotalCurrentValue}>
                            <em>Det.</em>
                            <strong>{formatMinutes(totals.laborMinutes)}</strong>
                          </div>
                        </div>
                      </span>
                      <span>
                        <small>HS</small>
                        <div className={styles.weekTotalMetricRows}>
                          <div>
                            <em>Plan.</em>
                            <b>{formatMinutes(totals.plannedHsMinutes)}</b>
                          </div>
                          <div className={styles.weekTotalCurrentValue}>
                            <em>Det.</em>
                            <strong>{formatMinutes(totals.detectedHsMinutes)}</strong>
                          </div>
                        </div>
                      </span>
                      <span>
                        <small>HE</small>
                        <div className={styles.weekTotalMetricRows}>
                          <div>
                            <em>Plan.</em>
                            <b>{formatMinutes(totals.plannedHeMinutes)}</b>
                          </div>
                          <div className={styles.weekTotalCurrentValue}>
                            <em>Det.</em>
                            <strong>{formatMinutes(totals.detectedHeMinutes)}</strong>
                          </div>
                        </div>
                      </span>
                      <span>
                        <small>Total HS</small>
                        <div className={styles.weekTotalMetricRows}>
                          <div>
                            <em>Plan.</em>
                            <b>{moneyLabel(totals.plannedHsAmount)}</b>
                          </div>
                          <div className={styles.weekTotalCurrentValue}>
                            <em>Det.</em>
                            <strong>{moneyLabel(totals.detectedHsAmount)}</strong>
                          </div>
                        </div>
                      </span>
                      <span>
                        <small>Total HE</small>
                        <div className={styles.weekTotalMetricRows}>
                          <div>
                            <em>Plan.</em>
                            <b>{moneyLabel(totals.plannedHeAmount)}</b>
                          </div>
                          <div className={styles.weekTotalCurrentValue}>
                            <em>Det.</em>
                            <strong>{moneyLabel(totals.detectedHeAmount)}</strong>
                          </div>
                        </div>
                      </span>
                      <span className={styles.weekTotalGrand}>
                        <small>Total</small>
                        <div className={styles.weekTotalMetricRows}>
                          <div>
                            <em>Plan.</em>
                            <b>{moneyLabel(plannedTotalAmount)}</b>
                          </div>
                          <div className={styles.weekTotalCurrentValue}>
                            <em>Det.</em>
                            <strong>{moneyLabel(registeredTotalAmount)}</strong>
                          </div>
                        </div>
                      </span>
                    </div>
                  </div>
                </section>
              );
            })}
            {!visibleWeekGroups.length ? (
              <div className={styles.emptyFilteredDays}>
                No hay días para los filtros seleccionados.
              </div>
            ) : null}
          </div>

          <CatalogDrawer
            isOpen={Boolean(selectedDay)}
            title={selectedDay ? `${selectedDay.dayLabel} ${selectedDay.dateLabel}` : "Decisión del día"}
            eyebrow="Autorización de horas"
            onClose={closeDayDecision}
          >
            {selectedDay ? (
              <div className={`${styles.decisionModal} ${isSavingPunch ? styles.decisionModalPending : ""}`}>
                {isSavingPunch ? (
                  <div className={styles.decisionLoadingOverlay} aria-live="polite">
                    <RefreshCw size={18} />
                    <span>Actualizando picadas...</span>
                  </div>
                ) : null}
                <div className={styles.decisionSummary}>
                  <article>
                    <span>Trabajado</span>
                    <strong>{selectedDay.workedLabel}</strong>
                  </article>
                  <article>
                    <span>{selectedPreview?.additionalKindLabel || "HS"} planificadas</span>
                    <strong>{selectedPreview?.plannedAdditionalLabel || "--"}</strong>
                    <small>{selectedPreview?.plannedAmountLabel || "$0.00"}</small>
                  </article>
                  <article>
                    <span>{selectedPreview?.additionalKindLabel || "HS"} detectadas</span>
                    <strong>{selectedPreview?.detectedAdditionalLabel || "--"}</strong>
                    <small>{selectedPreview?.detectedAmountLabel || "$0.00"}</small>
                  </article>
                </div>

                {selectedPreview?.breakdown?.length ? (
                  <div className={styles.previewBreakdown}>
                    {selectedPreview.breakdown.map((item) => (
                      <div key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.valueLabel}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className={styles.modalPunches}>
                  {selectedDay.punches.map((punch) => (
                    <button
                      key={punch.id}
                      type="button"
                      className={`${styles.punchChipButton} ${punch.adjustedFrom ? styles.punchChipAdjusted : ""} ${punch.source === "manual" ? styles.punchChipManual : ""} ${punch.isIgnored ? styles.punchChipIgnored : ""} ${punch.isPermissionPunch ? styles.punchChipPermission : ""}`}
                      onClick={() => openDeletePunch(selectedDay, punch)}
                      disabled={selectedIsReviewed || punch.isIgnored || punch.isPermissionPunch || isSavingPunch || savingDay === selectedDay.dateKey}
                      title={punch.isPermissionPunch
                        ? "Picada vinculada a un permiso de salida y retorno."
                        : punch.isIgnored
                        ? `Picada anulada: ${punch.ignoredReason || "sin motivo"}`
                        : punch.source === "manual"
                          ? "Picada manual. Selecciona para anularla."
                          : punch.adjustedFrom
                            ? `Picada real: ${punch.adjustedFrom}`
                            : "Anular picada"}
                      aria-label={punch.isIgnored
                        ? `Picada anulada a las ${punch.time}`
                        : `${punch.source === "manual" ? "Picada manual" : "Picada"} a las ${punch.time}. Selecciona para anularla.`}
                    >
                      <small>{punchDisplayLabelForDay(selectedDay, punch)}</small>
                      <span className={styles.punchChipTime}>{punch.time}</span>
                      {punch.adjustedFrom ? (
                        <span className={styles.punchChipMeta}>Real {punch.adjustedFrom}</span>
                      ) : null}
                      {punch.isPermissionPunch ? (
                        <span className={styles.punchChipMeta}>Permiso</span>
                      ) : null}
                      <span className={styles.punchDeleteOverlay} aria-hidden="true">
                        <Ban size={14} />
                      </span>
                    </button>
                  ))}
                </div>

                {selectedHasQuickActions || selectedCanAuthorizeManualAdditional ? (
                  <div className="catalog-actions-block catalog-actions-separated">
                    <div className={styles.quickActionGrid}>
                      {selectedCanAuthorizeManualAdditional ? (
                        <button
                          type="button"
                          className="catalog-button-ghost"
                          onClick={() => openManualAdditionalApproval(selectedDay)}
                          disabled={isSavingManualAdditional}
                        >
                          {(Number(selectedDay.authorization?.manualSupplementaryMinutes) || 0) > 0
                            || (Number(selectedDay.authorization?.manualExtraordinaryMinutes) || 0) > 0
                            ? "Modificar adicional manual"
                            : "Aprobar tiempo adicional"}
                        </button>
                      ) : null}
                      {selectedHasOnlyAdditionalTime ? (
                        <button
                          type="button"
                          className="catalog-button-ghost"
                          onClick={() => openAdditionalApproval(selectedDay)}
                          disabled={savingDay === selectedDay.dateKey}
                        >
                          Autorizar excedente
                        </button>
                      ) : null}
                      {selectedHasCleanableAlert ? (
                        <button
                          type="button"
                          className="catalog-button-ghost"
                          onClick={() => openInlineException(selectedDay)}
                          disabled={isSavingException}
                        >
                          Crear excepción
                        </button>
                      ) : null}
                      {hasNoSchedulePunches(selectedDay) || selectedCanDiscountPlannedDay ? (
                        <button
                          type="button"
                          className="catalog-button-ghost"
                          onClick={() => applyQuickAction(selectedDay, "discount_day")}
                          disabled={savingDay === selectedDay.dateKey}
                        >
                          {selectedCanDiscountPlannedDay ? "No trabajado" : "Anular día"}
                        </button>
                      ) : null}
                      {selectedHasLateStage ? (
                        <>
                          <button
                            type="button"
                            className="catalog-button-ghost"
                            onClick={() => openInlineException(selectedDay, "schedule_change")}
                            disabled={isSavingException}
                          >
                            Cambiar horario
                          </button>
                          <button
                            type="button"
                            className="catalog-button-ghost"
                            onClick={() => applyQuickAction(selectedDay, "resolve_late")}
                            disabled={savingDay === selectedDay.dateKey}
                          >
                            Marcar revisado
                          </button>
                          <button
                            type="button"
                            className="catalog-button-ghost"
                            onClick={() => applyQuickAction(selectedDay, "justify_late")}
                            disabled={savingDay === selectedDay.dateKey}
                          >
                            Justificar atraso
                          </button>
                        </>
                      ) : null}
                      {selectedCanUsePlannedDay ? (
                        <button
                          type="button"
                          className="catalog-button-ghost"
                          onClick={() => applyQuickAction(selectedDay, selectedPlannedDayDecision)}
                          disabled={savingDay === selectedDay.dateKey}
                        >
                          Ajustar al planificado
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <section className={styles.decisionHistory} aria-labelledby="decision-history-title">
                  <div className={styles.decisionHistoryHeader}>
                    <div>
                      <History size={17} aria-hidden="true" />
                      <strong id="decision-history-title">Historial de decisiones</strong>
                    </div>
                    <small>Las decisiones desactivadas se conservan de forma inmutable para auditoría.</small>
                  </div>

                  {isLoadingDecisionHistory ? (
                    <div className={styles.decisionHistoryEmpty}>Cargando historial...</div>
                  ) : decisionHistory.length ? (
                    <div className={styles.decisionHistoryList}>
                      {decisionHistory.map((item) => (
                        <article key={item.id} className={styles.decisionHistoryItem}>
                          <div className={styles.decisionHistoryItemHeader}>
                            <div>
                              <strong>{item.title}</strong>
                              <span className={`${styles.decisionHistoryStatus} ${
                                item.status === "active"
                                  ? styles.decisionHistoryStatusActive
                                  : item.status === "deleted"
                                    ? styles.decisionHistoryStatusDeleted
                                    : styles.decisionHistoryStatusReplaced
                              }`}>{item.statusLabel}</span>
                            </div>
                            <div className={styles.decisionHistoryActions}>
                              {item.canDelete ? (
                                <button
                                  type="button"
                                  className={styles.decisionHistoryDeactivate}
                                  onClick={() => setPendingHistoryDelete({ item, mode: "deactivate" })}
                                  disabled={Boolean(deletingHistoryId)}
                                  aria-label={`Desactivar ${item.title}`}
                                  title="Desactivar y conservar en el historial"
                                >
                                  <Ban size={15} aria-hidden="true" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <p>{item.summary}</p>
                          {item.note ? <blockquote>{item.note}</blockquote> : null}
                          {item.dependencyMessage ? <small>{item.dependencyMessage}</small> : null}
                          <small>{item.actor} · {formatDecisionTimestamp(item.happenedAt)}</small>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.decisionHistoryEmpty}>Todavía no hay decisiones registradas para este día.</div>
                  )}
                </section>
              </div>
            ) : null}
          </CatalogDrawer>

          <ConfirmDialog
            isOpen={Boolean(pendingHistoryDelete)}
            title="Desactivar esta decisión"
            message={pendingHistoryDelete
              ? `${pendingHistoryDelete.item.title}. La decisión dejará de estar activa y permanecerá visible en el historial para auditoría.`
              : ""}
            confirmLabel="Desactivar decisión"
            cancelLabel="Cancelar"
            tone="danger"
            isPending={Boolean(deletingHistoryId)}
            onConfirm={deleteHistoryDecision}
            onCancel={() => {
              if (!deletingHistoryId) setPendingHistoryDelete(null);
            }}
          />

          <ConfirmDialog
            isOpen={Boolean(pendingAdditionalApproval)}
            title={pendingAdditionalApproval?.isEdit ? "Modificar excedente autorizado" : "Autorizar excedente"}
            message={selectedDay ? `${selectedDay.dayLabel} ${selectedDay.dateLabel}` : ""}
            confirmLabel={pendingAdditionalApproval?.approvalMode === "planned"
                ? "Mantener lo planificado"
              : pendingAdditionalApproval?.isEdit
                ? "Guardar autorización"
                : "Autorizar excedente"}
            cancelLabel="Cancelar"
            tone="default"
            isPending={Boolean(savingDay)}
            confirmDisabled={
              !pendingAdditionalApproval ||
              (
                pendingAdditionalApproval.approvalMode === "custom" &&
                (
                  hourInputToMinutes(pendingAdditionalApproval.minutes) <= 0 ||
                  hourInputToMinutes(pendingAdditionalApproval.minutes) > (pendingAdditionalApproval.maximumExcessMinutes || 0)
                )
              ) ||
              (
                pendingAdditionalApproval.approvalMode === "planned" &&
                (pendingAdditionalApproval.plannedMinutes || 0) <= 0
              )
            }
            onCancel={() => {
              if (!savingDay) setPendingAdditionalApproval(null);
            }}
            onConfirm={saveAdditionalApproval}
          >
            {pendingAdditionalApproval && selectedDay ? (
              <div className={styles.inlineExceptionForm}>
                <div className={styles.confirmDetails}>
                  <span>Empleado</span>
                  <strong>{row.employee.fullName}</strong>
                  <span>Tipo</span>
                  <strong>{additionalKindLabel(selectedDay, true)}</strong>
                  <span>Detectado</span>
                  <strong>{formatMinutes(pendingAdditionalApproval.detectedMinutes)}</strong>
                  {pendingAdditionalApproval.plannedMinutes > 0 ? (
                    <>
                      <span>Planificado</span>
                      <strong>{formatMinutes(pendingAdditionalApproval.plannedMinutes)}</strong>
                    </>
                  ) : null}
                </div>
                <div className={styles.approvalModeGroup}>
                  {pendingAdditionalApproval.plannedMinutes > 0 ? (
                    <label>
                      <input
                        type="radio"
                        name="day-additional-approval-mode"
                        checked={pendingAdditionalApproval.approvalMode === "planned"}
                        onChange={() => selectAdditionalApprovalMode("planned")}
                      />
                      <span>Mantener solo lo planificado ({formatMinutes(pendingAdditionalApproval.plannedMinutes)})</span>
                    </label>
                  ) : null}
                  <label>
                    <input
                      type="radio"
                      name="day-additional-approval-mode"
                      checked={pendingAdditionalApproval.approvalMode === "custom"}
                      onChange={() => selectAdditionalApprovalMode("custom")}
                    />
                    <span>Autorizar una parte del excedente</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="day-additional-approval-mode"
                      checked={pendingAdditionalApproval.approvalMode === "all"}
                      onChange={() => selectAdditionalApprovalMode("all")}
                    />
                    <span>Autorizar todo el excedente ({formatMinutes(pendingAdditionalApproval.maximumExcessMinutes)})</span>
                  </label>
                </div>
                {pendingAdditionalApproval.approvalMode === "custom" ? (
                  <label className={styles.bulkNoteField}>
                    <span>Minutos del excedente a autorizar</span>
                    <input
                      type="number"
                      min="1"
                      max={pendingAdditionalApproval.maximumExcessMinutes}
                      value={pendingAdditionalApproval.minutes}
                      onChange={(event) => updateAdditionalApproval("minutes", event.target.value)}
                      placeholder="Minutos"
                    />
                  </label>
                ) : null}
                <label className={styles.bulkNoteField}>
                  <span>Nota</span>
                  <textarea
                    rows={3}
                    value={pendingAdditionalApproval.note}
                    onChange={(event) => updateAdditionalApproval("note", event.target.value)}
                    placeholder="Ej. Tiempo adicional autorizado por cierre de caja."
                  />
                </label>
              </div>
            ) : null}
          </ConfirmDialog>

          <ConfirmDialog
            isOpen={Boolean(pendingManualAdditionalApproval)}
            title={pendingManualAdditionalApproval?.isEdit
              ? "Modificar tiempo adicional"
              : "Aprobar tiempo adicional"}
            message={selectedDay ? `${selectedDay.dayLabel} ${selectedDay.dateLabel}` : ""}
            confirmLabel={pendingManualAdditionalApproval?.isEdit ? "Guardar cambios" : "Aprobar tiempo"}
            cancelLabel="Cancelar"
            tone="default"
            isPending={isSavingManualAdditional}
            confirmDisabled={
              !pendingManualAdditionalApproval
              || hourInputToMinutes(pendingManualAdditionalApproval.minutes) <= 0
              || hourInputToMinutes(pendingManualAdditionalApproval.minutes) > 1440
              || !String(pendingManualAdditionalApproval.reason || "").trim()
            }
            onCancel={() => {
              if (!isSavingManualAdditional) setPendingManualAdditionalApproval(null);
            }}
            onConfirm={saveManualAdditionalApproval}
          >
            {pendingManualAdditionalApproval ? (
              <div className={styles.inlineExceptionForm}>
                <label className={styles.bulkNoteField}>
                  <span>Tiempo adicional (minutos)</span>
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={pendingManualAdditionalApproval.minutes}
                    onChange={(event) => updateManualAdditionalApproval("minutes", event.target.value)}
                    placeholder="Ej. 60"
                  />
                  {hourInputToMinutes(pendingManualAdditionalApproval.minutes) > 0 ? (
                    <small>Equivale a {formatMinutes(hourInputToMinutes(pendingManualAdditionalApproval.minutes))}.</small>
                  ) : null}
                </label>
                <label className={styles.bulkNoteField}>
                  <span>Motivo</span>
                  <textarea
                    rows={3}
                    value={pendingManualAdditionalApproval.reason}
                    onChange={(event) => updateManualAdditionalApproval("reason", event.target.value)}
                    placeholder="Ej. Regresó fuera del horario para atender una situación especial."
                  />
                </label>
              </div>
            ) : null}
          </ConfirmDialog>

          <ConfirmDialog
            isOpen={Boolean(pendingSelectedLateAction)}
            title={pendingSelectedLateAction === "approve_additional"
              ? "Aprobar tiempo adicional"
              : pendingSelectedLateAction === "justify_late"
                ? "Justificar atrasos seleccionados"
                : "Marcar atrasos revisados"}
            message={pendingSelectedLateAction === "justify_late"
              ? "Se guardará la misma justificación en los días seleccionados y el atraso dejará de quedar pendiente."
              : pendingSelectedLateAction === "approve_additional"
                ? "Solo se actualizarán los días seleccionados. Los días aprobados por completo saldrán del filtro de tiempo adicional."
              : "Los atrasos seleccionados quedarán revisados, pero se conservarán los minutos para descuento."}
            confirmLabel={pendingSelectedLateAction === "approve_additional"
              ? "Aprobar adicional"
              : pendingSelectedLateAction === "justify_late"
                ? "Justificar seleccionados"
                : "Marcar revisados"}
            cancelLabel="Cancelar"
            tone="default"
            isPending={Boolean(savingBulkAction)}
            confirmDisabled={
              !selectedLateDays.length ||
              (pendingSelectedLateAction === "justify_late" && String(selectedLateNote || "").trim().length < 4) ||
              (
                pendingSelectedLateAction === "approve_additional" &&
                selectedAdditionalApprovalMode === "max" &&
                hourInputToMinutes(selectedAdditionalApprovalMax) <= 0
              )
            }
            onCancel={closeSelectedLateDecision}
            onConfirm={saveSelectedLateDecision}
          >
            <div className={styles.confirmDetails}>
              <span>Empleado</span>
              <strong>{row.employee.fullName}</strong>
              <span>Días</span>
              <strong>{selectedLateDays.length} seleccionados</strong>
              {pendingSelectedLateAction === "approve_additional" ? (
                <>
                  <span>Detectado</span>
                  <strong>{formatMinutes(selectedAdditionalDetectedTotal)}</strong>
                </>
              ) : null}
              <span>Acción</span>
              <strong>{pendingSelectedLateAction === "approve_additional"
                ? selectedAdditionalApprovalMode === "max"
                  ? `Autorizar máximo ${formatMinutes(hourInputToMinutes(selectedAdditionalApprovalMax))} del excedente por día`
                  : selectedAdditionalApprovalMode === "planned"
                    ? "Mantener lo planificado por día"
                  : "Autorizar todo el excedente"
                : pendingSelectedLateAction === "justify_late"
                  ? "Atraso justificado"
                  : "Atraso revisado con descuento"}</strong>
            </div>
            {pendingSelectedLateAction === "approve_additional" ? (
              <div className={styles.inlineExceptionForm}>
                <div className={styles.approvalModeGroup}>
                  <label>
                    <input
                      type="radio"
                      name="additional-approval-mode"
                      checked={selectedAdditionalApprovalMode === "all"}
                      onChange={() => setSelectedAdditionalApprovalMode("all")}
                    />
                    <span>Autorizar todo el excedente</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="additional-approval-mode"
                      checked={selectedAdditionalApprovalMode === "planned"}
                      onChange={() => setSelectedAdditionalApprovalMode("planned")}
                    />
                    <span>Mantener lo planificado por día</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="additional-approval-mode"
                      checked={selectedAdditionalApprovalMode === "max"}
                      onChange={() => setSelectedAdditionalApprovalMode("max")}
                    />
                    <span>Autorizar parte del excedente por día</span>
                  </label>
                </div>
                {selectedAdditionalApprovalMode === "max" ? (
                  <label className={styles.bulkNoteField}>
                    <span>Máximo de minutos del excedente por día</span>
                    <input
                      type="number"
                      min="1"
                      value={selectedAdditionalApprovalMax}
                      onChange={(event) => setSelectedAdditionalApprovalMax(event.target.value)}
                      placeholder="Minutos"
                    />
                  </label>
                ) : null}
                <label className={styles.bulkNoteField}>
                  <span>Nota</span>
                  <textarea
                    rows={3}
                    value={selectedLateNote}
                    onChange={(event) => setSelectedLateNote(event.target.value)}
                    placeholder="Ej. Tiempo adicional autorizado por cierre operativo."
                  />
                </label>
              </div>
            ) : null}
            {pendingSelectedLateAction === "justify_late" ? (
              <label className={styles.bulkNoteField}>
                <span>Justificación</span>
                <textarea
                  rows={3}
                  value={selectedLateNote}
                  onChange={(event) => setSelectedLateNote(event.target.value)}
                  placeholder="Ej. Ingreso tardío autorizado por trámite externo."
                />
              </label>
            ) : null}
          </ConfirmDialog>

          <ConfirmDialog
            isOpen={Boolean(exceptionDraft)}
            title="Crear excepción"
            message={exceptionDraft ? `${exceptionDraft.dayLabel} ${exceptionDraft.dateLabel}` : ""}
            confirmLabel={exceptionDraft?.type === "missing_punch" && exceptionDraft?.missingPunchMode === "manual"
              ? (exceptionDraft.manualPunchTimes || []).length > 1
                ? "Registrar picadas"
                : "Registrar picada"
              : "Guardar excepción"}
            cancelLabel="Cancelar"
            tone="default"
            isPending={isSavingException}
            confirmDisabled={!isExceptionDraftValid(exceptionDraft)}
            onCancel={closeInlineException}
            onConfirm={saveInlineException}
          >
            {exceptionDraft ? (
              <div className={styles.inlineExceptionForm}>
                <SelectInput
                  label="Tipo de excepción"
                  value={exceptionDraft.type}
                  onChange={(event) => selectExceptionType(event.target.value)}
                  disabled={exceptionOptions.length <= 1}
                >
                  {exceptionOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </SelectInput>
                <p className={styles.exceptionTypeHint}>
                  {exceptionOptions.find((option) => option.value === exceptionDraft.type)?.description || ""}
                </p>

                {exceptionDraft.type === "schedule_change" ? (
                  <>
                    <SelectInput
                      label="Nueva planificación"
                      value={exceptionDraft.plannedDayType || "workday"}
                      onChange={(event) => updateExceptionDraft("plannedDayType", event.target.value)}
                    >
                      <option value="workday">Horario laboral</option>
                      <option value="off_day">Descanso</option>
                    </SelectInput>
                    {exceptionDraft.plannedDayType === "off_day" ? (
                      <p className={styles.exceptionTypeHint}>
                        El día quedará como descanso y no se exigirán picadas ni horas planificadas.
                      </p>
                    ) : (
                      <>
                        <AutocompleteSelect
                          label="Plantilla de horario"
                          controlClassName={styles.exceptionTemplateControl}
                          value={exceptionDraft.templateId || ""}
                          options={exceptionTemplateOptions.map((option) => ({
                            value: option.id,
                            label: `${option.name}${option.isRecommended ? " (más cercana)" : ""}`,
                            description: scheduleTextsMatch(option.name, option.scheduleLabel)
                              ? ""
                              : option.scheduleLabel,
                            searchText: [option.name, option.scheduleLabel].filter(Boolean).join(" "),
                          }))}
                          placeholder={exceptionTemplateOptions.length ? "Selecciona una plantilla" : "Horario manual"}
                          searchPlaceholder="Buscar plantilla por nombre u horario"
                          emptyText="No encontramos plantillas compatibles"
                          onChange={selectExceptionTemplate}
                        />
                        {!exceptionTemplateOptions.length ? (
                          <p className={styles.exceptionTypeHint}>
                            No hay plantillas compatibles para este empleado. Puedes registrar el horario manualmente.
                          </p>
                        ) : null}
                        <div className={styles.exceptionTimeGrid}>
                          <label>
                            <span>Entrada</span>
                            <TimeInput24
                              value={exceptionDraft.plannedStartTime}
                              separator="H"
                              onChange={(event) => updateExceptionDraft("plannedStartTime", event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Almuerzo sale</span>
                            <TimeInput24
                              value={exceptionDraft.plannedLunchStartTime}
                              separator="H"
                              onChange={(event) => updateExceptionDraft("plannedLunchStartTime", event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Almuerzo vuelve</span>
                            <TimeInput24
                              value={exceptionDraft.plannedLunchEndTime}
                              separator="H"
                              onChange={(event) => updateExceptionDraft("plannedLunchEndTime", event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Salida</span>
                            <TimeInput24
                              value={exceptionDraft.plannedEndTime}
                              separator="H"
                              onChange={(event) => updateExceptionDraft("plannedEndTime", event.target.value)}
                            />
                          </label>
                        </div>
                        {scheduleChangeCreatesExtraPunchLayer ? (
                          <div className={styles.exceptionWarning}>
                            <AlertTriangle size={16} aria-hidden="true" />
                            <span>Este cambio dejará picadas de más. Luego deberás anular las picadas que no aplican.</span>
                          </div>
                        ) : null}
                      </>
                    )}
                  </>
                ) : null}

                {exceptionDraft.type === "extra_day" ? (
                  <p className={styles.exceptionTypeHint}>
                    <strong>Tiempo que se aprobará:</strong>{" "}
                    {exceptionDraft.plannedStartTime || "--"} a {exceptionDraft.plannedEndTime || "--"}
                    {exceptionDraft.plannedLunchStartTime && exceptionDraft.plannedLunchEndTime
                      ? ` · almuerzo ${exceptionDraft.plannedLunchStartTime} a ${exceptionDraft.plannedLunchEndTime}`
                      : ""}
                    {!([2, 4].includes(Number(exceptionDraft.punchCount)))
                      ? " Para usar Día extra deben quedar exactamente 2 o 4 picadas válidas."
                      : ""}
                  </p>
                ) : null}

                {exceptionDraft.type === "missing_punch" ? (
                  <>
                    <SelectInput
                      label="Cómo completar la asistencia"
                      value={exceptionDraft.missingPunchMode || "manual"}
                      onChange={(event) => updateExceptionDraft("missingPunchMode", event.target.value)}
                    >
                      <option value="manual">Registrar picadas manuales</option>
                      <option value="planned">Completar con el horario planificado</option>
                    </SelectInput>

                    {exceptionDraft.missingPunchMode === "manual" ? (
                      <div className={styles.manualPunchPanel}>
                        <p>
                          Estas picadas se identificarán como manuales y la jornada se recalculará con sus horas reales.
                        </p>
                        <div className={styles.manualPunchList}>
                          {(exceptionDraft.manualPunchTimes || [""]).map((manualPunchTime, index) => (
                            <label key={index} className={styles.manualPunchField}>
                              <span>Picada manual {index + 1}</span>
                              <div>
                                <TimeInput24
                                  value={manualPunchTime}
                                  separator="H"
                                  onChange={(event) => updateManualPunchTime(index, event.target.value)}
                                />
                                <button
                                  type="button"
                                  onClick={() => removeManualPunchTime(index)}
                                  disabled={(exceptionDraft.manualPunchTimes || []).length <= 1}
                                  aria-label={`Quitar picada manual ${index + 1}`}
                                  title="Quitar picada"
                                >
                                  <X size={15} />
                                </button>
                              </div>
                            </label>
                          ))}
                        </div>
                        <button
                          type="button"
                          className={styles.addManualPunchButton}
                          onClick={addManualPunchTime}
                          disabled={(exceptionDraft.manualPunchTimes || []).length >= 4}
                        >
                          <Plus size={15} />
                          Agregar otra picada
                        </button>
                      </div>
                    ) : (
                      <label className={styles.exceptionToggle}>
                        <input
                          type="checkbox"
                          checked={exceptionDraft.allowSupplementaryTime}
                          onChange={(event) => updateExceptionDraft("allowSupplementaryTime", event.target.checked)}
                        />
                        <span>Calcular HS/HE usando la primera y última picada</span>
                      </label>
                    )}
                  </>
                ) : null}

                {exceptionDraft.type === "permission_punches" ? (
                  <fieldset className={styles.permissionPunchSelector}>
                    <legend>Selecciona salida y retorno</legend>
                    <p>Las picadas seleccionadas seguirán visibles, pero dejarán de contarse como excedentes.</p>
                    <div>
                      {(selectedDay?.punches || []).map((punch) => {
                        const isSelected = exceptionDraft.permissionPunchIds?.includes(punch.id);
                        const selectionIsFull = (exceptionDraft.permissionPunchIds || []).length >= 2;

                        return (
                          <button
                            key={punch.id}
                            type="button"
                            className={isSelected ? styles.permissionPunchSelected : ""}
                            disabled={!isSelected && selectionIsFull}
                            onClick={() => togglePermissionPunch(punch)}
                          >
                            <span>{punch.time}</span>
                            <small>{punch.isIgnored ? "Anulada" : "Picada registrada"}</small>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                ) : null}

                {["permission", "permission_punches"].includes(exceptionDraft.type) ? (
                  <SelectInput
                    label="Tratamiento del permiso"
                    value={exceptionDraft.permissionPayTreatment}
                    onChange={(event) => updatePermissionPayTreatment(event.target.value)}
                  >
                    <option value="without_discount">Sin descuento de horas</option>
                    <option value="with_discount">Con descuento de horas</option>
                  </SelectInput>
                ) : null}

                {exceptionDraft.type === "permission_punches" && exceptionDraft.permissionPunchIds?.length === 2 ? (
                  <div className={styles.permissionPunchSummary}>
                    <div>
                      <span>Salida seleccionada</span>
                      <strong>{exceptionDraft.startTime}</strong>
                    </div>
                    <div>
                      <span>Retorno seleccionado</span>
                      <strong>{exceptionDraft.endTime}</strong>
                    </div>
                    {exceptionDraft.permissionPayTreatment === "with_discount" ? (
                      <label>
                        <span>Minutos a descontar</span>
                        <input
                          type="number"
                          min="1"
                          max="1440"
                          step="1"
                          value={exceptionDraft.discountMinutes || ""}
                          onChange={(event) => updateExceptionDraft("discountMinutes", event.target.value)}
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}

                {["outside_work", "permission"].includes(exceptionDraft.type) ? (
                  <div className={styles.exceptionTimeGrid}>
                    <label>
                      <span>Desde</span>
                      <TimeInput24
                        value={exceptionDraft.startTime}
                        separator="H"
                        onChange={(event) => updateExceptionDraft("startTime", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Hasta</span>
                      <TimeInput24
                        value={exceptionDraft.endTime}
                        separator="H"
                        onChange={(event) => updateExceptionDraft("endTime", event.target.value)}
                      />
                    </label>
                    {exceptionDraft.type === "outside_work" ? (
                      <label className={styles.exceptionToggle}>
                        <input
                          type="checkbox"
                          checked={exceptionDraft.allowSupplementaryTime}
                          onChange={(event) => updateExceptionDraft("allowSupplementaryTime", event.target.checked)}
                        />
                        <span>Permitir HS/HE si corresponde</span>
                      </label>
                    ) : null}
                  </div>
                ) : null}

                <label className={styles.bulkNoteField}>
                  <span>Justificación</span>
                  <textarea
                    rows={4}
                    value={exceptionDraft.notes}
                    onChange={(event) => updateExceptionDraft("notes", event.target.value)}
                    placeholder="Describe la razón o evidencia de la excepción."
                  />
                </label>
              </div>
            ) : null}
          </ConfirmDialog>

          <ConfirmDialog
            isOpen={Boolean(pendingDeletePunch)}
            title="Anular picada"
            message={pendingDeletePunch
              ? `La picada de las ${pendingDeletePunch.punch.time} del ${pendingDeletePunch.dateLabel} quedará visible, pero no afectará el cálculo.`
              : ""}
            confirmLabel="Anular picada"
            cancelLabel="Cancelar"
            tone="danger"
            isPending={isSavingPunch}
            confirmDisabled={String(pendingDeletePunch?.reason || "").trim().length < 4}
            onCancel={closeDeletePunch}
            onConfirm={deleteSelectedPunch}
          >
            <div className={styles.punchMutationForm}>
              <label className={styles.punchMutationNote}>
                <span>Motivo o nota</span>
                <textarea
                  rows={3}
                  placeholder="Ej. Picada duplicada o registrada por error."
                  value={pendingDeletePunch?.reason || ""}
                  onChange={(event) => updateDeletePunchReason(event.target.value)}
                />
              </label>
            </div>
          </ConfirmDialog>
        </>
      ) : (
        <div className={styles.errorBox}>
          <RefreshCw size={17} />
          No se encontró información para este empleado en el mes seleccionado.
        </div>
      )}
    </section>
  );
}
