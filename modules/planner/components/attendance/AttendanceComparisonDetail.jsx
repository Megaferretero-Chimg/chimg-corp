"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CircleCheck,
  ClipboardCheck,
  History,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import AutocompleteSelect from "@/components/ui/AutocompleteSelect";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import SelectInput from "@/components/ui/SelectInput";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
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
  return String(value || "").replace(":", "H");
}

function formatDecisionTimestamp(value) {
  if (!value) return "Fecha no disponible";

  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Guayaquil",
  }).format(new Date(value));
}

const INLINE_EXCEPTION_OPTIONS = [
  {
    value: "schedule_change",
    label: "Cambiar planificación",
    description: "Autoriza el horario que debía aplicar en este día.",
  },
  {
    value: "missing_punch",
    label: "Picada omitida",
    description: "Reconoce la jornada sin crear una picada ficticia. Puedes decidir si también se calcula el tiempo adicional.",
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
    hours > 23 ||
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
        name: template.name || "Plantilla",
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
  if (punch?.isIgnored) return "ANU";
  return punch?.adjustedFrom ? `${punchLabel(index, punchCount)} AJ` : punchLabel(index, punchCount);
}

function activePunchesForDisplay(day) {
  return (day?.punches || []).filter((punch) => punch?.isIgnored !== true);
}

function punchDisplayLabelForDay(day, punch) {
  if (punch?.isIgnored) return "ANU";

  const activePunches = activePunchesForDisplay(day);
  const activeIndex = activePunches.findIndex((candidate) => candidate.id === punch?.id);

  return punchDisplayLabel(punch, Math.max(0, activeIndex), activePunches.length);
}

function expectedPunchesFromScheduleDraft(draft) {
  if (!draft || draft.type !== "schedule_change" || !draft.plannedStartTime || !draft.plannedEndTime) return 0;

  return draft.plannedLunchStartTime && draft.plannedLunchEndTime ? 4 : 2;
}

function createsExtraPunchLayer(day, draft) {
  const expectedPunches = expectedPunchesFromScheduleDraft(draft);

  return expectedPunches > 0 && activePunchesForDisplay(day).length > expectedPunches;
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

function hasSavedAdditionalApproval(day) {
  if (!hasSavedDayDecision(day) || !hasAuthorizableTime(day)) return false;
  if (!["custom", "full", "planned"].includes(day?.authorization?.decision)) return false;

  return (
    (Number(day?.authorization?.authorizedSupplementaryMinutes) || 0) > 0 ||
    (Number(day?.authorization?.authorizedExtraordinaryMinutes) || 0) > 0
  );
}

function isScheduledExtraDay(day) {
  return day?.dayType === "weekend_overtime";
}

function hasPendingEntryLate(day) {
  if (!hasPlannedStart(day) || day?.plannedScheduleExists === false) return false;

  const entryLateMinutes = Number(day?.entryLateMinutes ?? day?.lateMinutes) || 0;
  const graceMinutes = Number(day?.graceMinutes) || 0;

  return !hasSavedDayDecision(day) && (!isExtraordinaryDay(day) || isScheduledExtraDay(day)) && entryLateMinutes > graceMinutes;
}

function hasPendingLunchOverage(day) {
  if (!hasPlannedStart(day) || day?.plannedScheduleExists === false) return false;

  const plannedLunchMinutes = Number(day?.lunchDiscountMinutes) || Number(day?.lunchDurationMinutes) || 0;
  const actualLunchMinutes = Number(day?.actualLunchMinutes) || 0;
  const graceMinutes = Number(day?.graceMinutes) || 0;

  return !hasSavedDayDecision(day) && plannedLunchMinutes > 0 && actualLunchMinutes - plannedLunchMinutes > graceMinutes;
}

function punchChipClass(day, index) {
  const hasEntryWarning = index === 0 && hasPendingEntryLate(day);
  const hasLunchWarning = [1, 2].includes(index) && hasPendingLunchOverage(day);

  return hasEntryWarning || hasLunchWarning ? styles.punchWarning : undefined;
}

function isIgnorableRestDay(day) {
  return day.dayType === "off_day" && day.punchCount === 0;
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
  const hasSavedAuthorization = Boolean(day?.authorization?.isSaved);

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
  if (day.authorization?.decision === "reviewed") return 0;
  const currentLateMinutes = detectedLateIssueMinutes(day);

  if (day.authorization?.adjustedLateMinutes !== undefined && day.authorization?.adjustedLateMinutes !== null) {
    return Math.min(
      currentLateMinutes,
      Math.max(0, Number(day.authorization.adjustedLateMinutes) || 0),
    );
  }

  return currentLateMinutes;
}

function attendanceDelayMinutes(day) {
  if (!day || isIgnorableRestDay(day)) return 0;
  if (isExtraordinaryDay(day) && !isScheduledExtraDay(day)) return 0;

  const lateMinutes = Math.max(
    0,
    Number(day.lateMinutes) || 0,
    Number(day.authorization?.adjustedLateMinutes) || 0,
    Number(day.authorization?.detectedLateMinutes) || 0,
    (Number(day.entryLateMinutes) || 0) + (Number(day.lunchOverageMinutes ?? day.lunchOverageRemainderMinutes) || 0),
  );
  const earlyLeaveMinutes = Math.max(
    0,
    Number(day.earlyLeaveMinutes) || 0,
    Number(day.authorization?.adjustedEarlyLeaveMinutes) || 0,
    Number(day.authorization?.detectedEarlyLeaveMinutes) || 0,
  );

  return lateMinutes + earlyLeaveMinutes;
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

  return Math.max(
    0,
    Number(day.earlyLeaveMinutes) || 0,
    Number(day.authorization?.adjustedEarlyLeaveMinutes) || 0,
    Number(day.authorization?.detectedEarlyLeaveMinutes) || 0,
  );
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
  return (day.tags || []).some((tag) => [
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
  if (hasSavedDayDecision(day)) {
    const note = String(day?.authorization?.note || "");
    const isAdditionalOnlyDecision = note.startsWith("Tiempo adicional");
    const preservedLateMinutes = Math.max(0, Number(day?.authorization?.adjustedLateMinutes) || 0);
    const preservedEarlyLeaveMinutes = Math.max(0, Number(day?.authorization?.adjustedEarlyLeaveMinutes) || 0);

    if (!isAdditionalOnlyDecision) return false;

    return (
      detectedLateIssueMinutes(day) > preservedLateMinutes ||
      detectedEarlyLeaveIssueMinutes(day) > preservedEarlyLeaveMinutes
    );
  }

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

  if (isIgnorableRestDay(day)) {
    rowClasses.push(styles.ignoredRestRow);
    return rowClasses.join(" ");
  }

  if (canOpenDayDecision(day)) rowClasses.push(styles.actionableRow);
  if (hasOperationalError(day)) rowClasses.push(styles.severeIssueRow);
  else if (
    hasVisibleDayWarning(day) ||
    displayLateMinutes(day) > 0 ||
    (Number(day?.earlyLeaveMinutes) || 0) > 0
  ) rowClasses.push(styles.issueRow);
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
    "Aprobado",
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

function visibleDayTags(day) {
  const rawTags = day.tags || [];
  const hasBlockingAlert = hasOperationalError(day);
  const hasPendingDelay = hasLateDayAlert(day);
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
    .filter((tag) => !hasBlockingAlert || !["Plan no completado", "Tiempo adicional"].includes(tag))
    .filter((tag) => !hasPendingDelay || tag !== "Tiempo adicional");
  const statusLabel = day?.authorization?.statusLabel || "";
  const displayTags = [...new Set(tags)];

  if (day?.dayType === "vacation" && !displayTags.includes("Vacaciones")) {
    displayTags.push("Vacaciones");
  }

  if (hasIncoherentWorkedDay(day) && !displayTags.includes("Jornada incompleta")) {
    displayTags.push("Jornada incompleta");
  }

  if (["Revisado", "No aprobado", "Dia descontado"].includes(statusLabel) && !displayTags.includes(statusLabel)) {
    displayTags.push(statusLabel);
  }

  if (hasSavedAdditionalApproval(day) && !displayTags.includes("Aprobado")) {
    displayTags.push("Aprobado");
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

    const registeredMinutes = registeredAdditionalMinutes(day);
    const plannedHsMinutes = plannedSupplementaryMinutes(day);
    const plannedHeMinutes = plannedExtraordinaryMinutes(day);

    totals.plannedMinutes += plannedRegularMinutes(day);
    totals.workedMinutes += Number(day.workedMinutes) || 0;
    totals.laborMinutes += Number(day.regularWorkedMinutes) || 0;
    totals.issueMinutes += displayLateMinutes(day) + (Number(day.earlyLeaveMinutes) || 0);
    totals.issueCount += visibleDayTags(day).length;

    if (isExtraordinaryDay(day)) {
      totals.plannedHeMinutes += plannedHeMinutes;
      totals.detectedHeMinutes += registeredMinutes;
      totals.plannedHeAmount += additionalAmountValue(plannedHeMinutes, day, summary);
      totals.detectedHeAmount += additionalAmountValue(registeredMinutes, day, summary);
    } else {
      totals.plannedHsMinutes += plannedHsMinutes;
      totals.detectedHsMinutes += registeredMinutes;
      totals.plannedHsAmount += additionalAmountValue(plannedHsMinutes, day, summary);
      totals.detectedHsAmount += additionalAmountValue(registeredMinutes, day, summary);
    }
  });

  return totals;
}

function hasDayTag(day, tag) {
  return (day.tags || []).includes(tag);
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
    return INLINE_EXCEPTION_OPTIONS.filter((option) => option.value === "schedule_change");
  }

  if (hasIncompletePunchTag(day)) {
    return INLINE_EXCEPTION_OPTIONS.filter((option) => ["missing_punch", "schedule_change"].includes(option.value));
  }

  if (hasDayTag(day, "Sin picadas")) {
    return INLINE_EXCEPTION_OPTIONS.filter((option) => option.value === "missing_punch");
  }

  if (displayLateMinutes(day) > 0 || (Number(day?.earlyLeaveMinutes) || 0) > 0) {
    return INLINE_EXCEPTION_OPTIONS.filter((option) => ["permission", "outside_work"].includes(option.value));
  }

  if (hasUnapprovedExtraTime(day)) {
    return INLINE_EXCEPTION_OPTIONS.filter((option) => ["outside_work", "schedule_change"].includes(option.value));
  }

  return INLINE_EXCEPTION_OPTIONS;
}

function hasUnapprovedExtraTime(day) {
  if (day?.authorization?.additionalResolved === true) return false;

  const savedDecision = day?.authorization?.decision || "";
  const onlyResolvedAttendanceIssue = ["reviewed", "resolve_late", "justify_late"].includes(savedDecision);

  if (hasSavedDayDecision(day) && !onlyResolvedAttendanceIssue) return false;

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
  const registeredAdditional = isExtraordinary ? extraordinaryMinutes : supplementaryMinutes;

  return {
    supplementaryLabel: supplementaryMinutes ? formatMinutes(supplementaryMinutes) : "--",
    extraordinaryLabel: extraordinaryMinutes ? formatMinutes(extraordinaryMinutes) : "--",
    additionalLabel: formatMinutes(registeredAdditional),
    plannedAdditionalLabel: formatMinutes(plannedAdditional),
    registeredAdditionalLabel: formatMinutes(registeredAdditional),
    plannedAmountLabel: moneyLabel((plannedAdditional / 60) * calculatePayrollAdditionalRate(hourlyRate, additionalMultiplier)),
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
  const options = inlineExceptionOptionsForDay(day);

  if (options.length) {
    return options[0].value;
  }

  if (hasNoSchedulePunches(day)) return "schedule_change";
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

  return {
    employeeName: row?.employee?.fullName || "",
    dateKey: day?.dateKey || "",
    dateLabel: day?.dateLabel || "",
    dayLabel: day?.dayLabel || "",
    type,
    startTime: ["outside_work", "permission"].includes(type) ? startTime : "",
    endTime: ["outside_work", "permission"].includes(type) ? endTime : "",
    plannedStartTime: type === "schedule_change"
      ? recommendedRow?.startTime || (hasSchedule ? day.startTime : "")
      : "",
    plannedLunchStartTime: type === "schedule_change"
      ? recommendedRow?.lunchStartTime || (hasSchedule ? day?.lunchStartTime || "" : "")
      : "",
    plannedLunchEndTime: type === "schedule_change"
      ? recommendedRow?.lunchEndTime || (hasSchedule ? day?.lunchEndTime || "" : "")
      : "",
    plannedEndTime: type === "schedule_change"
      ? recommendedRow?.endTime || (hasSchedule ? day.endTime : "")
      : "",
    templateId: recommendedTemplate?.id || "",
    allowSupplementaryTime: type === "outside_work",
    notes: exceptionNoteForDay(day),
  };
}

function inlineExceptionPayload(employeeId, draft) {
  const common = {
    planningSource: "attendance_comparison",
    employeeId,
    dateKey: draft.dateKey,
    type: draft.type,
    resolution: draft.type === "schedule_change" ? "reschedule" : "approved_work_time",
    notes: draft.notes,
    autoResolve: true,
  };

  if (draft.type === "schedule_change") {
    return {
      ...common,
      scope: "full_day",
      effect: "planning_change",
      attendanceMode: "use_punches",
      payMode: "no_pay_change",
      plannedStartTime: draft.plannedStartTime,
      plannedLunchStartTime: draft.plannedLunchStartTime,
      plannedLunchEndTime: draft.plannedLunchEndTime,
      plannedEndTime: draft.plannedEndTime,
      applicableWeekdays: [dateFromDateKey(draft.dateKey).getUTCDay()],
    };
  }

  if (draft.type === "missing_punch") {
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

  return {
    ...common,
    scope: "partial_day",
    effect: "paid_partial_leave",
    attendanceMode: "ignore_attendance",
    payMode: "regular_only",
    startTime: draft.startTime,
    endTime: draft.endTime,
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
  const [success, setSuccess] = useState("");
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
  const [decisionHistory, setDecisionHistory] = useState([]);
  const [isLoadingDecisionHistory, setIsLoadingDecisionHistory] = useState(false);
  const [pendingHistoryDelete, setPendingHistoryDelete] = useState(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState("");
  const decisionHistoryRequestRef = useRef(0);

  const filters = {
    ...stableInitialFilters,
    month,
    onlyIssues: showOnlyIssueDays,
    onlyLate: showOnlyLateDays,
    onlyAdditional: showOnlyAdditionalDays,
  };
  const selectedDay = row?.days?.find((day) => day.dateKey === selectedDayKey) || null;
  const exceptionOptions = exceptionDraft ? inlineExceptionOptionsForDay(selectedDay) : [];
  const exceptionTemplateOptions = exceptionDraft?.type === "schedule_change"
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
  const selectedHasExecutionException = Boolean(selectedDay?.executionException?.id);
  const selectedHasSavedAdditionalApproval = hasSavedAdditionalApproval(selectedDay);
  const selectedIsReviewed = selectedDay?.authorization?.decision === "reviewed";
  const selectedDetectedLateMinutes = selectedDay
    ? displayLateMinutes(selectedDay)
    : 0;
  const selectedHasIncompletePunches = selectedDay ? hasIncompletePunchTag(selectedDay) : false;
  const selectedHasCleanableAlert = selectedDay
    ? hasOperationalError(selectedDay) ||
      hasVisibleDayWarning(selectedDay)
    : false;
  const selectedCanDiscountPlannedDay = selectedDay
    ? (hasDayTag(selectedDay, "Sin picadas") || hasIncompletePunchTag(selectedDay)) &&
      activePunchesForDisplay(selectedDay).length === 0
    : false;
  const selectedNeedsExplicitDecision = selectedDay
    ? selectedHasCleanableAlert ||
      hasUnapprovedExtraTime(selectedDay) ||
      selectedDetectedLateMinutes > 0 ||
      (Number(selectedDay.earlyLeaveMinutes) || 0) > 0
    : false;
  const selectedCanUsePlannedDay = selectedDay ? canAdjustAlertToPlanned(selectedDay) : false;
  const selectedHasOnlyAdditionalTime = selectedDay
    ? hasUnapprovedExtraTime(selectedDay) &&
      !selectedHasCleanableAlert &&
      selectedDetectedLateMinutes <= 0 &&
      (Number(selectedDay.earlyLeaveMinutes) || 0) <= 0 &&
      !hasNoSchedulePunches(selectedDay)
    : false;
  const selectedCanAcceptRegisteredExtraDay = selectedDay
    ? isExtraordinaryDay(selectedDay) &&
      plannedAdditionalMinutes(selectedDay) > 0 &&
      detectedAdditionalMinutesForDay(selectedDay) > 0 &&
      (selectedDetectedLateMinutes > 0 || (Number(selectedDay.earlyLeaveMinutes) || 0) > 0) &&
      !selectedHasSavedAdditionalApproval
    : false;
  const selectedPlannedDayDecision = selectedHasIncompletePunches ? "justify_incomplete_punches" : "justify_no_punches";
  const selectedHasReviewFooter = !selectedIsReviewed &&
    !selectedNeedsExplicitDecision &&
    !selectedHasSavedAdditionalApproval &&
    !selectedHasExecutionException;

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
      const response = await fetch(`/api/planner/attendance/decision-history?${params.toString()}`);
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
    setSuccess("");
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
      const requiresTemplate = exceptionTemplateOptions.length > 0;
      return Boolean(
        draft.plannedStartTime &&
        draft.plannedEndTime &&
        (!requiresTemplate || draft.templateId)
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
      setSuccess("");

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
      setSuccess(
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
    const minutes = detectedAdditionalMinutesForDay(day);
    const plannedMinutes = Math.min(minutes, plannedAdditionalMinutes(day));
    const currentApprovedMinutes = isExtraordinaryDay(day)
      ? Number(day?.authorization?.authorizedExtraordinaryMinutes) || 0
      : Number(day?.authorization?.authorizedSupplementaryMinutes) || 0;
    const isEdit = hasSavedDayDecision(day);

    setPendingAdditionalApproval({
      dateKey: day.dateKey,
      minutes: String((isEdit ? currentApprovedMinutes : minutes) || ""),
      detectedMinutes: minutes,
      plannedMinutes,
      approvalMode: isEdit ? "custom" : plannedMinutes > 0 ? "planned" : "all",
      isEdit,
      note: !isEdit && plannedMinutes > 0
        ? "Tiempo adicional aprobado según planificación."
        : "Tiempo adicional aprobado.",
    });
  }

  function updateAdditionalApproval(field, value) {
    setPendingAdditionalApproval((current) => current ? { ...current, [field]: value } : current);
  }

  function selectAdditionalApprovalMode(approvalMode) {
    setPendingAdditionalApproval((current) => {
      if (!current) return current;

      const hasDefaultApprovalNote = !current.note || current.note === "Tiempo adicional aprobado.";
      const hasDefaultRejectionNote = current.note === "Tiempo adicional no aprobado.";
      const hasDefaultPlannedNote = current.note === "Tiempo adicional aprobado según planificación.";

      return {
        ...current,
        approvalMode,
        note: approvalMode === "none" && (hasDefaultApprovalNote || hasDefaultPlannedNote)
          ? "Tiempo adicional no aprobado."
          : approvalMode === "planned" && (hasDefaultApprovalNote || hasDefaultRejectionNote)
            ? "Tiempo adicional aprobado según planificación."
          : !["none", "planned"].includes(approvalMode) && (hasDefaultRejectionNote || hasDefaultPlannedNote)
            ? "Tiempo adicional aprobado."
            : current.note,
      };
    });
  }

  async function saveAdditionalApproval() {
    if (!selectedDay || !pendingAdditionalApproval) return;

    const detectedMinutes = detectedAdditionalMinutesForDay(selectedDay);
    const isRejected = pendingAdditionalApproval.approvalMode === "none";
    const isPlannedOnly = pendingAdditionalApproval.approvalMode === "planned";
    const approvedMinutes = isRejected
      ? 0
      : isPlannedOnly
        ? Math.min(detectedMinutes, pendingAdditionalApproval.plannedMinutes || 0)
      : pendingAdditionalApproval.approvalMode === "all"
        ? detectedMinutes
        : Math.min(detectedMinutes, hourInputToMinutes(pendingAdditionalApproval.minutes));
    const draft = {
      ...(actionDrafts[selectedDay.dateKey] || {}),
      decision: isRejected ? "none" : "custom",
      supplementary: isExtraordinaryDay(selectedDay) ? "" : minutesToHourInput(approvedMinutes),
      extraordinary: isExtraordinaryDay(selectedDay) ? minutesToHourInput(approvedMinutes) : "",
      late: minutesToHourInput(defaultAppliedLateMinutes(selectedDay)),
      earlyLeave: minutesToHourInput(
        selectedDay.authorization?.adjustedEarlyLeaveMinutes ?? selectedDay.earlyLeaveMinutes ?? 0,
      ),
      note: pendingAdditionalApproval.note || (isRejected
        ? "Tiempo adicional no aprobado."
        : isPlannedOnly
          ? "Tiempo adicional aprobado según planificación."
        : "Tiempo adicional aprobado."),
      additionalResolved: true,
    };

    const wasSaved = await saveDayAction(
      selectedDay,
      draft,
      isRejected
        ? "Tiempo adicional no aprobado."
        : isPlannedOnly
          ? `${formatMinutes(approvedMinutes)} de tiempo adicional planificado aprobado.`
        : `${formatMinutes(approvedMinutes)} de tiempo adicional ${pendingAdditionalApproval.isEdit ? "actualizados" : "aprobados"}.`,
    );

    if (wasSaved) {
      setPendingAdditionalApproval(null);
    }
  }

  async function acceptRegisteredExtraTime(day) {
    const detectedMinutes = detectedAdditionalMinutesForDay(day);

    if (!detectedMinutes) return;

    await saveDayAction(
      day,
      {
        ...(actionDrafts[day.dateKey] || {}),
        decision: "custom",
        supplementary: isExtraordinaryDay(day) ? "" : minutesToHourInput(detectedMinutes),
        extraordinary: isExtraordinaryDay(day) ? minutesToHourInput(detectedMinutes) : "",
        late: "",
        earlyLeave: "",
        note: "Se acepta únicamente el tiempo registrado en el día extra.",
      },
      `${formatMinutes(detectedMinutes)} de tiempo registrado aceptado.`,
    );
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
      setSuccess("");

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
      setSuccess(successMessage);
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setSavingDay("");
    }
  }

  async function toggleReviewedDay(day) {
    const isReviewed = day.authorization?.decision === "reviewed";

    try {
      setSavingDay(day.dateKey);
      setError("");

      const response = await fetch("/api/planner/attendance/day-decisions", {
        method: isReviewed ? "DELETE" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(isReviewed
          ? { employeeId, dateKey: day.dateKey }
          : authorizationPayloadForDay(employeeId, day, "reviewed", {
            ...(actionDrafts[day.dateKey] || {}),
            decision: "reviewed",
            note: actionDrafts[day.dateKey]?.note || "Día revisado sin ajuste de valores.",
          })),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo actualizar la revisión.");
      }

      setSelectedDayKey("");
      await loadReport(month);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingDay("");
    }
  }

  async function deleteHistoryDecision() {
    if (!pendingHistoryDelete || !selectedDay) return;

    const item = pendingHistoryDelete.item;
    const isPermanent = pendingHistoryDelete.mode === "permanent";

    try {
      setDeletingHistoryId(item.id);
      setError("");
      setSuccess("");

      const isException = item.kind === "operational_exception";
      const response = isPermanent
        ? await fetch("/api/planner/attendance/decision-history", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            dateKey: selectedDay.dateKey,
            targetType: item.purgeTarget?.type,
            targetId: item.purgeTarget?.id,
          }),
        })
        : await fetch(
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
        throw new Error(payload.error || (isPermanent
          ? "No se pudo eliminar la decisión definitivamente."
          : "No se pudo desactivar la decisión."));
      }

      const dateKey = selectedDay.dateKey;
      setPendingHistoryDelete(null);
      await loadReport(month, { background: true });
      await loadDecisionHistory(dateKey);
      setSuccess(isPermanent
        ? "Decisión eliminada definitivamente."
        : "Decisión desactivada correctamente. El antecedente permanece en el historial.");
    } catch (requestError) {
      setError(requestError.message);
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
      setSuccess("");
      const selectedDayCount = selectedLateDays.length;

      for (const day of selectedLateDays) {
        const detectedAdditionalMinutes = detectedAdditionalMinutesForDay(day);
        const approvedAdditionalMinutes = pendingSelectedLateAction === "approve_additional"
          ? selectedAdditionalApprovalMode === "max"
            ? Math.min(detectedAdditionalMinutes, maxAdditionalMinutes)
            : selectedAdditionalApprovalMode === "planned"
              ? Math.min(detectedAdditionalMinutes, plannedAdditionalMinutes(day))
              : selectedAdditionalApprovalMode === "none"
                ? 0
            : detectedAdditionalMinutes
          : 0;
        const rejectsAdditional = pendingSelectedLateAction === "approve_additional" && approvedAdditionalMinutes <= 0;
        const decision = pendingSelectedLateAction === "justify_late"
          ? "justify_late"
          : pendingSelectedLateAction === "approve_additional"
            ? rejectsAdditional ? "none" : "custom"
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
            note: note || (rejectsAdditional
              ? "Tiempo adicional no aprobado."
              : selectedAdditionalApprovalMode === "planned"
                ? "Tiempo adicional aprobado según planificación."
                : "Tiempo adicional aprobado."),
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
      setSuccess(
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

  return (
    <section className={styles.panel}>
      {error ? (
        <div className={styles.errorBox}>
          <AlertTriangle size={17} />
          {error}
        </div>
      ) : null}

      {success ? (
        <div className={styles.successBox} role="status">
          <CircleCheck size={17} />
          {success}
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
              <strong>{minutesBadge(row.summary.detectedSupplementaryLabel)}</strong>
              <small>Planificadas {minutesBadge(row.summary.plannedSupplementaryLabel)}</small>
            </article>
            <article>
              <span>Extraordinarias</span>
              <strong>{minutesBadge(row.summary.detectedExtraordinaryLabel)}</strong>
              <small>Planificadas {minutesBadge(row.summary.plannedExtraordinaryLabel)}</small>
            </article>
            <article>
              <span>Atraso total</span>
              <strong>{minutesBadge(row.summary.lateLabel)}</strong>
              <small>{row.summary.pendingLateDays ?? row.summary.lateDays} días con atraso</small>
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
                Atrasos
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
                <label className={styles.masterSelection} title={allVisibleLateDaysSelected ? "Quitar selección" : showOnlyAdditionalDays ? "Seleccionar tiempo adicional" : "Seleccionar todos los atrasos"}>
                  <input
                    type="checkbox"
                    checked={allVisibleLateDaysSelected}
                    onChange={toggleVisibleLateDaySelection}
                    disabled={!selectableReviewDays.length || Boolean(savingBulkAction)}
                    aria-label={allVisibleLateDaysSelected ? "Quitar selección visible" : showOnlyAdditionalDays ? "Seleccionar tiempo adicional visible" : "Seleccionar atrasos visibles"}
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
                          <th>Atraso</th>
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
                                        aria-label={`Seleccionar ${showOnlyAdditionalDays ? "tiempo adicional" : "atraso"} de ${day.dayLabel} ${day.dateLabel}`}
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
                                          className={punchChipClass(day, index)}
                                          title={punch.adjustedFrom ? `Picada real: ${punch.adjustedFrom}` : undefined}
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
                    <span>
                      {selectedPreview?.additionalKindLabel || "HS"} {selectedHasSavedAdditionalApproval ? "aprobadas" : "registradas"}
                    </span>
                    <strong>{selectedPreview?.registeredAdditionalLabel || "--"}</strong>
                    <small>{selectedPreview?.registeredAmountLabel || "$0.00"}</small>
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
                      className={`${styles.punchChipButton} ${punch.adjustedFrom ? styles.punchChipAdjusted : ""} ${punch.isIgnored ? styles.punchChipIgnored : ""}`}
                      onClick={() => openDeletePunch(selectedDay, punch)}
                      disabled={punch.isIgnored || isSavingPunch || savingDay === selectedDay.dateKey}
                      title={punch.isIgnored ? `Picada anulada: ${punch.ignoredReason || "sin motivo"}` : punch.adjustedFrom ? `Picada real: ${punch.adjustedFrom}` : "Anular picada"}
                    >
                      <small>{punchDisplayLabelForDay(selectedDay, punch)}</small>
                      <span className={styles.punchChipTime}>{punch.time}</span>
                      {punch.adjustedFrom ? (
                        <span className={styles.punchChipMeta}>Real {punch.adjustedFrom}</span>
                      ) : null}
                      {punch.isIgnored ? (
                        <span className={styles.punchChipMeta}>Anulada</span>
                      ) : null}
                      <span className={styles.punchDeleteOverlay} aria-hidden="true">
                        <Ban size={14} />
                      </span>
                    </button>
                  ))}
                </div>

                {!selectedIsReviewed ? (
                  <div className="catalog-actions-block catalog-actions-separated">
                    <div className={styles.quickActionGrid}>
                      {selectedCanAcceptRegisteredExtraDay ? (
                        <>
                          <button
                            type="button"
                            className="catalog-button-primary"
                            onClick={() => acceptRegisteredExtraTime(selectedDay)}
                            disabled={savingDay === selectedDay.dateKey}
                          >
                            Aceptar tiempo registrado
                          </button>
                          <button
                            type="button"
                            className="catalog-button-ghost"
                            onClick={() => applyQuickAction(selectedDay, "pay_planned_day")}
                            disabled={savingDay === selectedDay.dateKey}
                          >
                            Ajustar al planificado
                          </button>
                        </>
                      ) : null}
                      {selectedHasOnlyAdditionalTime || selectedHasSavedAdditionalApproval ? (
                        <button
                          type="button"
                          className={selectedHasSavedAdditionalApproval ? "catalog-button-neutral" : "catalog-button-primary"}
                          onClick={() => openAdditionalApproval(selectedDay)}
                          disabled={savingDay === selectedDay.dateKey}
                        >
                          {selectedHasSavedAdditionalApproval ? "Modificar horas aprobadas" : "Resolver tiempo adicional"}
                        </button>
                      ) : null}
                      {hasAuthorizableTime(selectedDay) && !hasNoSchedulePunches(selectedDay) && !selectedHasOnlyAdditionalTime && !selectedHasSavedAdditionalApproval && !selectedHasExecutionException && !selectedCanAcceptRegisteredExtraDay ? (
                        <button type="button" className="catalog-button-ghost" onClick={() => applyQuickAction(selectedDay, "full")} disabled={savingDay === selectedDay.dateKey}>Usar registrado</button>
                      ) : null}
                      {selectedHasCleanableAlert && !selectedCanAcceptRegisteredExtraDay ? (
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
                      {selectedDetectedLateMinutes > 0 && !selectedCanAcceptRegisteredExtraDay ? (
                        <>
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

                {selectedHasReviewFooter ? (
                  <div className="catalog-actions catalog-actions-end catalog-actions-separated">
                    <button
                      type="button"
                      className="catalog-button-primary"
                      onClick={() => toggleReviewedDay(selectedDay)}
                      disabled={savingDay === selectedDay.dateKey}
                    >
                      {savingDay === selectedDay.dateKey
                        ? "Guardando..."
                        : "Marcar revisado"}
                    </button>
                  </div>
                ) : null}

                <section className={styles.decisionHistory} aria-labelledby="decision-history-title">
                  <div className={styles.decisionHistoryHeader}>
                    <div>
                      <History size={17} aria-hidden="true" />
                      <strong id="decision-history-title">Historial de decisiones</strong>
                    </div>
                    <small>Las decisiones eliminadas se conservan para auditoría.</small>
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
                              {item.canPurge ? (
                                <button
                                  type="button"
                                  className={styles.decisionHistoryPurge}
                                  onClick={() => setPendingHistoryDelete({ item, mode: "permanent" })}
                                  disabled={Boolean(deletingHistoryId)}
                                  aria-label={`Eliminar definitivamente ${item.title}`}
                                  title="Eliminar definitivamente"
                                >
                                  <Trash2 size={15} aria-hidden="true" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <p>{item.summary}</p>
                          {item.note ? <blockquote>{item.note}</blockquote> : null}
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
            title={pendingHistoryDelete?.mode === "permanent"
              ? "Eliminar definitivamente"
              : "Desactivar esta decisión"}
            message={pendingHistoryDelete
              ? pendingHistoryDelete.mode === "permanent"
                ? `${pendingHistoryDelete.item.title}. Esta acción es exclusiva de administración, borrará el registro permanentemente y no se podrá recuperar.`
                : `${pendingHistoryDelete.item.title}. La decisión dejará de estar activa y permanecerá visible en el historial para auditoría.`
              : ""}
            confirmLabel={pendingHistoryDelete?.mode === "permanent"
              ? "Eliminar definitivamente"
              : "Desactivar decisión"}
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
            title={pendingAdditionalApproval?.isEdit ? "Modificar horas aprobadas" : "Resolver tiempo adicional"}
            message={selectedDay ? `${selectedDay.dayLabel} ${selectedDay.dateLabel}` : ""}
            confirmLabel={pendingAdditionalApproval?.approvalMode === "none"
              ? "No aprobar ninguna hora"
              : pendingAdditionalApproval?.approvalMode === "planned"
                ? "Aprobar lo planificado"
              : pendingAdditionalApproval?.isEdit
                ? "Guardar nueva aprobación"
                : "Aprobar adicional"}
            cancelLabel="Cancelar"
            tone="default"
            isPending={Boolean(savingDay)}
            confirmDisabled={
              !pendingAdditionalApproval ||
              (
                pendingAdditionalApproval.approvalMode === "custom" &&
                (
                  hourInputToMinutes(pendingAdditionalApproval.minutes) <= 0 ||
                  hourInputToMinutes(pendingAdditionalApproval.minutes) > (pendingAdditionalApproval.detectedMinutes || 0)
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
                      <span>Aprobar solo lo planificado ({formatMinutes(pendingAdditionalApproval.plannedMinutes)})</span>
                    </label>
                  ) : null}
                  <label>
                    <input
                      type="radio"
                      name="day-additional-approval-mode"
                      checked={pendingAdditionalApproval.approvalMode === "custom"}
                      onChange={() => selectAdditionalApprovalMode("custom")}
                    />
                    <span>Indicar minutos</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="day-additional-approval-mode"
                      checked={pendingAdditionalApproval.approvalMode === "all"}
                      onChange={() => selectAdditionalApprovalMode("all")}
                    />
                    <span>Aprobar todo ({formatMinutes(pendingAdditionalApproval.detectedMinutes)})</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="day-additional-approval-mode"
                      checked={pendingAdditionalApproval.approvalMode === "none"}
                      onChange={() => selectAdditionalApprovalMode("none")}
                    />
                    <span>No aprobar ninguna hora adicional</span>
                  </label>
                </div>
                {pendingAdditionalApproval.approvalMode === "custom" ? (
                  <label className={styles.bulkNoteField}>
                    <span>Minutos a aprobar</span>
                    <input
                      type="number"
                      min="1"
                      max={pendingAdditionalApproval.detectedMinutes}
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
                  ? `Aprobar máximo ${formatMinutes(hourInputToMinutes(selectedAdditionalApprovalMax))} por día`
                  : selectedAdditionalApprovalMode === "planned"
                    ? "Aprobar solo lo planificado por día"
                    : selectedAdditionalApprovalMode === "none"
                      ? "No aprobar tiempo adicional"
                  : "Aprobar todo lo detectado"
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
                    <span>Aprobar todo lo detectado</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="additional-approval-mode"
                      checked={selectedAdditionalApprovalMode === "planned"}
                      onChange={() => setSelectedAdditionalApprovalMode("planned")}
                    />
                    <span>Aprobar solo lo planificado por día</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="additional-approval-mode"
                      checked={selectedAdditionalApprovalMode === "max"}
                      onChange={() => setSelectedAdditionalApprovalMode("max")}
                    />
                    <span>Aprobar máximo por día</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="additional-approval-mode"
                      checked={selectedAdditionalApprovalMode === "none"}
                      onChange={() => setSelectedAdditionalApprovalMode("none")}
                    />
                    <span>No aprobar ninguna hora adicional</span>
                  </label>
                </div>
                {selectedAdditionalApprovalMode === "max" ? (
                  <label className={styles.bulkNoteField}>
                    <span>Máximo por día</span>
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
            confirmLabel="Guardar excepción"
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
                    <AutocompleteSelect
                      label="Plantilla de horario"
                      value={exceptionDraft.templateId || ""}
                      options={exceptionTemplateOptions.map((option) => ({
                        value: option.id,
                        label: `${option.name}${option.isRecommended ? " (más cercana)" : ""}`,
                        description: option.scheduleLabel,
                        searchText: option.scheduleLabel,
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
                        <input
                          type="time"
                          value={exceptionDraft.plannedStartTime}
                          disabled={Boolean(exceptionTemplateOptions.length)}
                          onChange={(event) => updateExceptionDraft("plannedStartTime", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Almuerzo sale</span>
                        <input
                          type="time"
                          value={exceptionDraft.plannedLunchStartTime}
                          disabled={Boolean(exceptionTemplateOptions.length)}
                          onChange={(event) => updateExceptionDraft("plannedLunchStartTime", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Almuerzo vuelve</span>
                        <input
                          type="time"
                          value={exceptionDraft.plannedLunchEndTime}
                          disabled={Boolean(exceptionTemplateOptions.length)}
                          onChange={(event) => updateExceptionDraft("plannedLunchEndTime", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Salida</span>
                        <input
                          type="time"
                          value={exceptionDraft.plannedEndTime}
                          disabled={Boolean(exceptionTemplateOptions.length)}
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
                ) : null}

                {exceptionDraft.type === "missing_punch" ? (
                  <label className={styles.exceptionToggle}>
                    <input
                      type="checkbox"
                      checked={exceptionDraft.allowSupplementaryTime}
                      onChange={(event) => updateExceptionDraft("allowSupplementaryTime", event.target.checked)}
                    />
                    <span>Calcular HS/HE usando la primera y última picada</span>
                  </label>
                ) : null}

                {["outside_work", "permission"].includes(exceptionDraft.type) ? (
                  <div className={styles.exceptionTimeGrid}>
                    <label>
                      <span>Desde</span>
                      <input
                        type="time"
                        value={exceptionDraft.startTime}
                        onChange={(event) => updateExceptionDraft("startTime", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Hasta</span>
                      <input
                        type="time"
                        value={exceptionDraft.endTime}
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
