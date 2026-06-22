"use client";

import { useEffect, useRef, useState } from "react";
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

const DEFAULT_LUNCH_LIMIT_MINUTES = 60;

function hasSavedDayDecision(day) {
  return Boolean(day?.authorization?.isSaved);
}

function hasPendingEntryLate(day) {
  return !hasSavedDayDecision(day) && !isExtraordinaryDay(day) && (Number(day?.lateMinutes) || 0) > 0;
}

function hasPendingLunchOverage(day) {
  const plannedLunchMinutes = Number(day?.lunchDiscountMinutes) ||
    Number(day?.lunchDurationMinutes) ||
    DEFAULT_LUNCH_LIMIT_MINUTES;
  const actualLunchMinutes = Number(day?.actualLunchMinutes) || 0;

  return !hasSavedDayDecision(day) && actualLunchMinutes > plannedLunchMinutes;
}

function lunchTotalClass(day) {
  return hasPendingLunchOverage(day)
    ? `${styles.lunchTotal} ${styles.lunchTotalWarning}`
    : styles.lunchTotal;
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

function additionalTimeDisplay(day) {
  return formatMinutes(netDetectedAdditionalMinutes(day));
}

function approvedAdditionalTimeDisplay(day) {
  const authorizedMinutes = isExtraordinaryDay(day)
    ? Number(day?.authorization?.authorizedExtraordinaryMinutes) || 0
    : Number(day?.authorization?.authorizedSupplementaryMinutes) || 0;

  return authorizedMinutes > 0 ? `Aprob. ${formatMinutes(authorizedMinutes)}` : "--";
}

function isExtraordinaryDay(day) {
  return ["holiday", "weekend_overtime", "off_day"].includes(day?.dayType);
}

function additionalKindLabel(day, long = false) {
  if (isExtraordinaryDay(day)) return long ? "Extraordinarias" : "Ext.";
  return long ? "Suplementarias" : "Sup.";
}

function plannedAdditionalMinutes(day) {
  if (isExtraordinaryDay(day)) {
    return Number(day?.plannedExtraordinaryMinutes) || 0;
  }

  return Math.max(
    0,
    (Number(day?.plannedSupplementaryMinutes) || 0) - (Number(day?.lunchOverageRemainderMinutes) || 0),
  );
}

function detectedAdditionalMinutes(day) {
  return isExtraordinaryDay(day)
    ? detectedExtraordinaryMinutes(day)
    : detectedSupplementaryMinutes(day);
}

function netDetectedAdditionalMinutes(day) {
  const issueMinutes = applicableIssueMinutes(day, {
    decision: day?.authorization?.decision || "custom",
    late: minutesToHourInput(defaultAppliedLateMinutes(day)),
  });

  return Math.max(0, detectedAdditionalMinutes(day) - issueMinutes.totalMinutes);
}

function detectedLateIssueMinutes(day) {
  if (isExtraordinaryDay(day)) return 0;

  return Math.max(
    0,
    (Number(day?.lateMinutes) || 0) + (Number(day?.lunchOverageRemainderMinutes) || 0),
  );
}

function defaultAppliedLateMinutes(day) {
  if (!day) return 0;
  if (isExtraordinaryDay(day)) return 0;

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
  if (!day || isExtraordinaryDay(day)) return 0;

  return Math.max(
    detectedLateIssueMinutes(day),
    displayLateMinutes(day),
    hasDayTag(day, "Atraso") ? Number(day.lateMinutes) || 0 : 0,
  );
}

function applicableIssueMinutes(day, draft = {}) {
  const decision = draft.decision || day?.authorization?.decision || "";
  const draftLateMinutes = hourInputToMinutes(draft.late);
  const draftEarlyLeaveMinutes = hourInputToMinutes(draft.earlyLeave);
  const detectedLateMinutes = detectedLateIssueMinutes(day);
  const detectedEarlyLeaveMinutes = Number(day?.authorization?.detectedEarlyLeaveMinutes ?? day?.earlyLeaveMinutes) || 0;
  const lateMinutes = ["pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches", "justify_late"].includes(decision)
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

function hasSevereIssue(day) {
  return (day.tags || []).some((tag) => [
    "Sin picadas",
    "Picadas incompletas",
    "Picadas insuficientes",
    "Atraso",
    "Salida anticipada",
  ].includes(tag));
}

function dayRowClass(day) {
  if (isIgnorableRestDay(day)) return styles.ignoredRestRow;
  const rowClasses = [];

  if (canOpenDayDecision(day)) rowClasses.push(styles.actionableRow);
  if (hasSevereIssue(day)) rowClasses.push(styles.severeIssueRow);
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
  if (["Falta justificada", "Picadas justificadas", "Atraso justificado", "Salida justificada", "Revisado"].includes(tag)) {
    return `${styles.issueTag} ${styles.justifiedTag}`;
  }

  if ([
    "Sin picadas",
    "Picadas incompletas",
    "Picadas insuficientes",
    "Atraso",
    "Salida anticipada",
  ].includes(tag)) return `${styles.issueTag} ${styles.severeTag}`;
  return styles.issueTag;
}

const VISIBLE_DAY_TAGS = new Set([
  "Sin picadas",
  "Picadas incompletas",
  "Picadas insuficientes",
  "Atraso",
  "Salida anticipada",
  "Falta justificada",
  "Picadas justificadas",
  "Atraso justificado",
  "Salida justificada",
  "Dia descontado",
]);

function visibleDayTags(day) {
  const tags = (day.tags || []).filter((tag) => VISIBLE_DAY_TAGS.has(tag));
  const statusLabel = day?.authorization?.statusLabel || "";

  if (["Revisado", "No pagado", "Dia descontado"].includes(statusLabel) && !tags.includes(statusLabel)) {
    tags.push(statusLabel);
  }

  return tags;
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

function currentAuthorizedSupplementaryMinutes(day) {
  return Number(day?.authorization?.authorizedSupplementaryMinutes ?? day?.supplementaryMinutes) || 0;
}

function currentAuthorizedExtraordinaryMinutes(day) {
  return Number(day?.authorization?.authorizedExtraordinaryMinutes ?? day?.extraordinaryMinutes) || 0;
}

function detectedSupplementaryMinutes(day) {
  return Number(day?.detectedSupplementaryMinutes) || 0;
}

function detectedExtraordinaryMinutes(day) {
  return Number(day?.detectedExtraordinaryMinutes) || 0;
}

function issueMinutesAlreadyAppliedToAuthorization(day) {
  return defaultAppliedLateMinutes(day);
}

function draftSupplementaryMinutes(day) {
  if (isExtraordinaryDay(day)) return 0;
  const authorizedMinutes = Number(day?.authorization?.authorizedSupplementaryMinutes);

  if (Number.isFinite(authorizedMinutes)) {
    return authorizedMinutes + issueMinutesAlreadyAppliedToAuthorization(day);
  }

  return plannedAuthorizationMinutes(day).plannedSupplementaryMinutes;
}

function draftExtraordinaryMinutes(day) {
  if (!isExtraordinaryDay(day)) return 0;
  const authorizedMinutes = Number(day?.authorization?.authorizedExtraordinaryMinutes);

  if (Number.isFinite(authorizedMinutes)) {
    return authorizedMinutes + issueMinutesAlreadyAppliedToAuthorization(day);
  }

  return plannedAuthorizationMinutes(day).plannedExtraordinaryMinutes;
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
    Math.max(0, (Number(day.plannedSupplementaryMinutes) || 0) - (Number(day.lunchOverageRemainderMinutes) || 0)),
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
    plannedSupplementaryMinutes: Math.max(
      0,
      (Number(day?.plannedSupplementaryMinutes) || 0) - (Number(day?.lunchOverageRemainderMinutes) || 0),
    ),
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
  const adjustedLateMinutes = ["pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches", "justify_late"].includes(decision)
    ? 0
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
  const issueMinutes = applicableIssueMinutes(day, draft);
  const supplementaryMinutes = isExtraordinary
    ? 0
    : draft.decision === "planned"
      ? Math.min(rawSupplementaryMinutes, Math.max(0, detectedSupplementaryMinutes - issueMinutes.totalMinutes))
      : Math.max(0, rawSupplementaryMinutes - issueMinutes.totalMinutes);
  const extraordinaryMinutes = isExtraordinary
    ? draft.decision === "planned"
      ? Math.min(rawExtraordinaryMinutes, Math.max(0, detectedExtraordinaryMinutes - issueMinutes.totalMinutes))
      : Math.max(0, rawExtraordinaryMinutes - issueMinutes.totalMinutes)
    : 0;
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
  const detectedAdditional = Math.max(0, detectedAdditionalMinutes(day) - issueMinutes.totalMinutes);
  const authorizedAdditional = isExtraordinary ? extraordinaryMinutes : supplementaryMinutes;

  return {
    supplementaryLabel: supplementaryMinutes ? formatMinutes(supplementaryMinutes) : "--",
    extraordinaryLabel: extraordinaryMinutes ? formatMinutes(extraordinaryMinutes) : "--",
    additionalLabel: formatMinutes(authorizedAdditional),
    plannedAdditionalLabel: formatMinutes(plannedAdditional),
    detectedAdditionalLabel: formatMinutes(detectedAdditional),
    authorizedAdditionalLabel: formatMinutes(authorizedAdditional),
    plannedAmountLabel: moneyLabel((plannedAdditional / 60) * hourlyRate * additionalMultiplier),
    detectedAmountLabel: moneyLabel((detectedAdditional / 60) * hourlyRate * additionalMultiplier),
    authorizedAmountLabel: moneyLabel((authorizedAdditional / 60) * hourlyRate * additionalMultiplier),
    additionalKindLabel: additionalKindLabel(day),
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
        ? "Vista previa: falta justificada"
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
    justify_no_punches: "Justificación: día sin picadas autorizado.",
    justify_incomplete_punches: "Justificación: picadas incompletas autorizadas.",
    justify_late: "Justificación: atraso autorizado.",
    justify_early_leave: "Justificación: salida anticipada autorizada.",
    pay_planned_day: "Justificación: día planificado pagado.",
    complete_regular_day: "Justificación: jornada laboral completada sin adicionales.",
  };

  return notes[decision] || "";
}

function bulkDecisionLabel(decision) {
  const labels = {
    full: "Autorizar todo",
    supplementary: "Autorizar suplementarias",
    extraordinary: "Autorizar extraordinarias",
    no_punches: "Justificar faltas",
    incomplete_punches: "Justificar picadas",
    late: "Justificar atrasos",
    early_leave: "Justificar salidas",
    complete_regular_day: "Completar laboral",
    planned: "Ajustar todo al plan",
    reset: "Reiniciar todo",
  };

  return labels[decision] || "Confirmar";
}

function bulkDecisionDescription(decision) {
  const descriptions = {
    full: "Autorizar todas las horas detectadas",
    supplementary: "Autorizar todas las horas suplementarias detectadas",
    extraordinary: "Autorizar todas las horas extraordinarias detectadas",
    no_punches: "Justificar todos los días sin picadas pendientes",
    incomplete_punches: "Justificar todos los días con picadas incompletas pendientes",
    late: "Justificar todos los atrasos pendientes",
    early_leave: "Justificar todas las salidas anticipadas detectadas",
    complete_regular_day: "Completar solo las horas laborables de los días incompletos pendientes, sin autorizar suplementarias ni extraordinarias",
    planned: "Respetar solo las horas planificadas",
    reset: "Eliminar decisiones guardadas",
  };

  return descriptions[decision] || "Actualizar decisiones";
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
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [actionDrafts, setActionDrafts] = useState({});
  const [savingDay, setSavingDay] = useState("");
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
  const pendingDecisionDays = row?.days?.filter((day) => !day.authorization?.isSaved && !isIgnorableRestDay(day)) || [];
  const authorizableDays = pendingDecisionDays.filter((day) => hasAuthorizableTime(day));
  const supplementaryAuthorizableDays = authorizableDays.filter((day) =>
    detectedSupplementaryMinutes(day) > currentAuthorizedSupplementaryMinutes(day),
  );
  const extraordinaryAuthorizableDays = authorizableDays.filter((day) =>
    detectedExtraordinaryMinutes(day) > currentAuthorizedExtraordinaryMinutes(day),
  );
  const noPunchDays = pendingDecisionDays.filter((day) => hasDayTag(day, "Sin picadas"));
  const incompletePunchDays = pendingDecisionDays.filter(hasIncompletePunchTag);
  const lateDays = pendingDecisionDays.filter((day) => unresolvedLateMinutes(day) > 0);
  const earlyLeaveDays = pendingDecisionDays.filter((day) => (Number(day.earlyLeaveMinutes) || 0) > 0);
  const completeRegularDays = pendingDecisionDays.filter((day) => {
    const plannedRegularMinutes = plannedPaidDayMinutes(day).plannedRegularMinutes;
    const regularWorkedMinutes = Math.max(0, Number(day.regularWorkedMinutes) || 0);

    return !isExtraordinaryDay(day) && plannedRegularMinutes > 0 && regularWorkedMinutes < plannedRegularMinutes;
  });
  const savedDecisionDays = row?.days?.filter((day) => day.authorization?.isSaved) || [];
  const selectedDraft = selectedDay ? actionDrafts[selectedDay.dateKey] || {} : {};
  const selectedPreview = selectedDay ? buildDecisionPreview(selectedDay, selectedDraft, row?.summary || {}) : null;
  const selectedHasSavedDecision = Boolean(selectedDay?.authorization?.isSaved);
  const selectedIsReviewed = selectedDay?.authorization?.decision === "reviewed";
  const selectedHasPreparedAdjustment = selectedDay ? hasPreparedAdjustment(selectedDay, selectedDraft) : false;
  const selectedDetectedLateMinutes = selectedDay
    ? unresolvedLateMinutes(selectedDay)
    : 0;
  const selectedDetectedEarlyLeaveMinutes = selectedDay
    ? Number(selectedDay.authorization?.detectedEarlyLeaveMinutes ?? selectedDay.earlyLeaveMinutes) || 0
    : 0;
  const selectedDraftLateMinutes = selectedDay ? hourInputToMinutes(selectedDraft.late) : 0;
  const selectedCanPayPlan = selectedDay
    ? plannedPaidDayMinutes(selectedDay).plannedRegularMinutes > 0 || plannedPaidDayMinutes(selectedDay).plannedSupplementaryMinutes > 0
    : false;
  const selectedCanCompleteRegularDay = selectedDay
    ? !isExtraordinaryDay(selectedDay) && plannedPaidDayMinutes(selectedDay).plannedRegularMinutes > 0
    : false;
  const selectedLunchSuggestion = selectedDay ? lunchPunchSuggestion(selectedDay) : null;

  function syncUrl(nextMonth) {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams();
    params.set("month", nextMonth);

    if (filters.branchCode) params.set("branchCode", filters.branchCode);
    if (filters.areaCode) params.set("areaCode", filters.areaCode);
    if (filters.roleCode) params.set("roleCode", filters.roleCode);

    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  async function loadReport(nextMonth = month, options = {}) {
    try {
      if (!options.background) {
        setIsLoading(true);
      }
      setError("");

      const params = new URLSearchParams();
      params.set("month", nextMonth);
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
  }

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
        : ["justify_late", "justify_early_leave"].includes(decision)
          ? minutesToHourInput(plannedMinutes.plannedSupplementaryMinutes)
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
        : ["justify_late", "justify_early_leave"].includes(decision)
          ? minutesToHourInput(plannedMinutes.plannedExtraordinaryMinutes)
        : decision === "reviewed"
          ? (currentDraft.extraordinary || "")
        : isCompleteRegularDayDecision(decision)
          ? ""
        : isPlannedPaidDecision(decision)
          ? minutesToHourInput(plannedPaidMinutes.plannedExtraordinaryMinutes)
        : decision === "planned"
          ? minutesToHourInput(plannedMinutes.plannedExtraordinaryMinutes)
          : "",
      late: ["pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches", "justify_late"].includes(decision)
        ? ""
        : decision === "reviewed"
          ? (currentDraft.late ?? detectedLateInput)
          : detectedLateInput,
      earlyLeave: ["pay_planned_day", "complete_regular_day", "justify_early_leave", "justify_no_punches", "justify_incomplete_punches"].includes(decision)
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

  function restoreIssueMinutes(day, field, minutes) {
    updateActionDraft(day.dateKey, field, minutesToHourInput(minutes));
    updateActionDraft(day.dateKey, "decision", "custom");
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

  async function saveReviewOrAdjustment(day) {
    if (hasPreparedAdjustment(day, actionDrafts[day.dateKey] || {})) {
      await saveDayAction(day);
      return;
    }

    await toggleReviewedDay(day);
  }

  async function resetDayDecision(day) {
    if (!day.authorization?.isSaved) {
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
    if (decision === "supplementary") return supplementaryAuthorizableDays;
    if (decision === "extraordinary") return extraordinaryAuthorizableDays;
    if (decision === "no_punches") return noPunchDays;
    if (decision === "incomplete_punches") return incompletePunchDays;
    if (decision === "late") return lateDays;
    if (decision === "early_leave") return earlyLeaveDays;
    if (decision === "complete_regular_day") return completeRegularDays;
    return authorizableDays;
  }

  function bulkDraftForDay(day, decision) {
    if (decision === "supplementary") {
      return {
        supplementary: minutesToHourInput(detectedSupplementaryMinutes(day)),
        extraordinary: minutesToHourInput(currentAuthorizedExtraordinaryMinutes(day)),
        late: minutesToHourInput(unresolvedLateMinutes(day)),
        decision: "custom",
        note: "Autorización global: suplementarias autorizadas.",
      };
    }

    if (decision === "extraordinary") {
      return {
        supplementary: minutesToHourInput(currentAuthorizedSupplementaryMinutes(day)),
        extraordinary: minutesToHourInput(detectedExtraordinaryMinutes(day)),
        late: minutesToHourInput(unresolvedLateMinutes(day)),
        earlyLeave: minutesToHourInput(Number(day.earlyLeaveMinutes) || 0),
        decision: "custom",
        note: "Autorización global: extraordinarias autorizadas.",
      };
    }

    if (decision === "early_leave") {
      return {
        supplementary: minutesToHourInput(currentAuthorizedSupplementaryMinutes(day)),
        extraordinary: minutesToHourInput(currentAuthorizedExtraordinaryMinutes(day)),
        late: minutesToHourInput(unresolvedLateMinutes(day)),
        earlyLeave: "",
        decision: "justify_early_leave",
        note: "Justificación global: salida anticipada autorizada.",
      };
    }

    if (decision === "no_punches") {
      return quickActionDraft(day, "justify_no_punches", {});
    }

    if (decision === "incomplete_punches") {
      return quickActionDraft(day, "justify_incomplete_punches", {});
    }

    if (decision === "late") {
      return quickActionDraft(day, "justify_late", {});
    }

    if (decision === "complete_regular_day") {
      return quickActionDraft(day, "complete_regular_day", {
        note: "Ajuste global: jornada laboral completada sin adicionales.",
      });
    }

    return {
      note: decision === "full" ? "Autorización global: todo autorizado." : "Autorización global: ajustado al plan.",
    };
  }

  async function saveBulkDecision(decision) {
    const daysToSave = bulkDaysForDecision(decision);
    const payloadDecision = ["supplementary", "extraordinary"].includes(decision)
      ? "custom"
      : decision === "early_leave"
        ? "justify_early_leave"
        : decision === "no_punches"
          ? "justify_no_punches"
        : decision === "incomplete_punches"
          ? "justify_incomplete_punches"
        : decision === "late"
          ? "justify_late"
        : decision === "complete_regular_day"
          ? "complete_regular_day"
        : decision;

    if (!daysToSave.length) return;

    try {
      setSavingBulkAction(decision);
      setError("");

      for (const day of daysToSave) {
        const response = await fetch("/api/attendance/day-decisions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(authorizationPayloadForDay(employeeId, day, payloadDecision, bulkDraftForDay(day, decision))),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar la autorización global.");
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
  }, []);

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
            <article>
              <span>Sueldo</span>
              <strong>{row.summary.salaryProjectedLabel}</strong>
              <small>Base {row.summary.salaryExpectedLabel}</small>
            </article>
            <article>
              <span>Laborales</span>
              <strong>{minutesBadge(row.summary.regularWorkedLabel)}</strong>
              <small>Plan. {minutesBadge(row.summary.plannedRegularLabel)}</small>
            </article>
            <article>
              <span>Suplementarias</span>
              <strong>{minutesBadge(row.summary.supplementaryLabel)}</strong>
              <small className={styles.metricBreakdown}>
                <span className={styles.metricPill}>
                  <em>Reg.</em>
                  <b>{minutesBadge(row.summary.detectedSupplementaryLabel)}</b>
                </span>
                <span className={`${styles.metricPill} ${styles.metricPillPlanned}`}>
                  <em>Plan.</em>
                  <b>{minutesBadge(row.summary.plannedSupplementaryLabel)}</b>
                </span>
              </small>
            </article>
            <article>
              <span>Extraordinarias</span>
              <strong>{minutesBadge(row.summary.extraordinaryLabel)}</strong>
              <small className={styles.metricBreakdown}>
                <span className={styles.metricPill}>
                  <em>Reg.</em>
                  <b>{minutesBadge(row.summary.detectedExtraordinaryLabel)}</b>
                </span>
                <span className={`${styles.metricPill} ${styles.metricPillPlanned}`}>
                  <em>Plan.</em>
                  <b>{minutesBadge(row.summary.plannedExtraordinaryLabel)}</b>
                </span>
              </small>
            </article>
            <article>
              <span>Atraso total</span>
              <strong>{minutesBadge(row.summary.lateLabel)}</strong>
              <small>{row.summary.lateDays} días con atraso</small>
            </article>
            <article>
              <span>Novedades</span>
              <strong>{row.summary.issueDays} días</strong>
              <small>Revisar antes del cierre</small>
            </article>
          </div>

          <div className={styles.bulkActions}>
            <div className={styles.bulkActionGrid}>
              <section className={styles.bulkActionGroup}>
                <span>Resolver novedades</span>
                <div className="catalog-actions">
                  <button type="button" className="catalog-button-ghost" onClick={() => setPendingBulkDecision("no_punches")} disabled={!noPunchDays.length || Boolean(savingBulkAction)}>
                    {savingBulkAction === "no_punches" ? "Justificando..." : <ActionButtonLabel label="Faltas" count={noPunchDays.length} />}
                  </button>
                  <button type="button" className="catalog-button-ghost" onClick={() => setPendingBulkDecision("incomplete_punches")} disabled={!incompletePunchDays.length || Boolean(savingBulkAction)}>
                    {savingBulkAction === "incomplete_punches" ? "Justificando..." : <ActionButtonLabel label="Picadas" count={incompletePunchDays.length} />}
                  </button>
                  <button type="button" className="catalog-button-ghost" onClick={() => setPendingBulkDecision("late")} disabled={!lateDays.length || Boolean(savingBulkAction)}>
                    {savingBulkAction === "late" ? "Justificando..." : <ActionButtonLabel label="Atrasos" count={lateDays.length} />}
                  </button>
                  <button type="button" className="catalog-button-ghost" onClick={() => setPendingBulkDecision("early_leave")} disabled={!earlyLeaveDays.length || Boolean(savingBulkAction)}>
                    {savingBulkAction === "early_leave" ? "Justificando..." : <ActionButtonLabel label="Salidas" count={earlyLeaveDays.length} />}
                  </button>
                </div>
              </section>

              <section className={styles.bulkActionGroup}>
                <span>Horas adicionales</span>
                <div className="catalog-actions">
                  <button type="button" className="catalog-button-ghost" onClick={() => setPendingBulkDecision("supplementary")} disabled={!supplementaryAuthorizableDays.length || Boolean(savingBulkAction)}>
                    {savingBulkAction === "supplementary" ? "Autorizando..." : <ActionButtonLabel label="Suplementarias" count={supplementaryAuthorizableDays.length} />}
                  </button>
                  <button type="button" className="catalog-button-ghost" onClick={() => setPendingBulkDecision("extraordinary")} disabled={!extraordinaryAuthorizableDays.length || Boolean(savingBulkAction)}>
                    {savingBulkAction === "extraordinary" ? "Autorizando..." : <ActionButtonLabel label="Extraordinarias" count={extraordinaryAuthorizableDays.length} />}
                  </button>
                  <button type="button" className="catalog-button-ghost" onClick={() => setPendingBulkDecision("full")} disabled={!authorizableDays.length || Boolean(savingBulkAction)}>
                    {savingBulkAction === "full" ? "Autorizando..." : <ActionButtonLabel label="Autorizar todo" count={authorizableDays.length} />}
                  </button>
                </div>
              </section>

              <section className={styles.bulkActionGroup}>
                <span>Ajustes</span>
                <div className="catalog-actions">
                  <button type="button" className="catalog-button-ghost" onClick={() => setPendingBulkDecision("complete_regular_day")} disabled={!completeRegularDays.length || Boolean(savingBulkAction)}>
                    {savingBulkAction === "complete_regular_day" ? "Completando..." : <ActionButtonLabel label="Laboral" count={completeRegularDays.length} />}
                  </button>
                  <button type="button" className="catalog-button-primary" onClick={() => setPendingBulkDecision("planned")} disabled={!authorizableDays.length || Boolean(savingBulkAction)}>
                    {savingBulkAction === "planned" ? "Ajustando..." : "Ajustar al plan"}
                  </button>
                  <button type="button" className="catalog-button-ghost" onClick={() => setPendingBulkDecision("reset")} disabled={!savedDecisionDays.length || Boolean(savingBulkAction)}>
                    {savingBulkAction === "reset" ? "Reiniciando..." : <ActionButtonLabel label="Reiniciar" count={savedDecisionDays.length} />}
                  </button>
                </div>
              </section>
            </div>
            <span className={styles.savedDecisionCount}>{savedDecisionDays.length} decisiones guardadas</span>
          </div>

          <div className={styles.tableShell}>
            <div className={styles.tableScroller}>
              <table>
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Horario y picadas</th>
                    <th>Planificado</th>
                    <th>Trabajado</th>
                    <th>Atraso</th>
                    <th>Adicional</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {row.days.map((day) => (
                    <tr
                      key={day.dateKey}
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
                      </td>
                      <td>
                        <div className={styles.timelineCell}>
                          <div className={styles.scheduleLine}>
                            {day.startTime && day.endTime ? (
                              <>
                                <span>{day.startTime}</span>
                                {day.lunchDurationMinutes > 0 ? <span>Almuerzo {formatMinutes(day.lunchDurationMinutes)}</span> : null}
                                {day.plannedSupplementaryMinutes > 0 ? <span>Sup. {formatMinutes(day.plannedSupplementaryMinutes)}</span> : null}
                                <span>{day.endTime}</span>
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
                                <span key={punch.id} className={punchChipClass(day, index)}>
                                  <small>{punchLabel(index, day.punchCount)} </small>
                                  {punch.time}
                                </span>
                              ))
                              : <span><small>Picadas </small>Sin registros</span>}
                            {day.actualLunchMinutes !== null ? (
                              <span className={lunchTotalClass(day)}>
                                <small>ALM TOTAL</small>
                                {day.actualLunchLabel}
                              </span>
                            ) : null}
                          </div>
                          {visibleDayTags(day).length ? (
                            <div className={styles.issueTags}>
                              {visibleDayTags(day).map((tag) => <span key={tag} className={issueTagClass(tag)}>{tag}</span>)}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        {isIgnorableRestDay(day) ? (
                          <strong>--</strong>
                        ) : day.dayType === "holiday" ? (
                          <>
                            <strong>{day.plannedRegularLabel}</strong>
                            <span>Feriado pagado</span>
                          </>
                        ) : day.dayType === "weekend_overtime" ? (
                          <>
                            <strong>{day.scheduledWorkedLabel}</strong>
                            <span>Extra {day.scheduledWorkedLabel}</span>
                          </>
                        ) : day.dayType === "workday" ? (
                          <>
                            <strong>{day.plannedRegularLabel}</strong>
                            {Number(day.plannedSupplementaryMinutes) > 0 ? (
                              <span>Sup. plan. {day.plannedSupplementaryLabel}</span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <strong>{day.dayTypeLabel}</strong>
                            {day.workedMinutes > 0 ? (
                              <span>{day.dayType === "off_day" ? "Trabajo en descanso" : "Trabajo sin horario"}</span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td>
                        <strong>{isIgnorableRestDay(day) ? "--" : day.dayType === "holiday" && day.punchCount === 0 ? day.regularWorkedLabel : day.workedLabel}</strong>
                        {isIgnorableRestDay(day) ? null : (
                          <span>{day.dayType === "holiday" && day.punchCount === 0 ? "Feriado sin picadas" : `${day.punchCount} picadas`}</span>
                        )}
                      </td>
                      <td>
                        {hasPlannedStart(day) ? (
                          <>
                            <strong>{displayLateMinutes(day) ? `${displayLateMinutes(day)}m` : "--"}</strong>
                            <span>Gracia {day.graceMinutes}m</span>
                          </>
                        ) : (
                          <strong>--</strong>
                        )}
                      </td>
                      <td>
                        {isIgnorableRestDay(day) ? (
                          <strong>--</strong>
                        ) : (
                          <div className={styles.extraList}>
                            <span>{additionalTimeDisplay(day)}</span>
                            <span className={styles.approvedAdditional}>{approvedAdditionalTimeDisplay(day)}</span>
                          </div>
                        )}
                      </td>
                      <td>
                        {isIgnorableRestDay(day) ? (
                          <strong>--</strong>
                        ) : (
                          <div className={styles.valueCell}>
                            <strong>{day.pay?.totalLabel || "$0.00"}</strong>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                    <span>Total planificado</span>
                    <strong>{selectedPreview?.plannedAdditionalLabel || "--"}</strong>
                    <small>{selectedPreview?.plannedAmountLabel || "$0.00"}</small>
                  </article>
                  <article>
                    <span>Total detectado</span>
                    <strong>{selectedPreview?.detectedAdditionalLabel || "--"}</strong>
                    <small>{selectedPreview?.detectedAmountLabel || "$0.00"}</small>
                  </article>
                  <article>
                    <span>Total autorizado</span>
                    <strong>{selectedPreview?.authorizedAdditionalLabel || "--"}</strong>
                    <small>{selectedPreview?.authorizedAmountLabel || "$0.00"}</small>
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
                  {selectedDay.punches.map((punch, index) => (
                    <button
                      key={punch.id}
                      type="button"
                      className={styles.punchChipButton}
                      onClick={() => openDeletePunch(selectedDay, punch)}
                      disabled={isSavingPunch || savingDay === selectedDay.dateKey}
                      title="Eliminar picada"
                    >
                      <small>{punchLabel(index, selectedDay.punchCount)}</small>
                      <span className={styles.punchChipTime}>{punch.time}</span>
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
                          <span>Extraordinarias autorizadas (min)</span>
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
                          <span>Suplementarias autorizadas (min)</span>
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
                      {!isExtraordinaryDay(selectedDay) ? (
                        <label>
                          <span>Atraso aplicado (min)</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="Ej. 15"
                            value={actionDrafts[selectedDay.dateKey]?.late ?? ""}
                            onChange={(event) => {
                              updateActionDraft(selectedDay.dateKey, "late", event.target.value);
                              updateActionDraft(selectedDay.dateKey, "decision", "custom");
                            }}
                          />
                        </label>
                      ) : null}
                      <label className={styles.modalNote}>
                        <span>Motivo</span>
                        <textarea
                          rows={3}
                          placeholder="Ej. Se autorizaron solo 4 horas por cierre de inventario."
                          value={actionDrafts[selectedDay.dateKey]?.note || ""}
                          onChange={(event) => updateActionDraft(selectedDay.dateKey, "note", event.target.value)}
                        />
                      </label>
                    </div>

                    <div className="catalog-actions-block catalog-actions-separated">
                      <span className="catalog-actions-label">Acciones rápidas</span>
                      <div className={styles.quickActionGrid}>
                        {hasAuthorizableTime(selectedDay) ? (
                          <button type="button" className="catalog-button-ghost" onClick={() => applyQuickAction(selectedDay, "full")} disabled={savingDay === selectedDay.dateKey}>Autorizar horas</button>
                        ) : null}
                        {selectedCanPayPlan ? (
                          <button type="button" className="catalog-button-ghost" onClick={() => applyQuickAction(selectedDay, "pay_planned_day")} disabled={savingDay === selectedDay.dateKey}>Pagar plan</button>
                        ) : null}
                        {selectedCanCompleteRegularDay ? (
                          <button type="button" className="catalog-button-ghost" onClick={() => applyQuickAction(selectedDay, "complete_regular_day")} disabled={savingDay === selectedDay.dateKey}>Completar laboral</button>
                        ) : null}
                        {hasDayTag(selectedDay, "Sin picadas") ? (
                          <button type="button" className="catalog-button-ghost" onClick={() => applyQuickAction(selectedDay, "justify_no_punches")} disabled={savingDay === selectedDay.dateKey}>Justificar falta</button>
                        ) : null}
                        {hasIncompletePunchTag(selectedDay) ? (
                          <button type="button" className="catalog-button-ghost" onClick={() => applyQuickAction(selectedDay, "justify_incomplete_punches")} disabled={savingDay === selectedDay.dateKey}>Justificar picadas</button>
                        ) : null}
                        {selectedDetectedLateMinutes > 0 ? (
                          <button
                            type="button"
                            className="catalog-button-ghost"
                            onClick={() => {
                              if (selectedDraftLateMinutes > 0) applyQuickAction(selectedDay, "justify_late");
                              else restoreIssueMinutes(selectedDay, "late", selectedDetectedLateMinutes);
                            }}
                            disabled={savingDay === selectedDay.dateKey}
                          >
                            {selectedDraftLateMinutes > 0 ? "Justificar atraso" : "Aplicar atraso"}
                          </button>
                        ) : null}
                        {selectedDetectedEarlyLeaveMinutes > 0 ? (
                          <button
                            type="button"
                            className="catalog-button-ghost"
                            onClick={() => applyQuickAction(selectedDay, "justify_early_leave")}
                            disabled={savingDay === selectedDay.dateKey || selectedDraft.decision === "justify_early_leave"}
                          >
                            Justificar salida
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
                      <button type="button" className="catalog-button-primary" onClick={() => saveReviewOrAdjustment(selectedDay)} disabled={savingDay === selectedDay.dateKey}>
                        {savingDay === selectedDay.dateKey
                          ? "Guardando..."
                          : selectedHasPreparedAdjustment
                            ? "Guardar ajuste"
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
              : `Se aplicará a ${bulkDaysForDecision(pendingBulkDecision).length} días pendientes. Los días con una decisión guardada se respetan y se omiten. Cada cambio quedará registrado en auditoría.`}
            confirmLabel={pendingBulkDecision === "planned" ? "Ajustar al plan" : bulkDecisionLabel(pendingBulkDecision)}
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
                : bulkDecisionDescription(pendingBulkDecision)}</strong>
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
