"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Plus, RefreshCw, Trash2 } from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { planningModulePath } from "@/lib/modules/planning/routes";
import styles from "./AttendanceComparisonDetail.module.scss";

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

function fullScheduleLabel(day) {
  if (!day?.startTime || !day?.endTime) {
    return day?.dayTypeLabel || "Sin horario";
  }

  if (day.lunchStartTime && day.lunchEndTime) {
    return `${formatScheduleHour(day.startTime)} A ${formatScheduleHour(day.lunchStartTime)} ${formatScheduleHour(day.lunchEndTime)} A ${formatScheduleHour(day.endTime)}`;
  }

  return `${formatScheduleHour(day.startTime)} A ${formatScheduleHour(day.endTime)}`;
}

function templateScheduleLabel(template, dateKey) {
  const dayOfWeek = dateFromDateKey(dateKey).getUTCDay();
  const rowsByDay = new Map((template?.weeklyRows || []).map((row) => [row.dayOfWeek, row]));
  const directRow = rowsByDay.get(dayOfWeek);
  const fallbackRow = [1, 2, 3, 4, 5]
    .map((weekday) => rowsByDay.get(weekday))
    .find((row) => row?.dayType === "workday");
  const row = directRow || ([1, 2, 3, 4, 5].includes(dayOfWeek) ? fallbackRow : null);

  if (!row || row.dayType !== "workday" || !row.startTime || !row.endTime) {
    return "Descanso";
  }

  return fullScheduleLabel(row);
}

function employeeMatchesTemplate(employee, template) {
  if (!employee || !template) return false;
  if (template.areaCode !== employee.areaCode) return false;
  if (!template.roleCode) return true;
  if (template.roleCode === employee.roleCode) return true;

  return false;
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
  return day?.dayType === "weekend_overtime";
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
  return punch?.adjustedFrom ? `${punchLabel(index, punchCount)} AJ` : punchLabel(index, punchCount);
}

const DEFAULT_LUNCH_LIMIT_MINUTES = 60;

function hasSavedDayDecision(day) {
  return Boolean(day?.authorization?.isSaved && day.authorization.source !== "operational_exception");
}

function isScheduledExtraDay(day) {
  return day?.dayType === "weekend_overtime";
}

function hasPendingEntryLate(day) {
  return !hasSavedDayDecision(day) && (!isExtraordinaryDay(day) || isScheduledExtraDay(day)) && (Number(day?.lateMinutes) || 0) > 0;
}

function hasPendingLunchOverage(day) {
  const plannedLunchMinutes = Number(day?.lunchDiscountMinutes) ||
    Number(day?.lunchDurationMinutes) ||
    DEFAULT_LUNCH_LIMIT_MINUTES;
  const actualLunchMinutes = Number(day?.actualLunchMinutes) || 0;

  return !hasSavedDayDecision(day) && actualLunchMinutes > plannedLunchMinutes;
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
  return ["workday", "weekend_overtime"].includes(day.dayType);
}

function isExtraordinaryDay(day) {
  return ["holiday", "weekend_overtime", "off_day"].includes(day?.dayType);
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

function registeredAdditionalMinutes(day) {
  return isExtraordinaryDay(day)
    ? Number(day?.extraordinaryMinutes) || 0
    : Number(day?.supplementaryMinutes) || 0;
}

function additionalAmountValue(minutes, day, summary = {}) {
  const hourlyRate = Number(summary.hourlyRateRaw ?? summary.hourlyRate) || 0;
  const multiplier = isExtraordinaryDay(day)
    ? Number(summary.extraordinaryMultiplier) || 1
    : Number(summary.supplementaryMultiplier) || 0.5;

  return (Math.max(0, Number(minutes) || 0) / 60) * hourlyRate * multiplier;
}

function additionalAmountLabel(minutes, day, summary = {}) {
  return moneyLabel(additionalAmountValue(minutes, day, summary));
}

function additionalValueRows(day, summary = {}) {
  const kind = additionalKindLabel(day);
  const plannedMinutes = plannedAdditionalMinutes(day);
  const registeredMinutes = registeredAdditionalMinutes(day);

  return [
    {
      label: `${kind} plan.`,
      minutesLabel: plannedMinutes ? formatMinutes(plannedMinutes) : "--",
      amountLabel: additionalAmountLabel(plannedMinutes, day, summary),
    },
    {
      label: `${kind} reg.`,
      minutesLabel: registeredMinutes ? formatMinutes(registeredMinutes) : "--",
      amountLabel: additionalAmountLabel(registeredMinutes, day, summary),
      registered: true,
    },
  ];
}

function detectedLateIssueMinutes(day) {
  if (isExtraordinaryDay(day) && !isScheduledExtraDay(day)) return 0;

  return Math.max(
    0,
    (Number(day?.lateMinutes) || 0) + (Number(day?.lunchOverageRemainderMinutes) || 0),
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
  const lateMinutes = decision === "justify_late"
    ? Math.max(0, Number(day?.lunchOverageRemainderMinutes) || 0)
    : ["pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
    ? 0
    : Math.min(Math.max(detectedLateMinutes, draftLateMinutes), draftLateMinutes);
  const earlyLeaveMinutes = ["pay_planned_day", "complete_regular_day", "justify_early_leave", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
    ? 0
    : Math.min(Math.max(detectedEarlyLeaveMinutes, draftEarlyLeaveMinutes), draftEarlyLeaveMinutes);

  const lunchOverageMinutes = Math.max(0, Number(day?.lunchOverageRemainderMinutes) || 0);
  const appliedLunchOverageMinutes = ["planned", "pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
    ? 0
    : lunchOverageMinutes;

  return {
    lateMinutes,
    earlyLeaveMinutes,
    lunchOverageMinutes,
    appliedLunchOverageMinutes,
    totalMinutes: lateMinutes,
  };
}

function hasIncoherentWorkedDay(day) {
  if (!day || isExtraordinaryDay(day) || isIgnorableRestDay(day)) return false;
  if (hasDayTag(day, "Sin picadas") || hasDayTag(day, "Picadas incompletas") || hasDayTag(day, "Picadas insuficientes")) return false;

  const plannedMinutes = Number(day.scheduledWorkedMinutes) || Number(day.plannedRegularMinutes) || 0;
  const workedMinutes = Number(day.workedMinutes) || 0;

  if (!plannedMinutes || !workedMinutes) return false;

  return workedMinutes < Math.min(4 * 60, plannedMinutes / 2);
}

function hasOperationalError(day) {
  return (day.tags || []).some((tag) => [
    "Sin picadas",
    "Picadas incompletas",
    "Picadas insuficientes",
  ].includes(tag)) || hasIncoherentWorkedDay(day);
}

function hasPlanningAlert(day) {
  return (day.tags || []).some((tag) => [
    "Sin picadas",
    "Picadas incompletas",
    "Picadas insuficientes",
    "No planificado",
    "Trabajo sin horario",
  ].includes(tag));
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
  else if (day.hasIssue) rowClasses.push(styles.issueRow);

  return rowClasses.join(" ");
}

function hasAuthorizableTime(day) {
  return (Number(day.detectedSupplementaryMinutes) || 0) > 0 || (Number(day.detectedExtraordinaryMinutes) || 0) > 0;
}

function canManuallyAuthorizeHours(day) {
  if (hasAuthorizableTime(day)) return true;
  if ((Number(day.lateMinutes) || 0) > 0 || (Number(day.authorization?.detectedLateMinutes) || 0) > 0) return true;
  if ((Number(day.earlyLeaveMinutes) || 0) > 0 || (Number(day.authorization?.detectedEarlyLeaveMinutes) || 0) > 0) return true;

  if (day.dayType === "workday") {
    return day.payrollPolicy?.appliesSupplementaryHours !== false;
  }

  return ["holiday", "weekend_overtime", "off_day"].includes(day.dayType) &&
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
  ].includes(tag)) {
    return `${styles.issueTag} ${styles.justifiedTag}`;
  }

  if ([
    "Sin picadas",
    "Picadas incompletas",
    "Picadas insuficientes",
    "Jornada incompleta",
  ].includes(tag)) return `${styles.issueTag} ${styles.severeTag}`;
  return styles.issueTag;
}

const VISIBLE_DAY_TAGS = new Set([
  "Sin picadas",
  "Picadas incompletas",
  "Picadas insuficientes",
  "Atraso",
  "Salida anticipada",
  "Jornada laboral completada",
  "Justificación operativa",
  "Trabajo fuera justificado",
  "Horas descontadas",
  "Ajustado a planificación",
  "Picadas justificadas",
  "Atraso justificado",
  "Salida justificada",
  "Dia descontado",
]);

function visibleDayTags(day) {
  const tags = (day.tags || []).filter((tag) => VISIBLE_DAY_TAGS.has(tag));
  const statusLabel = day?.authorization?.statusLabel || "";

  if (hasIncoherentWorkedDay(day) && !tags.includes("Jornada incompleta")) {
    tags.push("Jornada incompleta");
  }

  if (["Revisado", "No pagado", "Dia descontado"].includes(statusLabel) && !tags.includes(statusLabel)) {
    tags.push(statusLabel);
  }

  return tags;
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
  return hasDayTag(day, "Picadas incompletas") || hasDayTag(day, "Picadas insuficientes");
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

function clockTimeToMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);

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

  return hours * 60 + minutes;
}

function minutesToClockTime(value) {
  const totalMinutes = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(value) || 0)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function lunchPunchSuggestion(day) {
  if (!day || day.punches?.length !== 2) return null;

  const firstPunchMinutes = clockTimeToMinutes(day.punches[0]?.time);
  const lastPunchMinutes = clockTimeToMinutes(day.punches[1]?.time);

  if (firstPunchMinutes === null || lastPunchMinutes === null) return null;

  const spanMinutes = lastPunchMinutes - firstPunchMinutes;

  if (spanMinutes <= 6 * 60) return null;

  const lunchMinutes = Math.max(
    0,
    Number(day.lunchDurationMinutes) ||
      Number(day.lunchDiscountMinutes) ||
      DEFAULT_LUNCH_LIMIT_MINUTES,
  );

  if (!lunchMinutes || lunchMinutes >= spanMinutes) return null;

  const lunchStartMinutes = Math.round((firstPunchMinutes + lastPunchMinutes - lunchMinutes) / 2);
  const lunchEndMinutes = lunchStartMinutes + lunchMinutes;

  if (lunchStartMinutes <= firstPunchMinutes || lunchEndMinutes >= lastPunchMinutes) return null;

  return {
    lunchMinutes,
    lunchStart: minutesToClockTime(lunchStartMinutes),
    lunchEnd: minutesToClockTime(lunchEndMinutes),
  };
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
      decision: day.authorization?.decision || "custom",
    },
  ]));
}

function hasPreparedAdjustment(day, draft = {}) {
  if (!day) return false;
  const initialDraft = buildActionDrafts([day])[day.dateKey] || {};

  if ((draft.decision || "custom") !== "custom") return true;

  return ["supplementary", "extraordinary", "late"].some((field) =>
    String(draft[field] || "") !== String(initialDraft[field] || ""),
  );
}

function plannedAuthorizationMinutes(day) {
  const plannedSupplementaryMinutes = Math.min(
    isExtraordinaryDay(day) ? 0 : Number(day.detectedSupplementaryMinutes) || 0,
    Math.max(0, Number(day.plannedSupplementaryMinutes) || 0),
  );
  const plannedExtraordinaryMinutes = Math.min(
    isExtraordinaryDay(day) ? Number(day.detectedExtraordinaryMinutes) || 0 : 0,
    day.dayType === "holiday" && (Number(day.punchCount) || 0) > 0
      ? 8 * 60
      : day.dayType === "weekend_overtime"
        ? Number(day.scheduledWorkedMinutes) || 0
        : Number(day.plannedExtraordinaryMinutes) || 0,
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
    : decision === "reviewed"
      ? 0
    : isCompleteRegularDayDecision(decision)
      ? 0
    : isPlannedPaidDecision(decision)
      ? plannedPaidMinutes.plannedSupplementaryMinutes
    : decision === "planned"
      ? plannedMinutes.plannedSupplementaryMinutes
      : Math.min(detectedSupplementaryMinutes, draftSupplementaryMinutes);
  const authorizedExtraordinaryMinutes = decision === "full"
    ? detectedExtraordinaryMinutes
    : decision === "reviewed"
      ? 0
    : isCompleteRegularDayDecision(decision)
      ? 0
    : isPlannedPaidDecision(decision)
      ? plannedPaidMinutes.plannedExtraordinaryMinutes
    : decision === "planned"
      ? plannedMinutes.plannedExtraordinaryMinutes
      : Math.min(detectedExtraordinaryMinutes, draftExtraordinaryMinutes);
  const detectedLateMinutes = Math.max(detectedLateIssueMinutes(day), draftLateMinutes);
  const adjustedLateMinutes = decision === "justify_late"
    ? Math.max(0, Number(day?.lunchOverageRemainderMinutes) || 0)
    : ["pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
    ? 0
    : decision === "full" && (draft.late === undefined || draft.late === null || String(draft.late).trim() === "")
      ? detectedLateMinutes
      : Math.min(detectedLateMinutes, draftLateMinutes);
  const detectedEarlyLeaveMinutes = Math.max(Number(day.earlyLeaveMinutes) || 0, draftEarlyLeaveMinutes);
  const adjustedEarlyLeaveMinutes = ["pay_planned_day", "complete_regular_day", "justify_early_leave", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
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
  const supplementaryMultiplier = Number(summary.supplementaryMultiplier) || 0.5;
  const extraordinaryMultiplier = Number(summary.extraordinaryMultiplier) || 1;
  const supplementaryAmount = (supplementaryMinutes / 60) * hourlyRate * supplementaryMultiplier;
  const extraordinaryAmount = (extraordinaryMinutes / 60) * hourlyRate * extraordinaryMultiplier;
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
    plannedAmountLabel: moneyLabel((plannedAdditional / 60) * hourlyRate * additionalMultiplier),
    registeredAmountLabel: moneyLabel((registeredAdditional / 60) * hourlyRate * additionalMultiplier),
    additionalKindLabel: additionalKindLabel(day),
    additionalKindLongLabel: additionalKindLabel(day, true),
    lateLabel: issueMinutes.lateMinutes ? formatMinutes(issueMinutes.lateMinutes) : "--",
    earlyLeaveLabel: issueMinutes.earlyLeaveMinutes ? formatMinutes(issueMinutes.earlyLeaveMinutes) : "--",
    lunchOverageLabel: issueMinutes.lunchOverageMinutes ? formatMinutes(issueMinutes.lunchOverageMinutes) : "--",
    issueDiscountLabel: issueMinutes.totalMinutes ? formatMinutes(issueMinutes.totalMinutes) : "--",
    breakdown: [
      ...(issueMinutes.totalMinutes > 0 ? [{ label: "Atraso detectado", valueLabel: formatMinutes(issueMinutes.totalMinutes) }] : []),
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
      : draft.decision === "justify_early_leave"
        ? "Vista previa: salida justificada"
      : draft.decision === "pay_planned_day"
        ? "Vista previa: pagar plan"
      : draft.decision === "complete_regular_day"
        ? "Vista previa: completar laboral"
      : draft.decision === "planned"
        ? "Vista previa: plan"
        : draft.decision === "none"
          ? "Vista previa: no pagar"
          : "Vista previa: ajuste",
  };
}

function buildReturnHref(filters) {
  const params = new URLSearchParams();
  params.set("month", filters.month || currentMonthKey());

  if (filters.branchCode) params.set("branchCode", filters.branchCode);
  if (filters.areaCode) params.set("areaCode", filters.areaCode);
  if (filters.roleCode) params.set("roleCode", filters.roleCode);

  return `${planningModulePath("/attendance/comparison")}?${params.toString()}`;
}

function quickActionNote(decision) {
  const notes = {
    justify_no_punches: "Ajuste: se usan los valores del horario planificado.",
    justify_incomplete_punches: "Justificación: picadas incompletas reconocidas.",
    justify_late: "Justificación: atraso reconocido.",
    justify_early_leave: "Justificación: salida anticipada reconocida.",
    pay_planned_day: "Justificación: día planificado pagado.",
    complete_regular_day: "Justificación: jornada laboral completada sin adicionales.",
  };

  return notes[decision] || "";
}

function bulkDecisionLabel(decision) {
  const labels = {
    adjust_alerts: "Ajustar a planificación",
    reset: "Reiniciar todo",
  };

  return labels[decision] || "Confirmar";
}

function ActionButtonLabel({ label, count }) {
  return (
    <>
      <span className={styles.actionButtonText}>{label}</span>
      <span className={styles.actionButtonCount}>{count}</span>
    </>
  );
}

export default function AttendanceComparisonDetail({ employeeId, initialFilters = {} }) {
  const [stableInitialFilters] = useState(() => ({
    month: initialFilters.month || currentMonthKey(),
    branchCode: initialFilters.branchCode || "",
    areaCode: initialFilters.areaCode || "",
    roleCode: initialFilters.roleCode || "",
  }));
  const initialFiltersRef = useRef(stableInitialFilters);
  const [month, setMonth] = useState(() => stableInitialFilters.month);
  const [row, setRow] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [actionDrafts, setActionDrafts] = useState({});
  const [savingDay, setSavingDay] = useState("");
  const [savingScheduleDay, setSavingScheduleDay] = useState("");
  const [scheduleTemplateDrafts, setScheduleTemplateDrafts] = useState({});
  const [savingBulkAction, setSavingBulkAction] = useState("");
  const [pendingBulkDecision, setPendingBulkDecision] = useState("");
  const [selectedDayKey, setSelectedDayKey] = useState("");
  const [punchForm, setPunchForm] = useState(null);
  const [pendingDeletePunch, setPendingDeletePunch] = useState(null);
  const [isSavingPunch, setIsSavingPunch] = useState(false);

  const filters = {
    ...stableInitialFilters,
    month,
  };
  const selectedDay = row?.days?.find((day) => day.dateKey === selectedDayKey) || null;
  const pendingDecisionDays = row?.days?.filter((day) => !hasSavedDayDecision(day) && !isIgnorableRestDay(day)) || [];
  const alertDays = pendingDecisionDays.filter(hasPlanningAlert);
  const savedDecisionDays = row?.days?.filter(hasSavedDayDecision) || [];
  const selectedDraft = selectedDay ? actionDrafts[selectedDay.dateKey] || {} : {};
  const selectedPreview = selectedDay ? buildDecisionPreview(selectedDay, selectedDraft, row?.summary || {}) : null;
  const selectedHasSavedDecision = hasSavedDayDecision(selectedDay);
  const selectedIsReviewed = selectedDay?.authorization?.decision === "reviewed";
  const selectedHasPreparedAdjustment = selectedDay ? hasPreparedAdjustment(selectedDay, selectedDraft) : false;
  const selectedDetectedLateMinutes = selectedDay
    ? unresolvedEntryLateMinutes(selectedDay)
    : 0;
  const selectedHasCleanableAlert = selectedDay
    ? selectedDay.hasIssue ||
      hasPlanningAlert(selectedDay) ||
      Number(selectedDay.lunchOverageRemainderMinutes) > 0 ||
      Number(selectedDay.lateMinutes) > 0
    : false;
  const selectedCanUsePlannedDay = selectedDay
    ? hasDayTag(selectedDay, "Sin picadas") && hasPlannedStart(selectedDay) && Number(selectedDay.scheduledWorkedMinutes) > 0
    : false;
  const selectedLunchSuggestion = selectedDay ? lunchPunchSuggestion(selectedDay) : null;
  const scheduleOptions = row?.employee && selectedDay
    ? templates
      .filter((template) => template.isActive !== false && employeeMatchesTemplate(row.employee, template))
      .map((template) => ({
        id: template.id,
        name: template.name,
        label: `${template.name} · ${templateScheduleLabel(template, selectedDay.dateKey)}`,
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "es"))
    : [];
  const selectedScheduleTemplateDraft = selectedDay
    ? scheduleTemplateDrafts[selectedDay.dateKey] ?? selectedDay.plannedTemplateId ?? ""
    : "";
  const selectedScheduleChanged = selectedDay
    ? Boolean(selectedScheduleTemplateDraft) && selectedScheduleTemplateDraft !== (selectedDay.plannedTemplateId || "")
    : false;

  function syncUrl(nextMonth) {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams();
    params.set("month", nextMonth);

    if (filters.branchCode) params.set("branchCode", filters.branchCode);
    if (filters.areaCode) params.set("areaCode", filters.areaCode);
    if (filters.roleCode) params.set("roleCode", filters.roleCode);

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

      const response = await fetch(`/api/attendance/comparison?${params.toString()}`);
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

  useEffect(() => {
    let isCancelled = false;

    async function loadTemplates() {
      try {
        const response = await fetch("/api/planning/base-schedules");
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
    setMonth(value);
    syncUrl(value);
    loadReport(value);
  }

  function updateActionDraft(dateKey, field, value) {
    setActionDrafts((current) => ({
      ...current,
      [dateKey]: {
        ...(current[dateKey] || {}),
        [field]: value,
      },
    }));
  }

  function updateScheduleTemplateDraft(dateKey, value) {
    setScheduleTemplateDrafts((current) => ({
      ...current,
      [dateKey]: value,
    }));
  }

  async function savePlannedSchedule(day, options = {}) {
    const templateId = scheduleTemplateDrafts[day.dateKey] ?? day.plannedTemplateId ?? "";

    if (!templateId) {
      setError("Selecciona una plantilla para actualizar el horario planificado.");
      return false;
    }

    try {
      setSavingScheduleDay(day.dateKey);
      setError("");

      const response = await fetch("/api/planning/schedule-assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "update-day-schedule",
          monthKey: month,
          employeeId,
          dateKey: day.dateKey,
          templateId,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo actualizar el horario planificado.");
      }

      if (options.closeAfterSave) {
        setSelectedDayKey("");
      } else {
        setSelectedDayKey(day.dateKey);
      }

      if (options.reload !== false) {
        await loadReport(month, { background: !options.closeAfterSave });
      }

      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setSavingScheduleDay("");
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
        : decision === "full"
        ? minutesToHourInput(day.detectedSupplementaryMinutes || 0)
        : decision === "justify_late"
          ? (currentDraft.supplementary || "")
        : decision === "justify_early_leave"
          ? (currentDraft.supplementary || "")
        : decision === "reviewed"
          ? (currentDraft.supplementary || "")
        : isCompleteRegularDayDecision(decision)
          ? ""
        : isPlannedPaidDecision(decision)
          ? minutesToHourInput(plannedPaidMinutes.plannedSupplementaryMinutes)
        : decision === "planned"
          ? minutesToHourInput(plannedMinutes.plannedSupplementaryMinutes)
          : "",
      extraordinary: !isExtraordinary
        ? ""
        : decision === "full"
        ? minutesToHourInput(day.detectedExtraordinaryMinutes || 0)
        : decision === "justify_late"
          ? (currentDraft.extraordinary || "")
        : decision === "justify_early_leave"
          ? (currentDraft.extraordinary || "")
        : decision === "reviewed"
          ? (currentDraft.extraordinary || "")
        : isCompleteRegularDayDecision(decision)
          ? ""
        : isPlannedPaidDecision(decision)
          ? minutesToHourInput(plannedPaidMinutes.plannedExtraordinaryMinutes)
        : decision === "planned"
          ? minutesToHourInput(plannedMinutes.plannedExtraordinaryMinutes)
          : "",
      late: ["planned", "pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches", "justify_late"].includes(decision)
        ? ""
        : decision === "reviewed"
          ? (currentDraft.late ?? detectedLateInput)
          : detectedLateInput,
      earlyLeave: ["planned", "pay_planned_day", "complete_regular_day", "justify_early_leave", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
        ? ""
        : decision === "reviewed"
          ? (currentDraft.earlyLeave ?? detectedEarlyLeaveInput)
          : detectedEarlyLeaveInput,
      note: quickActionNote(decision) || currentDraft.note || "",
      decision,
    };
  }

  function applyQuickAction(day, decision) {
    setActionDrafts((current) => ({
      ...current,
      [day.dateKey]: quickActionDraft(day, decision, current[day.dateKey] || {}),
    }));
  }

  function openAddPunch(day) {
    setPunchForm({
      dateKey: day.dateKey,
      dateLabel: day.dateLabel,
      dayLabel: day.dayLabel,
      time: "",
      reason: "",
    });
  }

  function updatePunchForm(field, value) {
    setPunchForm((current) => current ? { ...current, [field]: value } : current);
  }

  function closeAddPunch() {
    if (!isSavingPunch) setPunchForm(null);
  }

  async function saveManualPunch() {
    if (!punchForm) return;

    try {
      setIsSavingPunch(true);
      setError("");

      const response = await fetch("/api/attendance/punches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          employeeId,
          punchedAt: `${punchForm.dateKey}T${punchForm.time}`,
          reason: punchForm.reason,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo agregar la picada.");
      }

      setSelectedDayKey(punchForm.dateKey);
      setPunchForm(null);
      await loadReport(month, { background: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSavingPunch(false);
    }
  }

  function openDeletePunch(day, punch) {
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

      const response = await fetch(`/api/attendance/punches/${pendingDeletePunch.punch.id}`, {
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
        throw new Error(payload.error || "No se pudo eliminar la picada.");
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

  async function addDefaultLunchPunches(day, suggestion) {
    if (!day || !suggestion) return;

    try {
      setIsSavingPunch(true);
      setError("");

      const reason = `Registro manual de almuerzo predeterminado (${formatMinutes(suggestion.lunchMinutes)}).`;
      const lunchPunches = [suggestion.lunchStart, suggestion.lunchEnd];

      for (const time of lunchPunches) {
        const response = await fetch("/api/attendance/punches", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            employeeId,
            punchedAt: `${day.dateKey}T${time}`,
            reason,
          }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo agregar el almuerzo.");
        }
      }

      setSelectedDayKey(day.dateKey);
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
    if (selectedDay) {
      setActionDrafts((current) => ({
        ...current,
        [selectedDay.dateKey]: buildActionDrafts([selectedDay])[selectedDay.dateKey],
      }));
      setScheduleTemplateDrafts((current) => ({
        ...current,
        [selectedDay.dateKey]: selectedDay.plannedTemplateId || "",
      }));
    }

    setSelectedDayKey("");
  }

  async function saveDayAction(day, overrideDraft = null) {
    const draft = overrideDraft || actionDrafts[day.dateKey] || {};
    const decision = [
      "full",
      "planned",
      "none",
      "pay_planned_day",
      "complete_regular_day",
      "reviewed",
      "justify_early_leave",
      "justify_no_punches",
      "justify_incomplete_punches",
      "justify_late",
    ].includes(draft.decision) ? draft.decision : "custom";

    try {
      setSavingDay(day.dateKey);
      setError("");

      const response = await fetch("/api/attendance/day-decisions", {
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
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingDay("");
    }
  }

  async function toggleReviewedDay(day) {
    const isReviewed = day.authorization?.decision === "reviewed";

    try {
      setSavingDay(day.dateKey);
      setError("");

      const response = await fetch("/api/attendance/day-decisions", {
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

  async function cleanDayAlerts(day) {
    try {
      setSavingDay(day.dateKey);
      setError("");

      const response = await fetch("/api/attendance/day-decisions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(authorizationPayloadForDay(employeeId, day, "reviewed", {
          ...(actionDrafts[day.dateKey] || {}),
          decision: "reviewed",
          note: actionDrafts[day.dateKey]?.note || "Alertas revisadas desde reporte de asistencia.",
        })),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudieron limpiar las alertas.");
      }

      setSelectedDayKey("");
      await loadReport(month);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingDay("");
    }
  }

  async function saveReviewOrAdjustment(day) {
    const hasScheduleChange = Boolean(
      (scheduleTemplateDrafts[day.dateKey] ?? day.plannedTemplateId ?? "") &&
      (scheduleTemplateDrafts[day.dateKey] ?? day.plannedTemplateId ?? "") !== (day.plannedTemplateId || ""),
    );

    if (hasScheduleChange) {
      const savedSchedule = await savePlannedSchedule(day, {
        closeAfterSave: !hasPreparedAdjustment(day, actionDrafts[day.dateKey] || {}),
        reload: !hasPreparedAdjustment(day, actionDrafts[day.dateKey] || {}),
      });

      if (!savedSchedule) {
        return;
      }
    }

    if (hasPreparedAdjustment(day, actionDrafts[day.dateKey] || {})) {
      await saveDayAction(day);
      return;
    }

    if (hasScheduleChange) {
      return;
    }

    await toggleReviewedDay(day);
  }

  async function resetDayDecision(day) {
    if (!hasSavedDayDecision(day)) {
      setActionDrafts((current) => ({
        ...current,
        [day.dateKey]: buildActionDrafts([day])[day.dateKey],
      }));
      return;
    }

    try {
      setSavingDay(day.dateKey);
      setError("");

      const response = await fetch("/api/attendance/day-decisions", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ employeeId, dateKey: day.dateKey }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo reiniciar la decisión.");
      }

      setSelectedDayKey("");
      await loadReport(month);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingDay("");
    }
  }

  function bulkDaysForDecision(decision) {
    if (decision === "adjust_alerts") return alertDays;
    return [];
  }

  function bulkDraftForDay(day, decision) {
    if (decision === "adjust_alerts") {
      if (hasDayTag(day, "Sin picadas")) {
        return quickActionDraft(day, "justify_no_punches", {
          note: "Ajuste global: alerta ajustada a planificación.",
        });
      }

      if (hasIncompletePunchTag(day)) {
        return quickActionDraft(day, "justify_incomplete_punches", {
          note: "Ajuste global: alerta ajustada a planificación.",
        });
      }

      return {
        ...quickActionDraft(day, "planned", {}),
        decision: "planned",
        note: "Ajuste global: alerta ajustada a planificación.",
      };
    }

    return {};
  }

  async function saveBulkDecision(decision) {
    const daysToSave = bulkDaysForDecision(decision);

    if (!daysToSave.length) return;

    try {
      setSavingBulkAction(decision);
      setError("");

      for (const day of daysToSave) {
        const dayDecision = hasDayTag(day, "Sin picadas")
          ? "justify_no_punches"
          : hasIncompletePunchTag(day)
            ? "justify_incomplete_punches"
            : "planned";
        const response = await fetch("/api/attendance/day-decisions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(authorizationPayloadForDay(employeeId, day, dayDecision, bulkDraftForDay(day, decision))),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar el ajuste global.");
        }
      }

      await loadReport(month);
      setPendingBulkDecision("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingBulkAction("");
    }
  }

  async function resetBulkDecisions() {
    if (!savedDecisionDays.length) return;

    try {
      setSavingBulkAction("reset");
      setError("");

      for (const day of savedDecisionDays) {
        const response = await fetch("/api/attendance/day-decisions", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ employeeId, dateKey: day.dateKey }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo reiniciar las decisiones del mes.");
        }
      }

      await loadReport(month);
      setPendingBulkDecision("");
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
      <div className={styles.topbar}>
        <Link href={buildReturnHref(filters)} className={styles.backLink}>
          <ArrowLeft size={16} />
          Resumen
        </Link>
      </div>

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
              <input type="month" value={month} onChange={(event) => handleMonthChange(event.target.value)} />
            </label>
          </div>

          <div className={styles.metricGrid}>
            <article className={styles.salaryMetric}>
              <span>Sueldo</span>
              <strong>{row.summary.salaryProjectedLabel}</strong>
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
              <small>{row.summary.lateDays} días con atraso</small>
            </article>
          </div>

          <div className={styles.bulkActions}>
            <div className="catalog-actions">
              <button type="button" className={`catalog-button-primary ${styles.adjustPlanButton}`} onClick={() => setPendingBulkDecision("adjust_alerts")} disabled={!alertDays.length || Boolean(savingBulkAction)}>
                {savingBulkAction === "adjust_alerts" ? "Ajustando..." : <ActionButtonLabel label="Ajustar a planificación" count={alertDays.length} />}
              </button>
              <button type="button" className="catalog-button-ghost" onClick={() => setPendingBulkDecision("reset")} disabled={!savedDecisionDays.length || Boolean(savingBulkAction)}>
                {savingBulkAction === "reset" ? "Reiniciando..." : <ActionButtonLabel label="Reiniciar" count={savedDecisionDays.length} />}
              </button>
            </div>
            <span className={styles.savedDecisionCount}>{savedDecisionDays.length} decisiones guardadas</span>
          </div>

          <div className={styles.weekBlocks}>
            {groupDaysByWeek(row.days).map((week) => {
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
                    <table>
                      <thead>
                        <tr>
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
                                <td colSpan={7}>
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
                                    {day.startTime && day.endTime ? (
                                      <>
                                        <span>{fullScheduleLabel(day)}</span>
                                      </>
                                    ) : (
                                      <>
                                        <span>{day.dayTypeLabel}</span>
                                      </>
                                    )}
                                  </div>
                                  <div className={styles.punchLine}>
                                    {day.punches.length
                                      ? day.punches.map((punch, index) => (
                                        <span
                                          key={punch.id}
                                          className={punchChipClass(day, index)}
                                          title={punch.adjustedFrom ? `Picada real: ${punch.adjustedFrom}` : undefined}
                                        >
                                          <small>{punchDisplayLabel(punch, index, day.punchCount)} </small>
                                          {punch.time}
                                        </span>
                                      ))
                                      : <span><small>Picadas </small>Sin registros</span>}
                                  </div>
                                </div>
                              </td>
                              <td>
                                {day.plannedScheduleExists === false ? (
                                  <strong>--</strong>
                                ) : day.scheduledWorkedMinutes > 0 ? (
                                  <strong>{day.scheduledWorkedLabel}</strong>
                                ) : (
                                  <strong>{day.dayTypeLabel}</strong>
                                )}
                              </td>
                              <td>
                                <strong>{isIgnorableRestDay(day) ? "--" : day.workedLabel}</strong>
                              </td>
                              <td>
                                {hasPlannedStart(day) ? (
                                  <>
                                    <strong>{displayLateMinutes(day) ? `${displayLateMinutes(day)}m` : "--"}</strong>
                                    {Number(day.lunchOverageRemainderMinutes) > 0 ? (
                                      <span>Alm. {day.actualLunchLabel}</span>
                                    ) : null}
                                    {Number(day.earlyLeaveMinutes) > 0 ? <span>Salida {formatMinutes(day.earlyLeaveMinutes)}</span> : null}
                                    {Number(day.lunchOverageRemainderMinutes) > 0 ? <span>ALM extra {formatMinutes(day.lunchOverageRemainderMinutes)}</span> : null}
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
                                      <div key={item.label} className={item.registered ? styles.registeredAdditionalValue : undefined}>
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
                                    {visibleDayTags(day).map((tag) => <span key={tag} className={issueTagClass(tag)}>{tag}</span>)}
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
                            <em>Reg.</em>
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
                            <em>Reg.</em>
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
                            <em>Reg.</em>
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
                            <em>Reg.</em>
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
                            <em>Reg.</em>
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
                            <em>Reg.</em>
                            <strong>{moneyLabel(registeredTotalAmount)}</strong>
                          </div>
                        </div>
                      </span>
                    </div>
                  </div>
                </section>
              );
            })}
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
                    <span>{selectedPreview?.additionalKindLabel || "HS"} registradas</span>
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

                <section className={styles.plannedScheduleEditor}>
                  <label>
                    <span>Plantilla planificada</span>
                    <select
                      value={selectedScheduleTemplateDraft}
                      onChange={(event) => updateScheduleTemplateDraft(selectedDay.dateKey, event.target.value)}
                      disabled={savingScheduleDay === selectedDay.dateKey}
                    >
                      <option value="">Seleccionar plantilla</option>
                      {scheduleOptions.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!scheduleOptions.length ? (
                    <small>No hay plantillas disponibles para el área y rol actual.</small>
                  ) : null}
                </section>

                <div className={styles.modalPunches}>
                  {selectedDay.punches.map((punch, index) => (
                    <button
                      key={punch.id}
                      type="button"
                      className={`${styles.punchChipButton} ${punch.adjustedFrom ? styles.punchChipAdjusted : ""}`}
                      onClick={() => openDeletePunch(selectedDay, punch)}
                      disabled={isSavingPunch || savingDay === selectedDay.dateKey}
                      title={punch.adjustedFrom ? `Picada real: ${punch.adjustedFrom}` : "Eliminar picada"}
                    >
                      <small>{punchDisplayLabel(punch, index, selectedDay.punchCount)}</small>
                      <span className={styles.punchChipTime}>{punch.time}</span>
                      {punch.adjustedFrom ? (
                        <span className={styles.punchChipMeta}>Real {punch.adjustedFrom}</span>
                      ) : null}
                      <span className={styles.punchDeleteOverlay} aria-hidden="true">
                        <Trash2 size={14} />
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles.addPunchChip}
                    onClick={() => openAddPunch(selectedDay)}
                    disabled={isSavingPunch || savingDay === selectedDay.dateKey}
                    aria-label={`Agregar picada para ${selectedDay.dateLabel}`}
                    title="Agregar picada"
                  >
                    <Plus size={15} aria-hidden="true" />
                  </button>
                </div>

                {selectedLunchSuggestion ? (
                  <button
                    type="button"
                    className={styles.addLunchButton}
                    onClick={() => addDefaultLunchPunches(selectedDay, selectedLunchSuggestion)}
                    disabled={isSavingPunch || savingDay === selectedDay.dateKey}
                  >
                    Agregar almuerzo
                    <span>{selectedLunchSuggestion.lunchStart} - {selectedLunchSuggestion.lunchEnd}</span>
                  </button>
                ) : null}

                {!selectedIsReviewed ? (
                  <>
                    <div className={styles.modalForm}>
                      {isExtraordinaryDay(selectedDay) ? (
                        <label>
                          <span>HE registradas (min)</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="Ej. 90"
                            value={actionDrafts[selectedDay.dateKey]?.extraordinary ?? ""}
                            onChange={(event) => {
                              updateActionDraft(selectedDay.dateKey, "extraordinary", event.target.value);
                              updateActionDraft(selectedDay.dateKey, "supplementary", "");
                              updateActionDraft(selectedDay.dateKey, "decision", "custom");
                            }}
                          />
                        </label>
                      ) : (
                        <label>
                          <span>HS registradas (min)</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="Ej. 63"
                            value={actionDrafts[selectedDay.dateKey]?.supplementary ?? ""}
                            onChange={(event) => {
                              updateActionDraft(selectedDay.dateKey, "supplementary", event.target.value);
                              updateActionDraft(selectedDay.dateKey, "extraordinary", "");
                              updateActionDraft(selectedDay.dateKey, "decision", "custom");
                            }}
                          />
                        </label>
                      )}
                      <label className={styles.modalNote}>
                        <span>Motivo</span>
                        <textarea
                          rows={3}
                          placeholder="Ej. Se reconocen solo 60 minutos registrados."
                          value={actionDrafts[selectedDay.dateKey]?.note || ""}
                          onChange={(event) => updateActionDraft(selectedDay.dateKey, "note", event.target.value)}
                        />
                      </label>
                    </div>

                    <div className="catalog-actions-block catalog-actions-separated">
                      <span className="catalog-actions-label">Acciones rápidas</span>
                      <div className={styles.quickActionGrid}>
                        {hasAuthorizableTime(selectedDay) ? (
                          <button type="button" className="catalog-button-ghost" onClick={() => applyQuickAction(selectedDay, "full")} disabled={savingDay === selectedDay.dateKey}>Usar registrado</button>
                        ) : null}
                        {selectedHasCleanableAlert ? (
                          <button
                            type="button"
                            className="catalog-button-ghost"
                            onClick={() => cleanDayAlerts(selectedDay)}
                            disabled={savingDay === selectedDay.dateKey}
                          >
                            Limpiar alertas
                          </button>
                        ) : null}
                        {selectedDetectedLateMinutes > 0 ? (
                          <button
                            type="button"
                            className="catalog-button-ghost"
                            onClick={() => applyQuickAction(selectedDay, "justify_late")}
                            disabled={savingDay === selectedDay.dateKey}
                          >
                            Justificar atraso
                          </button>
                        ) : null}
                        {selectedCanUsePlannedDay ? (
                          <button
                            type="button"
                            className="catalog-button-ghost"
                            onClick={() => applyQuickAction(selectedDay, "justify_no_punches")}
                            disabled={savingDay === selectedDay.dateKey}
                          >
                            Usar planificado
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : null}

                <div className="catalog-actions catalog-actions-end catalog-actions-separated">
                  {selectedIsReviewed ? (
                    <button type="button" className="catalog-button-neutral" onClick={() => toggleReviewedDay(selectedDay)} disabled={savingDay === selectedDay.dateKey}>
                      {savingDay === selectedDay.dateKey ? "Reiniciando..." : "Quitar revisado"}
                    </button>
                  ) : (
                    <>
                      {selectedHasSavedDecision ? (
                        <button type="button" className="catalog-button-ghost" onClick={() => resetDayDecision(selectedDay)} disabled={savingDay === selectedDay.dateKey}>
                          {savingDay === selectedDay.dateKey ? "Reiniciando..." : "Reiniciar"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="catalog-button-primary"
                        onClick={() => saveReviewOrAdjustment(selectedDay)}
                        disabled={savingDay === selectedDay.dateKey || savingScheduleDay === selectedDay.dateKey}
                      >
                        {savingDay === selectedDay.dateKey || savingScheduleDay === selectedDay.dateKey
                          ? "Guardando..."
                          : selectedHasPreparedAdjustment || selectedScheduleChanged
                            ? "Guardar cambios"
                            : "Marcar revisado"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </CatalogDrawer>

          <ConfirmDialog
            isOpen={Boolean(pendingBulkDecision)}
            title={bulkDecisionLabel(pendingBulkDecision)}
            message={pendingBulkDecision === "reset"
              ? `Se eliminarán ${savedDecisionDays.length} decisiones guardadas de este mes. El reporte volverá al cálculo automático y reaparecerán los avisos pendientes.`
              : "¿Estás seguro que deseas ajustar todos los días con alertas a lo planificado?"}
            confirmLabel={pendingBulkDecision === "adjust_alerts" ? "Ajustar al plan" : bulkDecisionLabel(pendingBulkDecision)}
            cancelLabel="Cancelar"
            tone={pendingBulkDecision === "reset" ? "danger" : "default"}
            isPending={Boolean(savingBulkAction)}
            confirmDisabled={pendingBulkDecision === "reset" ? !savedDecisionDays.length : !bulkDaysForDecision(pendingBulkDecision).length}
            onCancel={() => {
              if (!savingBulkAction) setPendingBulkDecision("");
            }}
            onConfirm={() => {
              if (pendingBulkDecision === "reset") {
                resetBulkDecisions();
                return;
              }

              saveBulkDecision(pendingBulkDecision);
            }}
          >
            <div className={styles.confirmDetails}>
              <span>Empleado</span>
              <strong>{row.employee.fullName}</strong>
              <span>Mes</span>
              <strong>{month}</strong>
              <span>Acción</span>
              <strong>{pendingBulkDecision === "reset"
                ? `Eliminar ${savedDecisionDays.length} decisiones guardadas`
                : `Ajustar ${alertDays.length} días con alertas a planificación`}</strong>
            </div>
          </ConfirmDialog>

          <ConfirmDialog
            isOpen={Boolean(punchForm)}
            title="Agregar picada"
            message={punchForm ? `Se agregará una picada manual para ${punchForm.dayLabel} ${punchForm.dateLabel}.` : ""}
            confirmLabel="Guardar picada"
            cancelLabel="Cancelar"
            tone="default"
            isPending={isSavingPunch}
            confirmDisabled={!punchForm?.time || String(punchForm?.reason || "").trim().length < 4}
            onCancel={closeAddPunch}
            onConfirm={saveManualPunch}
          >
            <div className={styles.punchMutationForm}>
              <label>
                <span>Día</span>
                <input type="text" value={punchForm ? `${punchForm.dayLabel} ${punchForm.dateLabel}` : ""} readOnly />
              </label>
              <label>
                <span>Hora</span>
                <input
                  type="time"
                  value={punchForm?.time || ""}
                  onChange={(event) => updatePunchForm("time", event.target.value)}
                />
              </label>
              <label className={styles.punchMutationNote}>
                <span>Motivo o nota</span>
                <textarea
                  rows={3}
                  placeholder="Ej. Registro manual por olvido de marcación."
                  value={punchForm?.reason || ""}
                  onChange={(event) => updatePunchForm("reason", event.target.value)}
                />
              </label>
            </div>
          </ConfirmDialog>

          <ConfirmDialog
            isOpen={Boolean(pendingDeletePunch)}
            title="Eliminar picada"
            message={pendingDeletePunch
              ? `Se eliminará la picada de las ${pendingDeletePunch.punch.time} del ${pendingDeletePunch.dateLabel}.`
              : ""}
            confirmLabel="Eliminar picada"
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
