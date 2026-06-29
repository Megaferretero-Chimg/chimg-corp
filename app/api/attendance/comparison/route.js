import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import { attendancePayrollPolicy } from "@/lib/attendance/exemptions";
import { dedupePunchesByMinute } from "@/lib/attendance/punchIdentity";
import {
  formatEcuadorDate,
  formatEcuadorDateKey,
  formatEcuadorMonthKey,
  formatEcuadorTime,
  makeEcuadorDate,
  setEcuadorTime,
} from "@/lib/datetime/ecuador";
import connectToDatabase from "@/lib/db/mongodb";
import { buildEmployeeActiveInMonthQuery, isEmployeeDismissedInMonth } from "@/lib/employees";
import { buildGeneratedDays } from "@/lib/planning/scheduleAssignments";
import AttendanceDayDecision from "@/models/AttendanceDayDecision";
import { parseMonthKey } from "@/lib/planning/holidays";
import AttendancePunch from "@/models/AttendancePunch";
import BaseScheduleTemplate from "@/models/BaseScheduleTemplate";
import Employee from "@/models/Employee";
import Holiday from "@/models/Holiday";
import LaborRuleConfig from "@/models/LaborRuleConfig";
import OperationalException from "@/models/OperationalException";
import ScheduleAssignment from "@/models/ScheduleAssignment";
import VacationRequest from "@/models/VacationRequest";

const REGULAR_DAY_MINUTES = 8 * 60;
const MIN_TWO_PUNCH_SPAN_MINUTES = 60;
const MIN_EXTRAORDINARY_TWO_PUNCH_SPAN_MINUTES = 30;
const MIN_REAL_LUNCH_MINUTES = 5;
const MAX_REAL_LUNCH_MINUTES = 180;
const SUPPLEMENTARY_SURCHARGE_MULTIPLIER = 0.5;
const EXTRAORDINARY_SURCHARGE_MULTIPLIER = 1;
const VARIABLE_SCHEDULE_AREA_CODES = new Set(["ALM", "BOD"]);
const ATTENDANCE_ISSUE_TAGS = new Set([
  "Sin picadas",
  "Picadas incompletas",
  "Picadas insuficientes",
  "Atraso",
  "Salida anticipada",
]);
const UNPLANNED_WORK_TAGS = new Set(["No planificado", "Trabajo sin horario"]);
const WEEKDAY_LABEL_FORMATTER = new Intl.DateTimeFormat("es-EC", {
  weekday: "short",
  timeZone: "America/Guayaquil",
});

function currentMonthKey() {
  return formatEcuadorMonthKey();
}

function minutesLabel(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const rest = value % 60;

  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function moneyLabel(value) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function buildDailyPay(day, hourlyRate) {
  const items = [];

  function addItem(label, minutes, multiplier = 1, sign = 1) {
    const safeMinutes = Math.max(0, Number(minutes) || 0);
    if (!safeMinutes) return;

    const amount = (safeMinutes / 60) * hourlyRate * multiplier * sign;
    items.push({
      label,
      minutes: safeMinutes,
      minutesLabel: minutesLabel(safeMinutes),
      multiplier,
      rawAmount: amount,
      amount: money(amount),
      amountLabel: moneyLabel(amount),
      isDeduction: sign < 0,
    });
  }

  addItem("Suplementaria", day.supplementaryMinutes, SUPPLEMENTARY_SURCHARGE_MULTIPLIER);
  addItem("Extraordinaria", day.extraordinaryMinutes, EXTRAORDINARY_SURCHARGE_MULTIPLIER);

  const total = items.reduce((sum, item) => sum + item.rawAmount, 0);

  return {
    items,
    rawTotal: total,
    total: money(total),
    totalLabel: moneyLabel(total),
  };
}

function toId(value) {
  return value?._id?.toString?.() || value?.toString?.() || "";
}

function combineDateAndTime(dateKey, timeValue) {
  if (!timeValue) return null;

  const [hours, minutes] = String(timeValue).split(":").map(Number);

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

  return setEcuadorTime(new Date(`${dateKey}T12:00:00.000Z`), {
    hours,
    minutes,
    seconds: 0,
    milliseconds: 0,
  });
}

function isPlannedWorkDay(day) {
  return ["workday", "weekend_overtime"].includes(day?.dayType);
}

function isPlannedPaidDay(day) {
  return ["workday", "weekend_overtime", "holiday", "vacation"].includes(day?.dayType);
}

function isExtraordinaryAttendanceDay(day) {
  return ["holiday", "weekend_overtime", "off_day"].includes(day?.dayType);
}

function minimumTwoPunchSpanMinutes(day, employee = {}) {
  const areaCode = String(employee?.areaCode || "").trim().toUpperCase();
  const roleCode = String(employee?.roleCode || "").trim().toUpperCase();

  if (areaCode === "BOD" && roleCode === "TECBOD" && isExtraordinaryAttendanceDay(day)) {
    return MIN_EXTRAORDINARY_TWO_PUNCH_SPAN_MINUTES;
  }

  return MIN_TWO_PUNCH_SPAN_MINUTES;
}

function isWeekendDateKey(dateKey) {
  const day = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();

  return day === 0 || day === 6;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function monthKeyFromDateKey(dateKey) {
  return String(dateKey || "").slice(0, 7);
}

function weekStartKey(dateKey) {
  const day = new Date(`${dateKey}T12:00:00.000Z`);
  const dayOfWeek = day.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const monday = addDays(day, -daysSinceMonday);

  return monday.toISOString().slice(0, 10);
}

function getWeekContextRange(monthStart, nextMonthStart) {
  const startKey = formatEcuadorDateKey(monthStart);
  const lastMonthDate = addDays(nextMonthStart, -1);
  const lastKey = formatEcuadorDateKey(lastMonthDate);
  const startDayOfWeek = new Date(`${startKey}T12:00:00.000Z`).getUTCDay();
  const lastDayOfWeek = new Date(`${lastKey}T12:00:00.000Z`).getUTCDay();
  const daysSinceMonday = (startDayOfWeek + 6) % 7;
  const daysUntilNextMonday = lastDayOfWeek === 0 ? 1 : 8 - lastDayOfWeek;

  return {
    contextStart: addDays(monthStart, -daysSinceMonday),
    contextEnd: addDays(lastMonthDate, daysUntilNextMonday),
  };
}

function dayTypeLabel(dayType) {
  const labels = {
    workday: "Laboral",
    weekend_overtime: "Extra",
    holiday: "Feriado",
    vacation: "Vacacion",
    off_day: "Descanso",
  };

  return labels[dayType] || dayType || "Sin horario";
}

function buildScheduleLabel(day) {
  if (!day) return "Sin horario";
  if (!isPlannedWorkDay(day)) return dayTypeLabel(day.dayType);

  if (day.lunchStartTime && day.lunchEndTime) {
    return `${day.startTime || "--"} - ${day.lunchStartTime} / ${day.lunchEndTime} - ${day.endTime || "--"}`;
  }

  return `${day.startTime || "--"} - ${day.endTime || "--"}`;
}

function resolveScheduledMinutes(day) {
  if (!isPlannedWorkDay(day)) {
    return {
      scheduledWorkedMinutes: 0,
      plannedRegularMinutes: 0,
      plannedSupplementaryMinutes: 0,
    };
  }

  const scheduleStart = combineDateAndTime(day.dateKey, day.startTime);
  const scheduleEnd = combineDateAndTime(day.dateKey, day.endTime);

  if (!scheduleStart || !scheduleEnd || scheduleEnd <= scheduleStart) {
    return {
      scheduledWorkedMinutes: 0,
      plannedRegularMinutes: 0,
      plannedSupplementaryMinutes: 0,
    };
  }

  const lunchDiscount = Number(day.lunchDurationMinutes) || 0;
  const scheduledWorkedMinutes = Math.max(0, Math.round((scheduleEnd - scheduleStart) / 60000) - lunchDiscount);
  const authorizedSupplementaryMinutes = Math.max(0, Number(day.authorizedExtraMinutes) || 0);
  const plannedRegularMinutes = day.dayType === "workday"
    ? Math.min(scheduledWorkedMinutes, REGULAR_DAY_MINUTES)
    : 0;
  const plannedSupplementaryMinutes = day.dayType === "workday"
    ? Math.min(Math.max(0, scheduledWorkedMinutes - plannedRegularMinutes), authorizedSupplementaryMinutes)
    : 0;

  return {
    scheduledWorkedMinutes,
    plannedRegularMinutes,
    plannedSupplementaryMinutes,
  };
}

function resolveScheduledNetMinutes(day) {
  const scheduleStart = combineDateAndTime(day?.dateKey, day?.startTime);
  const scheduleEnd = combineDateAndTime(day?.dateKey, day?.endTime);

  if (!scheduleStart || !scheduleEnd || scheduleEnd <= scheduleStart) {
    return 0;
  }

  return Math.max(
    0,
    Math.round((scheduleEnd - scheduleStart) / 60000) - (Number(day?.lunchDurationMinutes) || 0),
  );
}

function resolvePlannedExtraordinaryMinutes(day) {
  if (day?.payrollPolicy?.appliesExtraordinaryHours === false) {
    return 0;
  }

  const plannedDayType = day?.plannedDayType || day?.dayType;

  if (plannedDayType === "weekend_overtime") {
    return Number(day.originalScheduledWorkedMinutes) || Number(day.scheduledWorkedMinutes) || resolveScheduledNetMinutes(day);
  }

  if (plannedDayType === "holiday") {
    return Number(day.originalScheduledWorkedMinutes) || resolveScheduledNetMinutes(day);
  }

  return 0;
}

function resolvePlannedRegularMinutes(day) {
  return Number(day?.originalPlannedRegularMinutes ?? day?.plannedRegularMinutes) || 0;
}

function resolvePlannedSupplementaryMinutes(day) {
  return Number(day?.originalPlannedSupplementaryMinutes ?? day?.plannedSupplementaryMinutes) || 0;
}

function resolveActualLunchMinutes(sortedPunches) {
  if (sortedPunches.length < 4) return null;

  const lunchOut = sortedPunches[1];
  const lunchIn = sortedPunches[2];

  if (!lunchOut || !lunchIn || lunchIn.punchedAt <= lunchOut.punchedAt) return null;

  const lunchMinutes = Math.max(0, Math.round((lunchIn.punchedAt - lunchOut.punchedAt) / 60000));

  if (lunchMinutes < MIN_REAL_LUNCH_MINUTES || lunchMinutes > MAX_REAL_LUNCH_MINUTES) return null;

  return lunchMinutes;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function resolveConfiguredLunchMinutes(laborRules, employee = {}) {
  const areaCode = normalizeCode(employee.areaCode);
  const roleCode = normalizeCode(employee.roleCode);
  const employeeId = toId(employee);
  const employeeName = normalizeCode(employee.fullName);
  const employeeRule = (laborRules?.employeeLunchRules || []).find((rule) => {
    const ruleEmployeeId = String(rule.employeeId || "").trim();
    const ruleEmployeeName = normalizeCode(rule.employeeName);

    return (
      (ruleEmployeeId && ruleEmployeeId === employeeId) ||
      (!ruleEmployeeId && ruleEmployeeName && ruleEmployeeName === employeeName)
    );
  });

  if (employeeRule) {
    return Math.max(0, Number(employeeRule.lunchDurationMinutes) || 0);
  }

  const roleRule = (laborRules?.roleLunchRules || []).find((rule) =>
    normalizeCode(rule.areaCode) === areaCode && normalizeCode(rule.roleCode) === roleCode,
  );

  if (roleRule) {
    return Math.max(0, Number(roleRule.lunchDurationMinutes) || 0);
  }

  const areaRule = (laborRules?.areaLunchRules || []).find((rule) =>
    normalizeCode(rule.areaCode) === areaCode,
  );

  if (areaRule) {
    return Math.max(0, Number(areaRule.lunchDurationMinutes) || 0);
  }

  return 60;
}

function applyLunchPolicyByDay(day, employee = {}, laborRules = {}) {
  const dayOfWeek = new Date(`${day?.dateKey}T12:00:00.000Z`).getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const configuredLunchMinutes = resolveConfiguredLunchMinutes(laborRules, employee);

  if (!day?.startTime || !day?.endTime) {
    return day;
  }

  if (!isWeekend) {
    return {
      ...day,
      lunchDurationMinutes: configuredLunchMinutes,
    };
  }

  const scheduleStart = combineDateAndTime(day.dateKey, day.startTime);
  const scheduleEnd = combineDateAndTime(day.dateKey, day.endTime);

  if (!scheduleStart || !scheduleEnd || scheduleEnd <= scheduleStart) {
    return day;
  }

  const grossMinutes = Math.max(0, Math.round((scheduleEnd - scheduleStart) / 60000));
  const isFullWeekendShift = grossMinutes >= REGULAR_DAY_MINUTES;

  return {
    ...day,
    lunchDurationMinutes: isFullWeekendShift ? 60 : 0,
  };
}

function resolveHolidayLunchDiscountMinutes(laborRules, employee = {}) {
  const areaCode = normalizeCode(employee.areaCode);
  const configuredLunchMinutes = resolveConfiguredLunchMinutes(laborRules, employee);

  if (areaCode === "ALM") {
    return Math.max(configuredLunchMinutes, 90);
  }

  return configuredLunchMinutes;
}

function buildReferenceDaysInRange(contextStart, contextEnd, holidayDateKeys = new Set()) {
  const days = [];

  for (let date = contextStart; date < contextEnd; date = addDays(date, 1)) {
    const dateKey = formatEcuadorDateKey(date);

    days.push({
      dateKey,
      label: WEEKDAY_LABEL_FORMATTER.format(date).replace(".", ""),
      dayType: holidayDateKeys.has(dateKey) ? "holiday" : "off_day",
      startTime: "",
      endTime: "",
      lunchDurationMinutes: 0,
      authorizedExtraMinutes: 0,
      graceMinutes: null,
      source: "calendar",
    });
  }

  return days;
}

function mergeReferenceDaysWithAssignment(referenceDays, assignment) {
  const assignmentDaysByDate = new Map(
    (assignment?.generatedDays || []).map((day) => [day.dateKey, day]),
  );

  return referenceDays.map((referenceDay) => {
    const assignmentDay = assignmentDaysByDate.get(referenceDay.dateKey) || {};

    if (referenceDay.dayType === "holiday") {
      return {
        ...referenceDay,
        dayOfWeek: assignmentDay.dayOfWeek ?? referenceDay.dayOfWeek,
        label: assignmentDay.label || referenceDay.label,
        graceMinutes: assignmentDay.graceMinutes ?? referenceDay.graceMinutes,
        source: "holiday",
      };
    }

    return {
      ...referenceDay,
      ...assignmentDay,
    };
  });
}

function buildFixedScheduleFallbackAssignments({ employees = [], templates = [], monthKeys = [], holidays = [] }) {
  const templatesByRole = new Map();
  const templatesByArea = new Map();
  const holidaysByMonth = new Map();
  const assignments = [];

  templates.forEach((template) => {
    const areaCode = String(template.areaCode || "").trim().toUpperCase();
    const roleCode = String(template.roleCode || "").trim().toUpperCase();

    if (!areaCode || VARIABLE_SCHEDULE_AREA_CODES.has(areaCode)) {
      return;
    }

    if (!roleCode) {
      if (!templatesByArea.has(areaCode)) {
        templatesByArea.set(areaCode, template);
      }

      return;
    }

    const key = `${areaCode}|${roleCode}`;

    if (!templatesByRole.has(key)) {
      templatesByRole.set(key, template);
    }
  });

  holidays.forEach((holiday) => {
    const holidayMonthKey = monthKeyFromDateKey(holiday.dateKey);

    if (!holidaysByMonth.has(holidayMonthKey)) {
      holidaysByMonth.set(holidayMonthKey, []);
    }

    holidaysByMonth.get(holidayMonthKey).push(holiday);
  });

  employees.forEach((employee) => {
    const areaCode = String(employee.areaCode || "").trim().toUpperCase();
    const roleCode = String(employee.roleCode || "").trim().toUpperCase();
    const template = templatesByRole.get(`${areaCode}|${roleCode}`) || templatesByArea.get(areaCode);

    if (!template) {
      return;
    }

    monthKeys.forEach((fallbackMonthKey) => {
      assignments.push({
        monthKey: fallbackMonthKey,
        employee: employee._id,
        employeeName: employee.fullName || "",
        areaCode: template.areaCode || employee.areaCode || "",
        areaName: template.areaName || employee.areaName || "",
        roleCode: template.roleCode || employee.roleCode || "",
        roleName: template.roleName || employee.roleName || "",
        template: template._id,
        templateName: template.name || "",
        rotationGroup: template.rotationGroup || "",
        generatedDays: buildGeneratedDays(fallbackMonthKey, template, holidaysByMonth.get(fallbackMonthKey) || []),
        weeklyPlan: [],
        source: "fixed_template",
      });
    });
  });

  return assignments;
}

function buildVacationDateKeysByEmployee(vacations = []) {
  const byEmployee = new Map();

  vacations.forEach((vacation) => {
    const employeeId = toId(vacation.employee);
    const startKey = vacation.startDateKey;
    const endKey = vacation.endDateKey;

    if (!employeeId || !startKey || !endKey) return;
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, new Set());

    const keys = byEmployee.get(employeeId);

    for (let date = new Date(`${startKey}T12:00:00.000Z`); formatEcuadorDateKey(date) <= endKey; date = addDays(date, 1)) {
      keys.add(formatEcuadorDateKey(date));
    }
  });

  return byEmployee;
}

function applyVacationDay(day, vacationDateKeys = new Set()) {
  if (!vacationDateKeys.has(day.dateKey)) return day;
  if (day.dayType === "holiday" || day.dayType === "off_day") return day;

  return {
    ...day,
    dayType: "vacation",
    source: "vacation",
  };
}

function resolveEmploymentStartDateKey(employee = {}) {
  const value = employee.employmentStartDate || employee.startDate || employee.hireDate || null;
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return formatEcuadorDateKey(date);
}

function resolveTerminationDateKey(employee = {}) {
  const value = employee.terminationDate || null;
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return formatEcuadorDateKey(date);
}

function applyEmploymentStartDay(day, employmentStartDateKey = "") {
  if (!employmentStartDateKey || day.dateKey >= employmentStartDateKey) return day;

  return {
    ...day,
    dayType: "off_day",
    startTime: "",
    endTime: "",
    lunchDurationMinutes: 0,
    authorizedExtraMinutes: 0,
    source: "employment_pending",
  };
}

function applyEmploymentEndDay(day, terminationDateKey = "") {
  if (!terminationDateKey || day.dateKey <= terminationDateKey) return day;

  return {
    ...day,
    dayType: "off_day",
    startTime: "",
    endTime: "",
    lunchDurationMinutes: 0,
    authorizedExtraMinutes: 0,
    source: "employment_ended",
  };
}

function countBaseLaborDays(referenceDays) {
  return referenceDays.filter((day) => (
    !isWeekendDateKey(day.dateKey) && day.dayType !== "holiday"
  )).length;
}

function cleanPayrollTags(tags) {
  return tags.filter((tag) =>
    !["Suplementaria", "Suplementarias adicionales", "Extraordinaria", "Todo autorizado"].includes(tag),
  );
}

function isAttendanceIssueTag(tag) {
  return ATTENDANCE_ISSUE_TAGS.has(tag);
}

function hasAssignedScheduleDay(day) {
  return day?.source !== "calendar";
}

function isRestOrWeekendDay(day) {
  return hasAssignedScheduleDay(day) && day.dayType === "off_day";
}

function hasWorkWithoutScheduleTag(day) {
  const tags = day?.tags || [];

  return tags.some((tag) => UNPLANNED_WORK_TAGS.has(tag));
}

function buildDayDecisionMap(decisions = []) {
  return new Map(decisions.map((decision) => [`${toId(decision.employee)}|${decision.dateKey}`, decision]));
}

function buildOperationalExceptionDecisionMap(exceptions = []) {
  const decisions = new Map();

  exceptions.forEach((exception) => {
    if (!["complete_scheduled_time", "paid_leave", "approved_work_time", "discount_day"].includes(exception.resolution)) return;

    const employeeId = toId(exception.employee);
    if (!employeeId || !exception.dateKey) return;

    const scope = exception.scope || "full_day";
    if (scope === "partial_day" || scope === "other") return;

    const startKey = exception.dateKey;
    const endKey = exception.endDateKey || startKey;
    const decision = exception.resolution === "discount_day"
      ? "discount_day"
      : scope === "early_leave"
      ? "justify_early_leave"
      : scope === "late_arrival"
        ? "justify_late"
      : scope === "missing_punch"
        ? "justify_incomplete_punches"
      : "complete_regular_day";
    const baseDecision = {
      employee: exception.employee,
      decision,
      note: [
        "Justificacion operativa",
        exception.resolutionNotes || exception.notes || "",
      ].filter(Boolean).join(": "),
      decidedBy: exception.authorizedBy || exception.registeredBy || "JUSTIFICACION OPERATIVA",
      source: "operational_exception",
    };

    for (let cursor = new Date(`${startKey}T12:00:00.000Z`); formatEcuadorDateKey(cursor) <= endKey; cursor = addDays(cursor, 1)) {
      const dateKey = formatEcuadorDateKey(cursor);
      decisions.set(`${employeeId}|${dateKey}`, {
        ...baseDecision,
        dateKey,
      });
    }
  });

  return decisions;
}

function justifiedIntervalMinutes(exception) {
  if (!exception?.startTime || !exception?.endTime) return 0;

  const start = combineDateAndTime(exception.dateKey, exception.startTime);
  let end = combineDateAndTime(exception.dateKey, exception.endTime);

  if (!start || !end) return 0;

  if (end <= start) {
    end = addDays(end, 1);
  }

  return Math.max(0, Math.round((end - start) / 60000));
}

function buildJustifiedWorkIntervalMap(exceptions = []) {
  const intervalsByKey = new Map();

  exceptions.forEach((exception) => {
    if (exception.resolution !== "approved_work_time") return;
    if (exception.countsAsWorkedTime === false) return;

    const employeeId = toId(exception.employee);
    const minutes = justifiedIntervalMinutes(exception);

    if (!employeeId || !exception.dateKey || !minutes) return;

    const startKey = exception.dateKey;
    const endKey = exception.endDateKey || startKey;

    for (let cursor = new Date(`${startKey}T12:00:00.000Z`); formatEcuadorDateKey(cursor) <= endKey; cursor = addDays(cursor, 1)) {
      const dateKey = formatEcuadorDateKey(cursor);
      const key = `${employeeId}|${dateKey}`;

      if (!intervalsByKey.has(key)) {
        intervalsByKey.set(key, []);
      }

      intervalsByKey.get(key).push({
        minutes,
        startTime: exception.startTime || "",
        endTime: exception.endTime || "",
        destination: exception.destination || "",
        allowSupplementaryTime: exception.allowSupplementaryTime !== false,
        note: exception.resolutionNotes || exception.notes || "",
        decidedBy: exception.authorizedBy || exception.registeredBy || "",
      });
    }
  });

  return intervalsByKey;
}

function buildDiscountedWorkIntervalMap(exceptions = []) {
  const intervalsByKey = new Map();

  exceptions.forEach((exception) => {
    if (exception.resolution !== "discount_day") return;

    const employeeId = toId(exception.employee);
    const minutes = justifiedIntervalMinutes(exception);

    if (!employeeId || !exception.dateKey || !minutes) return;

    const startKey = exception.dateKey;
    const endKey = exception.endDateKey || startKey;

    for (let cursor = new Date(`${startKey}T12:00:00.000Z`); formatEcuadorDateKey(cursor) <= endKey; cursor = addDays(cursor, 1)) {
      const dateKey = formatEcuadorDateKey(cursor);
      const key = `${employeeId}|${dateKey}`;

      if (!intervalsByKey.has(key)) {
        intervalsByKey.set(key, []);
      }

      intervalsByKey.get(key).push({
        minutes,
        startTime: exception.startTime || "",
        endTime: exception.endTime || "",
        note: exception.resolutionNotes || exception.notes || "",
        decidedBy: exception.authorizedBy || exception.registeredBy || "",
      });
    }
  });

  return intervalsByKey;
}

function buildExceptionPlannedScheduleMap(exceptions = []) {
  const schedulesByKey = new Map();

  exceptions.forEach((exception) => {
    if (exception.scope === "other") return;
    if (!exception.plannedStartTime || !exception.plannedEndTime) return;

    const employeeId = toId(exception.employee);
    if (!employeeId || !exception.dateKey) return;

    const startKey = exception.dateKey;
    const endKey = exception.endDateKey || startKey;

    for (let cursor = new Date(`${startKey}T12:00:00.000Z`); formatEcuadorDateKey(cursor) <= endKey; cursor = addDays(cursor, 1)) {
      const dateKey = formatEcuadorDateKey(cursor);
      schedulesByKey.set(`${employeeId}|${dateKey}`, {
        dateKey,
        dayType: "workday",
        startTime: exception.plannedStartTime || "",
        endTime: exception.plannedEndTime || "",
        lunchStartTime: exception.plannedLunchStartTime || "",
        lunchEndTime: exception.plannedLunchEndTime || "",
        lunchDurationMinutes: Number(exception.plannedLunchDurationMinutes) || 0,
        authorizedExtraMinutes: 0,
        source: "operational_exception_schedule",
      });
    }
  });

  return schedulesByKey;
}

function applyExceptionPlannedSchedule(day, plannedSchedule) {
  if (!plannedSchedule) return day;

  return {
    ...day,
    ...plannedSchedule,
    label: day.label,
  };
}

function applyWeeklyExtraDayTypes(days = []) {
  const weeks = new Map();

  days.forEach((day) => {
    const key = weekStartKey(day.dateKey);

    if (!weeks.has(key)) {
      weeks.set(key, []);
    }

    weeks.get(key).push(day);
  });

  const byDate = new Map();

  weeks.forEach((weekDays) => {
    let workedDayCount = 0;

    [...weekDays]
      .sort((left, right) => String(left.dateKey || "").localeCompare(String(right.dateKey || "")))
      .forEach((day) => {
        if (!isPlannedWorkDay(day) || !day.startTime || !day.endTime) {
          byDate.set(day.dateKey, day);
          return;
        }

        workedDayCount += 1;

        if (workedDayCount <= 5 || day.dayType === "weekend_overtime") {
          byDate.set(day.dateKey, day);
          return;
        }

        byDate.set(day.dateKey, {
          ...day,
          dayType: "weekend_overtime",
          authorizedExtraMinutes: resolveScheduledNetMinutes(day),
          source: day.source || "weekly_extra_rule",
        });
      });
  });

  return days.map((day) => byDate.get(day.dateKey) || day);
}

function applyWeeklyExtraByAttendance(days = []) {
  const weeks = new Map();

  days.forEach((day) => {
    const key = weekStartKey(day.dateKey);

    if (!weeks.has(key)) {
      weeks.set(key, []);
    }

    weeks.get(key).push(day);
  });

  const byDate = new Map();

  weeks.forEach((weekDays) => {
    let actualWorkedDayCount = 0;

    [...weekDays]
      .sort((left, right) => String(left.dateKey || "").localeCompare(String(right.dateKey || "")))
      .forEach((day) => {
        const workedMinutes = Math.max(0, Number(day.workedMinutes) || 0);
        const isWorkedAttendanceDay = workedMinutes > 0 && !["holiday", "vacation"].includes(day.dayType);

        if (!isWorkedAttendanceDay) {
          byDate.set(day.dateKey, day);
          return;
        }

        actualWorkedDayCount += 1;

        if (actualWorkedDayCount <= 5) {
          const plannedRegularMinutes = Math.max(
            Number(day.plannedRegularMinutes) || 0,
            Math.min(workedMinutes, REGULAR_DAY_MINUTES),
          );
          const scheduledWorkedMinutes = Math.max(Number(day.scheduledWorkedMinutes) || 0, workedMinutes);

          byDate.set(day.dateKey, {
            ...day,
            dayType: "workday",
            dayTypeLabel: dayTypeLabel("workday"),
            scheduleLabel: day.scheduleLabel || dayTypeLabel("workday"),
            plannedRegularMinutes,
            plannedRegularLabel: plannedRegularMinutes ? minutesLabel(plannedRegularMinutes) : "--",
            plannedSupplementaryMinutes: Number(day.plannedSupplementaryMinutes) || 0,
            plannedSupplementaryLabel: day.plannedSupplementaryMinutes ? minutesLabel(day.plannedSupplementaryMinutes) : "--",
            scheduledWorkedMinutes,
            scheduledWorkedLabel: scheduledWorkedMinutes ? minutesLabel(scheduledWorkedMinutes) : "--",
            authorizedExtraMinutes: 0,
            weeklyAttendanceClassification: "regular",
          });
          return;
        }

        byDate.set(day.dateKey, {
          ...day,
          dayType: "weekend_overtime",
          dayTypeLabel: dayTypeLabel("weekend_overtime"),
          scheduleLabel: dayTypeLabel("weekend_overtime"),
          plannedRegularMinutes: 0,
          plannedRegularLabel: "--",
          plannedSupplementaryMinutes: 0,
          plannedSupplementaryLabel: "--",
          scheduledWorkedMinutes: workedMinutes,
          scheduledWorkedLabel: minutesLabel(workedMinutes),
          authorizedExtraMinutes: workedMinutes,
          weeklyAttendanceClassification: "extra",
          source: day.source || "weekly_attendance_rule",
        });
      });
  });

  return days.map((day) => byDate.get(day.dateKey) || day);
}

function applyJustifiedWorkIntervals(day, intervals = []) {
  if (!intervals.length) return day;

  const justifiedWorkMinutes = intervals.reduce((total, interval) => total + Math.max(0, Number(interval.minutes) || 0), 0);

  if (!justifiedWorkMinutes) return day;

  const nextTags = cleanPayrollTags(day.tags || [])
    .filter((tag) => !["Sin picadas", "Salida anticipada", "Atraso"].includes(tag));
  const allowSupplementaryTime = intervals.some((interval) => interval.allowSupplementaryTime !== false);
  const workedMinutes = (Number(day.workedMinutes) || 0) + justifiedWorkMinutes;
  const plannedRegularMinutes = Number(day.plannedRegularMinutes) || REGULAR_DAY_MINUTES;
  const regularFloor = Math.min(workedMinutes, plannedRegularMinutes);

  return {
    ...day,
    tags: [...new Set([...nextTags, "Trabajo fuera justificado"])],
    hasIssue: nextTags.some(isAttendanceIssueTag),
    workedMinutes,
    workedLabel: workedMinutes ? minutesLabel(workedMinutes) : "--",
    regularWorkedMinutes: Math.max(Number(day.regularWorkedMinutes) || 0, regularFloor),
    regularWorkedLabel: regularFloor ? minutesLabel(Math.max(Number(day.regularWorkedMinutes) || 0, regularFloor)) : "--",
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    justifiedWorkMinutes: (Number(day.justifiedWorkMinutes) || 0) + justifiedWorkMinutes,
    justifiedWorkLabel: minutesLabel((Number(day.justifiedWorkMinutes) || 0) + justifiedWorkMinutes),
    justifiedWorkIntervals: [
      ...(day.justifiedWorkIntervals || []),
      ...intervals.map((interval) => ({
        startTime: interval.startTime,
        endTime: interval.endTime,
        minutes: interval.minutes,
        minutesLabel: minutesLabel(interval.minutes),
        destination: interval.destination,
        note: interval.note,
        decidedBy: interval.decidedBy,
        allowSupplementaryTime: interval.allowSupplementaryTime,
      })),
    ],
    payrollPolicy: {
      ...(day.payrollPolicy || {}),
      appliesSupplementaryHours: allowSupplementaryTime && day.payrollPolicy?.appliesSupplementaryHours !== false,
    },
    authorization: {
      ...(day.authorization || {}),
      decision: "approved_work_time",
      statusLabel: "Trabajo fuera justificado",
      note: intervals.map((interval) => interval.note).filter(Boolean).join(" | "),
      decidedBy: intervals.find((interval) => interval.decidedBy)?.decidedBy || "",
      isSaved: false,
    },
  };
}

function applyDiscountedWorkIntervals(day, intervals = []) {
  if (!intervals.length) return day;

  const discountedMinutes = intervals.reduce((total, interval) => total + Math.max(0, Number(interval.minutes) || 0), 0);

  if (!discountedMinutes) return day;

  const plannedRegularMinutes = Math.max(0, (Number(day.plannedRegularMinutes) || 0) - discountedMinutes);
  const scheduledWorkedMinutes = Math.max(0, (Number(day.scheduledWorkedMinutes) || 0) - discountedMinutes);
  const plannedSupplementaryMinutes = Number(day.plannedSupplementaryMinutes) || 0;
  const workedMinutes = Number(day.workedMinutes) || 0;
  const regularWorkedMinutes = Math.min(workedMinutes, plannedRegularMinutes);
  const nextTags = cleanPayrollTags(day.tags || [])
    .filter((tag) => !["Atraso", "Salida anticipada"].includes(tag));
  const hasIssue = nextTags.some(isAttendanceIssueTag);

  return {
    ...day,
    tags: [...new Set([...nextTags, "Horas descontadas"])],
    hasIssue,
    scheduledWorkedMinutes,
    scheduledWorkedLabel: scheduledWorkedMinutes ? minutesLabel(scheduledWorkedMinutes) : "--",
    plannedRegularMinutes,
    plannedRegularLabel: plannedRegularMinutes ? minutesLabel(plannedRegularMinutes) : "--",
    plannedSupplementaryMinutes,
    plannedSupplementaryLabel: plannedSupplementaryMinutes ? minutesLabel(plannedSupplementaryMinutes) : "--",
    regularWorkedMinutes,
    regularWorkedLabel: regularWorkedMinutes ? minutesLabel(regularWorkedMinutes) : "--",
    lateMinutes: 0,
    entryLateMinutes: 0,
    earlyLeaveMinutes: 0,
    earlyLeaveLabel: "--",
    discountedWorkMinutes: (Number(day.discountedWorkMinutes) || 0) + discountedMinutes,
    discountedWorkLabel: minutesLabel((Number(day.discountedWorkMinutes) || 0) + discountedMinutes),
    discountedWorkIntervals: [
      ...(day.discountedWorkIntervals || []),
      ...intervals.map((interval) => ({
        startTime: interval.startTime,
        endTime: interval.endTime,
        minutes: interval.minutes,
        minutesLabel: minutesLabel(interval.minutes),
        note: interval.note,
        decidedBy: interval.decidedBy,
      })),
    ],
    authorization: {
      ...(day.authorization || {}),
      decision: "discount_hours",
      statusLabel: "Horas descontadas",
      note: intervals.map((interval) => interval.note).filter(Boolean).join(" | "),
      decidedBy: intervals.find((interval) => interval.decidedBy)?.decidedBy || "",
      isSaved: false,
    },
  };
}

function operationalDecisionTag(decision) {
  return decision?.source === "operational_exception" ? "Justificación operativa" : "";
}

function applyDayDecision(day, decision) {
  const paidPlannedDayDecisions = new Set([
    "pay_planned_day",
    "justify_no_punches",
    "justify_incomplete_punches",
  ]);
  const completeRegularDayDecisions = new Set([
    "complete_regular_day",
  ]);
  const policy = day.payrollPolicy || {};
  const isExtraordinaryDay = isExtraordinaryAttendanceDay(day);
  const isScheduledExtraDay = day?.dayType === "weekend_overtime";
  let detectedSupplementaryMinutes = policy.appliesSupplementaryHours === false || isExtraordinaryDay
    ? 0
    : Math.max(Number(day.supplementaryMinutes) || 0, Number(decision?.detectedSupplementaryMinutes) || 0);
  let detectedExtraordinaryMinutes = policy.appliesExtraordinaryHours === false || !isExtraordinaryDay
    ? 0
    : Math.max(Number(day.extraordinaryMinutes) || 0, Number(decision?.detectedExtraordinaryMinutes) || 0);
  const detectedLateIssueMinutes = (isExtraordinaryDay && !isScheduledExtraDay) || policy.scheduleAffectsSalary === false
    ? 0
    : Math.max(
      0,
      (Number(day.lateMinutes) || 0) + (Number(day.lunchOverageRemainderMinutes) || 0),
    );
  const detectedLateMinutes = detectedLateIssueMinutes;
  const detectedEarlyLeaveMinutes = Math.max(Number(day.earlyLeaveMinutes) || 0, Number(decision?.detectedEarlyLeaveMinutes) || 0);
  const entryLateMinutes = Math.max(0, Number(day.entryLateMinutes ?? day.lateMinutes) || 0);
  const lunchReturnLateMinutes = Math.max(0, Number(day.lunchOverageRemainderMinutes) || 0);
  const adjustedLateMinutes = decision
    ? Math.min(
      detectedLateMinutes,
      decision.decision === "justify_late"
        ? lunchReturnLateMinutes
      : ["discount_day", "pay_planned_day", "complete_regular_day", "justify_no_punches", "justify_incomplete_punches"].includes(decision.decision)
        ? 0
        : decision.adjustedLateMinutes === undefined || decision.adjustedLateMinutes === null
        ? detectedLateMinutes
        : Math.max(0, Number(decision.adjustedLateMinutes) || 0),
    )
    : detectedLateMinutes;
  const adjustedEarlyLeaveMinutes = decision
    ? Math.min(
      detectedEarlyLeaveMinutes,
      ["discount_day", "pay_planned_day", "complete_regular_day", "justify_early_leave", "justify_no_punches", "justify_incomplete_punches"].includes(decision.decision)
        ? 0
        : decision.adjustedEarlyLeaveMinutes === undefined || decision.adjustedEarlyLeaveMinutes === null
        ? Number(day.earlyLeaveMinutes) || 0
        : Math.max(0, Number(decision.adjustedEarlyLeaveMinutes) || 0),
    )
    : Number(day.earlyLeaveMinutes) || 0;
  const hasAuthorizableTime = detectedSupplementaryMinutes > 0 || detectedExtraordinaryMinutes > 0;
  const plannedSupplementaryMinutes = Math.min(
    isExtraordinaryDay ? 0 : detectedSupplementaryMinutes,
    Math.max(0, Number(day.plannedSupplementaryMinutes) || 0),
  );
  const plannedExtraordinaryMinutes = Math.min(
    isExtraordinaryDay ? detectedExtraordinaryMinutes : 0,
    Math.max(0, day.dayType === "holiday" && (Number(day.punchCount) || 0) > 0
      ? REGULAR_DAY_MINUTES
      : day.dayType === "weekend_overtime"
        ? Number(day.scheduledWorkedMinutes) || 0
        : Number(day.plannedExtraordinaryMinutes) || 0),
  );
  const effectiveDecision = decision || {
    decision: "planned",
    authorizedSupplementaryMinutes: plannedSupplementaryMinutes,
    authorizedExtraordinaryMinutes: plannedExtraordinaryMinutes,
    note: "",
    decidedBy: "",
  };
  const isAutomaticDecision = !decision;
  const plannedPaidRegularMinutes = Math.max(0, Number(day.plannedRegularMinutes) || 0);
  const plannedPaidSupplementaryMinutes = policy.appliesSupplementaryHours === false
    ? 0
    : isExtraordinaryDay
      ? 0
      : Math.max(0, Number(day.plannedSupplementaryMinutes) || 0);
  const shouldAdjustEntryPunch =
    effectiveDecision.decision === "justify_late" &&
    entryLateMinutes > 0 &&
    Array.isArray(day.punches) &&
    day.punches.length > 0;
  const punches = shouldAdjustEntryPunch
    ? day.punches.map((punch, index) => {
      if (index === 0 && entryLateMinutes > 0 && day.startTime) {
        return {
          ...punch,
          time: day.startTime,
          originalTime: punch.originalTime || punch.time,
          adjustedFrom: punch.originalTime || punch.time,
          adjustmentLabel: "Atraso justificado",
        };
      }

      return punch;
    })
    : day.punches;
  const shouldCompleteLaborForJustifiedEarlyLeave =
    detectedEarlyLeaveMinutes > 0 &&
    adjustedEarlyLeaveMinutes === 0 &&
    plannedPaidRegularMinutes > 0;
  const shouldCompleteLaborForJustifiedLate =
    effectiveDecision.decision === "justify_late" &&
    entryLateMinutes > 0 &&
    plannedPaidRegularMinutes > 0;
  const lateJustifiedWorkMinutes = shouldCompleteLaborForJustifiedLate ? entryLateMinutes : 0;
  const decisionWorkedMinutes = Math.max(0, (Number(day.workedMinutes) || 0) + lateJustifiedWorkMinutes);
  const decisionRegularLimitMinutes = Math.max(
    0,
    Math.min(plannedPaidRegularMinutes || REGULAR_DAY_MINUTES, REGULAR_DAY_MINUTES),
  );
  const decisionRegularWorkedMinutes = Math.min(decisionWorkedMinutes, decisionRegularLimitMinutes);

  if (shouldCompleteLaborForJustifiedLate) {
    if (isExtraordinaryDay && policy.appliesExtraordinaryHours !== false) {
      detectedExtraordinaryMinutes = Math.max(detectedExtraordinaryMinutes, decisionWorkedMinutes);
    } else if (policy.appliesSupplementaryHours !== false) {
      detectedSupplementaryMinutes = Math.max(
        detectedSupplementaryMinutes,
        Math.max(0, decisionWorkedMinutes - decisionRegularWorkedMinutes),
      );
    }
  }

  if (effectiveDecision.decision === "reviewed") {
    return {
      ...day,
      tags: [],
      hasIssue: false,
      detectedSupplementaryMinutes,
      detectedSupplementaryLabel: detectedSupplementaryMinutes ? minutesLabel(detectedSupplementaryMinutes) : "--",
      detectedExtraordinaryMinutes,
      detectedExtraordinaryLabel: detectedExtraordinaryMinutes ? minutesLabel(detectedExtraordinaryMinutes) : "--",
      authorization: {
        decision: "reviewed",
        statusLabel: "Revisado",
        authorizedSupplementaryMinutes: Number(day.supplementaryMinutes) || 0,
        authorizedExtraordinaryMinutes: Number(day.extraordinaryMinutes) || 0,
        detectedLateMinutes,
        adjustedLateMinutes,
        detectedEarlyLeaveMinutes,
        adjustedEarlyLeaveMinutes: Number(day.earlyLeaveMinutes) || 0,
        note: effectiveDecision.note || "",
        decidedBy: effectiveDecision.decidedBy || "",
        source: effectiveDecision.source || "attendance_decision",
        isSaved: Boolean(decision),
      },
    };
  }

  if (completeRegularDayDecisions.has(effectiveDecision.decision)) {
    const operationalTag = operationalDecisionTag(effectiveDecision);
    const completedTags = cleanPayrollTags(day.tags || [])
      .filter((tag) => ![
        "Sin picadas",
        "Picadas incompletas",
        "Picadas insuficientes",
        "Salida anticipada",
        "Atraso",
        "Dia descontado",
      ].includes(tag));
    const statusLabel = "Jornada laboral completada";
    const completedExtraordinaryMinutes = isExtraordinaryDay && policy.appliesExtraordinaryHours !== false
      ? Math.max(
        Number(day.scheduledWorkedMinutes) || 0,
        Number(day.plannedExtraordinaryMinutes) || 0,
        Number(day.authorizedExtraMinutes) || 0,
      )
      : 0;
    const completedRegularMinutes = isExtraordinaryDay ? 0 : plannedPaidRegularMinutes;
    const completedWorkedMinutes = completedRegularMinutes + completedExtraordinaryMinutes;
    const nextDetectedExtraordinaryMinutes = Math.max(detectedExtraordinaryMinutes, completedExtraordinaryMinutes);

    return {
      ...day,
      tags: [...completedTags, statusLabel, operationalTag].filter(Boolean),
      hasIssue: false,
      workedMinutes: completedWorkedMinutes,
      workedLabel: completedWorkedMinutes ? minutesLabel(completedWorkedMinutes) : "--",
      regularWorkedMinutes: completedRegularMinutes,
      regularWorkedLabel: completedRegularMinutes ? minutesLabel(completedRegularMinutes) : "--",
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      supplementaryMinutes: 0,
      supplementaryLabel: "--",
      extraordinaryMinutes: completedExtraordinaryMinutes,
      extraordinaryLabel: completedExtraordinaryMinutes ? minutesLabel(completedExtraordinaryMinutes) : "--",
      detectedSupplementaryMinutes,
      detectedSupplementaryLabel: detectedSupplementaryMinutes ? minutesLabel(detectedSupplementaryMinutes) : "--",
      detectedExtraordinaryMinutes: nextDetectedExtraordinaryMinutes,
      detectedExtraordinaryLabel: nextDetectedExtraordinaryMinutes ? minutesLabel(nextDetectedExtraordinaryMinutes) : "--",
      authorization: {
        decision: effectiveDecision.decision,
        statusLabel,
        authorizedSupplementaryMinutes: 0,
        authorizedExtraordinaryMinutes: completedExtraordinaryMinutes,
        detectedLateMinutes,
        adjustedLateMinutes: 0,
        detectedEarlyLeaveMinutes,
        adjustedEarlyLeaveMinutes: 0,
        note: effectiveDecision.note || "",
        decidedBy: effectiveDecision.decidedBy || "",
        source: effectiveDecision.source || "attendance_decision",
        isSaved: Boolean(decision),
      },
    };
  }

  if (paidPlannedDayDecisions.has(effectiveDecision.decision)) {
    const operationalTag = operationalDecisionTag(effectiveDecision);
    const statusLabel = effectiveDecision.decision === "justify_no_punches"
      ? "Ajustado a planificación"
      : effectiveDecision.decision === "justify_incomplete_punches"
        ? "Picadas justificadas"
        : "Dia planificado pagado";
    const paidTags = cleanPayrollTags(day.tags || [])
      .filter((tag) => ![
        "Sin picadas",
        "Picadas incompletas",
        "Picadas insuficientes",
        "Salida anticipada",
        "Atraso",
        "Dia descontado",
      ].includes(tag));
    const plannedPaidWorkedMinutes = plannedPaidRegularMinutes + plannedPaidSupplementaryMinutes;

    return {
      ...day,
      tags: [...paidTags, statusLabel, operationalTag].filter(Boolean),
      hasIssue: false,
      workedMinutes: plannedPaidWorkedMinutes,
      workedLabel: plannedPaidWorkedMinutes ? minutesLabel(plannedPaidWorkedMinutes) : "--",
      regularWorkedMinutes: plannedPaidRegularMinutes,
      regularWorkedLabel: plannedPaidRegularMinutes ? minutesLabel(plannedPaidRegularMinutes) : "--",
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      supplementaryMinutes: plannedPaidSupplementaryMinutes,
      supplementaryLabel: plannedPaidSupplementaryMinutes ? minutesLabel(plannedPaidSupplementaryMinutes) : "--",
      extraordinaryMinutes: 0,
      extraordinaryLabel: "--",
      detectedSupplementaryMinutes: Math.max(detectedSupplementaryMinutes, plannedPaidSupplementaryMinutes),
      detectedSupplementaryLabel: Math.max(detectedSupplementaryMinutes, plannedPaidSupplementaryMinutes)
        ? minutesLabel(Math.max(detectedSupplementaryMinutes, plannedPaidSupplementaryMinutes))
        : "--",
      detectedExtraordinaryMinutes,
      detectedExtraordinaryLabel: detectedExtraordinaryMinutes ? minutesLabel(detectedExtraordinaryMinutes) : "--",
      authorization: {
        decision: effectiveDecision.decision,
        statusLabel,
        authorizedSupplementaryMinutes: plannedPaidSupplementaryMinutes,
        authorizedExtraordinaryMinutes: 0,
        detectedLateMinutes,
        adjustedLateMinutes: 0,
        detectedEarlyLeaveMinutes,
        adjustedEarlyLeaveMinutes: 0,
        note: effectiveDecision.note || "",
        decidedBy: effectiveDecision.decidedBy || "",
        source: effectiveDecision.source || "attendance_decision",
        isSaved: Boolean(decision),
      },
    };
  }

  if (!hasAuthorizableTime && !decision) {
    return {
      ...day,
      detectedSupplementaryMinutes,
      detectedSupplementaryLabel: "--",
      detectedExtraordinaryMinutes,
      detectedExtraordinaryLabel: "--",
      authorization: day.authorization || null,
    };
  }

  const rawAuthorizedSupplementaryMinutes = isAutomaticDecision
    ? detectedSupplementaryMinutes
    : effectiveDecision.decision === "planned"
    ? plannedSupplementaryMinutes
    : Math.min(
      detectedSupplementaryMinutes,
      Math.max(0, Number(effectiveDecision.authorizedSupplementaryMinutes) || 0),
    );
  const rawAuthorizedExtraordinaryMinutes = isAutomaticDecision
    ? detectedExtraordinaryMinutes
    : effectiveDecision.decision === "planned"
    ? plannedExtraordinaryMinutes
    : Math.min(
      detectedExtraordinaryMinutes,
      Math.max(0, Number(effectiveDecision.authorizedExtraordinaryMinutes) || 0),
    );
  const authorizedSupplementaryMinutes = isExtraordinaryDay
    ? 0
    : isAutomaticDecision
      ? detectedSupplementaryMinutes
    : effectiveDecision.decision === "planned"
      ? Math.min(rawAuthorizedSupplementaryMinutes, detectedSupplementaryMinutes)
      : effectiveDecision.decision === "justify_early_leave" && adjustedEarlyLeaveMinutes === 0
        ? plannedPaidSupplementaryMinutes
      : rawAuthorizedSupplementaryMinutes;
  const authorizedExtraordinaryMinutes = isExtraordinaryDay
    ? isAutomaticDecision
      ? detectedExtraordinaryMinutes
    : effectiveDecision.decision === "planned"
      ? Math.min(rawAuthorizedExtraordinaryMinutes, detectedExtraordinaryMinutes)
      : rawAuthorizedExtraordinaryMinutes
    : 0;
  const adjustedTags = cleanPayrollTags(day.tags || []);
  const lateAdjustedTags = adjustedTags.filter((tag) => tag !== "Atraso");
  const hasUnauthorizedSupplementaryTime = authorizedSupplementaryMinutes < detectedSupplementaryMinutes;
  const hasUnauthorizedExtraordinaryTime = authorizedExtraordinaryMinutes < detectedExtraordinaryMinutes;
  const hasUnauthorizedExtraTime = hasUnauthorizedSupplementaryTime || hasUnauthorizedExtraordinaryTime;

  if (effectiveDecision.decision === "discount_day") {
    const operationalTag = operationalDecisionTag(effectiveDecision);

    return {
      ...day,
      tags: [...adjustedTags, "Dia descontado", operationalTag].filter(Boolean),
      regularWorkedMinutes: 0,
      regularWorkedLabel: "--",
      supplementaryMinutes: 0,
      supplementaryLabel: "--",
      extraordinaryMinutes: 0,
      extraordinaryLabel: "--",
      detectedSupplementaryMinutes,
      detectedSupplementaryLabel: detectedSupplementaryMinutes ? minutesLabel(detectedSupplementaryMinutes) : "--",
      detectedExtraordinaryMinutes,
      detectedExtraordinaryLabel: detectedExtraordinaryMinutes ? minutesLabel(detectedExtraordinaryMinutes) : "--",
      authorization: {
        decision: "discount_day",
        statusLabel: "Dia descontado",
        authorizedSupplementaryMinutes: 0,
        authorizedExtraordinaryMinutes: 0,
        detectedLateMinutes,
        adjustedLateMinutes: 0,
        detectedEarlyLeaveMinutes,
        adjustedEarlyLeaveMinutes: 0,
        note: effectiveDecision.note || "",
        decidedBy: effectiveDecision.decidedBy || "",
        source: effectiveDecision.source || "attendance_decision",
        isSaved: Boolean(decision),
      },
    };
  }

  const isSavedDecision = Boolean(decision);
  const issueAdjustedTags = lateAdjustedTags.filter((tag) => ![
    "Atraso",
    "Atraso justificado",
    "Salida anticipada",
    "Salida justificada",
    "Sin picadas",
    "Picadas incompletas",
    "Picadas insuficientes",
  ].includes(tag));
  if (!isSavedDecision && authorizedExtraordinaryMinutes > 0) issueAdjustedTags.push("Extraordinaria");
  if (adjustedLateMinutes > 0) issueAdjustedTags.push("Atraso");
  if (adjustedEarlyLeaveMinutes > 0) issueAdjustedTags.push("Salida anticipada");
  if (shouldCompleteLaborForJustifiedEarlyLeave) issueAdjustedTags.push("Salida justificada");
  if (shouldCompleteLaborForJustifiedLate) issueAdjustedTags.push("Atraso justificado");
  const hasIssue = issueAdjustedTags.some(isAttendanceIssueTag);
  const shouldCompleteLabor = shouldCompleteLaborForJustifiedEarlyLeave || shouldCompleteLaborForJustifiedLate;
  const regularWorkedMinutes = shouldCompleteLabor
    ? Math.max(Number(day.regularWorkedMinutes) || 0, plannedPaidRegularMinutes, decisionRegularWorkedMinutes)
    : Number(day.regularWorkedMinutes) || 0;
  const workedMinutes = shouldCompleteLabor
    ? Math.max(
      Number(day.workedMinutes) || 0,
      decisionWorkedMinutes,
      plannedPaidRegularMinutes + plannedPaidSupplementaryMinutes + authorizedExtraordinaryMinutes,
    )
    : Number(day.workedMinutes) || 0;

  return {
    ...day,
    punches,
    tags: issueAdjustedTags,
    hasIssue,
    workedMinutes,
    workedLabel: workedMinutes ? minutesLabel(workedMinutes) : "--",
    regularWorkedMinutes,
    regularWorkedLabel: regularWorkedMinutes ? minutesLabel(regularWorkedMinutes) : "--",
    lateMinutes: isExtraordinaryDay && !isScheduledExtraDay ? 0 : adjustedLateMinutes,
    entryLateMinutes: effectiveDecision.decision === "justify_late"
      ? 0
      : Math.min(entryLateMinutes, adjustedLateMinutes),
    earlyLeaveMinutes: isExtraordinaryDay ? 0 : adjustedEarlyLeaveMinutes,
    supplementaryMinutes: authorizedSupplementaryMinutes,
    supplementaryLabel: authorizedSupplementaryMinutes ? minutesLabel(authorizedSupplementaryMinutes) : "--",
    extraordinaryMinutes: authorizedExtraordinaryMinutes,
    extraordinaryLabel: authorizedExtraordinaryMinutes ? minutesLabel(authorizedExtraordinaryMinutes) : "--",
    detectedSupplementaryMinutes,
    detectedSupplementaryLabel: detectedSupplementaryMinutes ? minutesLabel(detectedSupplementaryMinutes) : "--",
    detectedExtraordinaryMinutes,
    detectedExtraordinaryLabel: detectedExtraordinaryMinutes ? minutesLabel(detectedExtraordinaryMinutes) : "--",
    authorization: {
      decision: effectiveDecision.decision || "custom",
      statusLabel: effectiveDecision.decision === "none"
        ? "No pagado"
        : effectiveDecision.decision === "justify_early_leave"
          ? "Salida justificada"
        : effectiveDecision.decision === "justify_late"
          ? "Atraso justificado"
        : effectiveDecision.decision === "full"
          ? "Todo autorizado"
        : effectiveDecision.decision === "planned"
            ? isAutomaticDecision
              ? "Registrado"
              : hasUnauthorizedExtraTime
                ? "Según plan"
                : "Planificado"
            : "Ajustado",
      authorizedSupplementaryMinutes,
      authorizedExtraordinaryMinutes,
      detectedLateMinutes,
      detectedEntryLateMinutes: entryLateMinutes,
      adjustedLateMinutes,
      detectedEarlyLeaveMinutes,
      adjustedEarlyLeaveMinutes,
      note: effectiveDecision.note || "",
      decidedBy: effectiveDecision.decidedBy || "",
      source: effectiveDecision.source || "attendance_decision",
      isSaved: Boolean(decision),
      hasUnauthorizedSupplementaryTime,
      hasUnauthorizedExtraordinaryTime,
    },
  };
}

function applyMonthlyHourTarget(days) {
  return days.map((day) => {
    const nextDay = {
      ...day,
      tags: cleanPayrollTags(day.tags || []),
      regularWorkedMinutes: 0,
      regularWorkedLabel: "--",
      supplementaryMinutes: 0,
      supplementaryLabel: "--",
      extraordinaryMinutes: 0,
      extraordinaryLabel: "--",
      additionalSupplementaryMinutes: Number(day.additionalSupplementaryMinutes) || 0,
      additionalSupplementaryLabel: day.additionalSupplementaryMinutes ? minutesLabel(day.additionalSupplementaryMinutes) : "--",
    };
    const workedMinutes = Number(day.workedMinutes) || 0;
    const policy = day.payrollPolicy || {};
    const appliesSupplementaryHours = policy.appliesSupplementaryHours !== false;
    const appliesExtraordinaryHours = policy.appliesExtraordinaryHours !== false;
    const plannedRegularMinutes = Math.max(0, Number(day.plannedRegularMinutes) || 0);

    if (day.dayType === "holiday") {
      nextDay.plannedRegularMinutes = 0;
      nextDay.plannedRegularLabel = "--";

      if (workedMinutes > 0 && appliesExtraordinaryHours) {
        nextDay.extraordinaryMinutes = workedMinutes;
        nextDay.extraordinaryLabel = minutesLabel(workedMinutes);
        nextDay.tags = [...nextDay.tags, "Extraordinaria"];
      }

      return nextDay;
    }

    if (day.dayType === "vacation") {
      nextDay.plannedRegularMinutes = REGULAR_DAY_MINUTES;
      nextDay.plannedRegularLabel = minutesLabel(REGULAR_DAY_MINUTES);
      nextDay.regularWorkedMinutes = REGULAR_DAY_MINUTES;
      nextDay.regularWorkedLabel = minutesLabel(REGULAR_DAY_MINUTES);
      return nextDay;
    }

    if (!workedMinutes) {
      return nextDay;
    }

    if (day.dayType === "weekend_overtime") {
      if (!appliesExtraordinaryHours) {
        return nextDay;
      }

      nextDay.extraordinaryMinutes = workedMinutes;
      nextDay.extraordinaryLabel = minutesLabel(workedMinutes);
      nextDay.tags = [...nextDay.tags, "Extraordinaria"];
      nextDay.hasIssue = nextDay.tags.some(isAttendanceIssueTag);
      return nextDay;
    }

    if (isRestOrWeekendDay(day)) {
      if (!appliesExtraordinaryHours) {
        return nextDay;
      }

      nextDay.extraordinaryMinutes = workedMinutes;
      nextDay.extraordinaryLabel = minutesLabel(workedMinutes);
      nextDay.tags = [...nextDay.tags.filter((tag) => !UNPLANNED_WORK_TAGS.has(tag)), "Extraordinaria"];
      return nextDay;
    }

    if (hasWorkWithoutScheduleTag(nextDay) && nextDay.weeklyAttendanceClassification !== "regular") {
      nextDay.hasIssue = nextDay.tags.some(isAttendanceIssueTag);
      return nextDay;
    }

    const dailyRegularLimitMinutes = Math.max(0, Math.min(plannedRegularMinutes || REGULAR_DAY_MINUTES, REGULAR_DAY_MINUTES));
    const regularMinutes = Math.min(workedMinutes, dailyRegularLimitMinutes);

    nextDay.regularWorkedMinutes = regularMinutes;
    nextDay.regularWorkedLabel = regularMinutes ? minutesLabel(regularMinutes) : "--";

    const detectedSupplementaryMinutes = Math.max(0, workedMinutes - regularMinutes);
    nextDay.supplementaryMinutes = appliesSupplementaryHours
      ? detectedSupplementaryMinutes
      : 0;
    nextDay.supplementaryLabel = nextDay.supplementaryMinutes ? minutesLabel(nextDay.supplementaryMinutes) : "--";

    nextDay.hasIssue = nextDay.tags.some(isAttendanceIssueTag);

    return nextDay;
  });
}

function compareDay(day, punches, laborRules, employee = {}) {
  const sortedPunches = dedupePunchesByMinute(punches).sort((left, right) => left.punchedAt - right.punchedAt);
  const punchCount = sortedPunches.length;
  const isWorkingDay = isPlannedWorkDay(day);
  const isExtraordinaryDay = isExtraordinaryAttendanceDay(day);
  const payrollPolicy = attendancePayrollPolicy(employee, laborRules);
  const scheduleAffectsSalary = payrollPolicy.scheduleAffectsSalary !== false;
  const shouldUsePlannedAttendance = !scheduleAffectsSalary && isWorkingDay && punchCount === 0;
  const shouldSuppressScheduleIssues = !scheduleAffectsSalary;
  const shouldIgnorePunchesForPayroll =
    !payrollPolicy.appliesSupplementaryHours &&
    !payrollPolicy.appliesExtraordinaryHours &&
    !isWorkingDay;
  const isWeekendOrHoliday = isWeekendDateKey(day.dateKey) || day?.dayType === "holiday";
  const hasLunch = isWorkingDay && Number(day?.lunchDurationMinutes) > 0;
  const hasHolidayLunchPunches = day?.dayType === "holiday" && punchCount >= 4;
  const expectedPunches = isWorkingDay ? (hasLunch ? 4 : 2) : 0;
  const scheduleStart = isWorkingDay ? combineDateAndTime(day.dateKey, day.startTime) : null;
  const scheduleEnd = isWorkingDay ? combineDateAndTime(day.dateKey, day.endTime) : null;
  const graceMinutes = Number(day?.graceMinutes ?? laborRules?.defaultGraceMinutes ?? 10) || 0;
  const plannedMinutes = resolveScheduledMinutes(day);
  const firstPunch = sortedPunches[0] || null;
  const lastPunch = sortedPunches[punchCount - 1] || null;
  const twoPunchSpanMinutes = punchCount === 2 && firstPunch && lastPunch
    ? Math.max(0, Math.round((lastPunch.punchedAt - firstPunch.punchedAt) / 60000))
    : null;
  const minimumTwoPunchSpan = minimumTwoPunchSpanMinutes(day, employee);
  const hasInsufficientTwoPunchSpan = twoPunchSpanMinutes !== null && twoPunchSpanMinutes < minimumTwoPunchSpan;
  const hasUnusablePunchesForPayroll =
    punchCount === 0 ||
    punchCount === 1 ||
    punchCount % 2 !== 0 ||
    hasInsufficientTwoPunchSpan;
  const tags = [];
  let workedMinutes = 0;
  let regularWorkedMinutes = 0;
  let lateMinutes = 0;
  let earlyLeaveMinutes = 0;
  let supplementaryMinutes = 0;
  let extraordinaryMinutes = 0;
  let additionalSupplementaryMinutes = 0;
  let actualLunchMinutes = null;
  let lunchDiscountMinutes = 0;
  let lunchOverageMinutes = 0;
  let lunchOverageRemainderMinutes = 0;

  actualLunchMinutes = resolveActualLunchMinutes(sortedPunches);

  if (firstPunch && lastPunch && !hasInsufficientTwoPunchSpan) {
    const countedStart = scheduleStart && firstPunch.punchedAt < scheduleStart
      ? scheduleStart
      : firstPunch.punchedAt;
    const grossMinutes = lastPunch.punchedAt > countedStart
      ? Math.max(0, Math.round((lastPunch.punchedAt - countedStart) / 60000))
      : 0;
    const scheduledLunchMinutes = hasLunch
      ? Number(day.lunchDurationMinutes) || 0
      : (hasHolidayLunchPunches ? resolveHolidayLunchDiscountMinutes(laborRules, employee) : 0);
    lunchDiscountMinutes = scheduledLunchMinutes;
    const lunchDiscount = Math.max(actualLunchMinutes || 0, scheduledLunchMinutes);
    lunchOverageMinutes = Math.max(0, (actualLunchMinutes || 0) - lunchDiscountMinutes);
    workedMinutes = Math.max(0, grossMinutes - lunchDiscount);
  }

  if (shouldUsePlannedAttendance || (!scheduleAffectsSalary && isWorkingDay && hasUnusablePunchesForPayroll)) {
    workedMinutes = plannedMinutes.plannedRegularMinutes + plannedMinutes.plannedSupplementaryMinutes;
    regularWorkedMinutes = workedMinutes;
    actualLunchMinutes = null;
  }

  if (!scheduleAffectsSalary && isWorkingDay && workedMinutes > 0) {
    workedMinutes = Math.max(
      workedMinutes,
      plannedMinutes.plannedRegularMinutes + plannedMinutes.plannedSupplementaryMinutes,
    );
  }

  if (shouldIgnorePunchesForPayroll) {
    workedMinutes = 0;
    actualLunchMinutes = null;
    lunchOverageMinutes = 0;
    lunchOverageRemainderMinutes = 0;
    lunchDiscountMinutes = 0;
  }

  if (isWorkingDay && punchCount === 0 && !shouldUsePlannedAttendance && !shouldSuppressScheduleIssues) {
    tags.push("Sin picadas");
  }

  if (
    (isWorkingDay || isExtraordinaryDay) &&
    punchCount > 0 &&
    (punchCount === 1 || punchCount === 3) &&
    !shouldUsePlannedAttendance &&
    !shouldSuppressScheduleIssues &&
    !shouldIgnorePunchesForPayroll
  ) {
    tags.push("Picadas incompletas");
  }

  if (punchCount === 2 && hasInsufficientTwoPunchSpan && !shouldUsePlannedAttendance && !shouldSuppressScheduleIssues) {
    tags.push("Picadas insuficientes");
  }

  if (
    isWorkingDay &&
    punchCount > expectedPunches &&
    punchCount % 2 === 0 &&
    !shouldUsePlannedAttendance &&
    !shouldSuppressScheduleIssues
  ) {
    tags.push("Picadas adicionales");
  }

  if (!isWorkingDay && day?.dayType !== "holiday" && punchCount > 0 && !shouldUsePlannedAttendance && !shouldIgnorePunchesForPayroll) {
    tags.push("No planificado");
  }

  if (isWorkingDay && scheduleStart && firstPunch && firstPunch.punchedAt > scheduleStart && !shouldUsePlannedAttendance && !hasInsufficientTwoPunchSpan && scheduleAffectsSalary) {
    const rawLateMinutes = Math.max(0, Math.round((firstPunch.punchedAt - scheduleStart) / 60000));
    lateMinutes = rawLateMinutes > graceMinutes ? rawLateMinutes : 0;
    if (lateMinutes > 0) tags.push("Atraso");
  }

  if (isWorkingDay && punchCount >= 2 && scheduleEnd && lastPunch && lastPunch.punchedAt < scheduleEnd && !shouldUsePlannedAttendance && !hasInsufficientTwoPunchSpan && scheduleAffectsSalary) {
    earlyLeaveMinutes = Math.max(0, Math.round((scheduleEnd - lastPunch.punchedAt) / 60000));
    const earlyLeaveAffectsPlannedTime = isExtraordinaryDay
      ? workedMinutes < plannedMinutes.scheduledWorkedMinutes
      : workedMinutes < plannedMinutes.plannedRegularMinutes;

    if (earlyLeaveMinutes > 0 && earlyLeaveAffectsPlannedTime) {
      tags.push("Salida anticipada");
    }
  }

  if (isWorkingDay && scheduleEnd && lastPunch && lastPunch.punchedAt > scheduleEnd && !shouldUsePlannedAttendance && !hasInsufficientTwoPunchSpan && payrollPolicy.appliesSupplementaryHours) {
    const rawAdditionalSupplementaryMinutes = Math.max(0, Math.round((lastPunch.punchedAt - scheduleEnd) / 60000));
    const workedSurplusOverPlan = Math.max(0, workedMinutes - plannedMinutes.scheduledWorkedMinutes);
    additionalSupplementaryMinutes = Math.min(rawAdditionalSupplementaryMinutes, workedSurplusOverPlan);
    lunchOverageRemainderMinutes = Math.max(0, lunchOverageMinutes - rawAdditionalSupplementaryMinutes);
  } else {
    lunchOverageRemainderMinutes = lunchOverageMinutes;
  }

  if (
    isWorkingDay &&
    scheduleEnd &&
    lastPunch &&
    plannedMinutes.plannedSupplementaryMinutes > 0 &&
    !shouldUsePlannedAttendance &&
    !hasInsufficientTwoPunchSpan &&
    payrollPolicy.appliesSupplementaryHours
  ) {
    const supplementaryStart = new Date(scheduleEnd.getTime() - (plannedMinutes.plannedSupplementaryMinutes * 60000));
    supplementaryMinutes = Math.max(0, Math.round((lastPunch.punchedAt - supplementaryStart) / 60000));
  }

  const hasIssue = tags.some(isAttendanceIssueTag);
  const hasRestDayAttendance = day.dayType === "off_day" && punchCount > 0;
  const displayDayTypeLabel = hasRestDayAttendance ? "Extraordinaria" : dayTypeLabel(day.dayType);
  const displayScheduleLabel = hasRestDayAttendance ? "Extraordinaria" : buildScheduleLabel(day);

  return {
    dateKey: day.dateKey,
    dateLabel: formatEcuadorDate(new Date(`${day.dateKey}T12:00:00.000Z`)),
    dayLabel: day.label || "",
    dayType: day.dayType || "off_day",
    dayTypeLabel: displayDayTypeLabel,
    source: day.source || "calendar",
    scheduleLabel: displayScheduleLabel,
    startTime: day.startTime || "",
    endTime: day.endTime || "",
    lunchStartTime: day.lunchStartTime || "",
    lunchEndTime: day.lunchEndTime || "",
    lunchDurationMinutes: Number(day.lunchDurationMinutes) || 0,
    actualLunchMinutes,
    actualLunchLabel: actualLunchMinutes === null ? "--" : minutesLabel(actualLunchMinutes),
    lunchDiscountMinutes,
    lunchDiscountLabel: lunchDiscountMinutes ? minutesLabel(lunchDiscountMinutes) : "--",
    lunchOverageMinutes,
    lunchOverageLabel: lunchOverageMinutes ? minutesLabel(lunchOverageMinutes) : "--",
    lunchOverageRemainderMinutes,
    lunchOverageRemainderLabel: lunchOverageRemainderMinutes ? minutesLabel(lunchOverageRemainderMinutes) : "--",
    authorizedExtraMinutes: Number(day.authorizedExtraMinutes) || 0,
    graceMinutes,
    scheduledWorkedMinutes: plannedMinutes.scheduledWorkedMinutes,
    plannedRegularMinutes: plannedMinutes.plannedRegularMinutes,
    plannedSupplementaryMinutes: plannedMinutes.plannedSupplementaryMinutes,
    plannedDayType: day.dayType || "off_day",
    originalScheduledWorkedMinutes: plannedMinutes.scheduledWorkedMinutes,
    originalPlannedRegularMinutes: plannedMinutes.plannedRegularMinutes,
    originalPlannedSupplementaryMinutes: plannedMinutes.plannedSupplementaryMinutes,
    originalAuthorizedExtraMinutes: Number(day.authorizedExtraMinutes) || 0,
    payrollPolicy,
    scheduledWorkedLabel: plannedMinutes.scheduledWorkedMinutes ? minutesLabel(plannedMinutes.scheduledWorkedMinutes) : "--",
    plannedRegularLabel: plannedMinutes.plannedRegularMinutes ? minutesLabel(plannedMinutes.plannedRegularMinutes) : "--",
    plannedSupplementaryLabel: plannedMinutes.plannedSupplementaryMinutes ? minutesLabel(plannedMinutes.plannedSupplementaryMinutes) : "--",
    expectedPunches,
    punchCount,
    punches: sortedPunches.map((punch) => {
      const time = formatEcuadorTime(punch.punchedAt);

      return {
        id: punch._id.toString(),
        time,
        originalTime: time,
        source: punch.source || "upload",
      };
    }),
    workedMinutes,
    workedLabel: workedMinutes ? minutesLabel(workedMinutes) : "--",
    regularWorkedMinutes,
    regularWorkedLabel: regularWorkedMinutes ? minutesLabel(regularWorkedMinutes) : "--",
    lateMinutes,
    entryLateMinutes: lateMinutes,
    earlyLeaveMinutes,
    earlyLeaveLabel: earlyLeaveMinutes ? minutesLabel(earlyLeaveMinutes) : "--",
    lateLabel: lateMinutes ? minutesLabel(lateMinutes) : "--",
    supplementaryMinutes,
    supplementaryLabel: supplementaryMinutes ? minutesLabel(supplementaryMinutes) : "--",
    extraordinaryMinutes,
    extraordinaryLabel: extraordinaryMinutes ? minutesLabel(extraordinaryMinutes) : "--",
    additionalSupplementaryMinutes,
    additionalSupplementaryLabel: additionalSupplementaryMinutes ? minutesLabel(additionalSupplementaryMinutes) : "--",
    justifiedWorkMinutes: 0,
    justifiedWorkLabel: "--",
    justifiedWorkIntervals: [],
    tags,
    hasIssue,
  };
}

function emptyEmployeeSummary() {
  return {
    plannedDays: 0,
    daysWithPunches: 0,
    missingPunchDays: 0,
    incompletePunchDays: 0,
    absentDays: 0,
    lateDays: 0,
    earlyLeaveDays: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    extraDays: 0,
    extraPunchDays: 0,
    unplannedWorkDays: 0,
    plannedDaysWithPunches: 0,
    plannedRegularMinutes: 0,
    plannedSupplementaryMinutes: 0,
    plannedExtraordinaryMinutes: 0,
    supplementaryMinutes: 0,
    detectedSupplementaryMinutes: 0,
    regularWorkedMinutes: 0,
    extraordinaryMinutes: 0,
    detectedExtraordinaryMinutes: 0,
    unplannedExtraMinutes: 0,
    additionalSupplementaryMinutes: 0,
    justifiedWorkMinutes: 0,
    discountedWorkMinutes: 0,
    issueDays: 0,
    operationalAlertDays: 0,
  };
}

export async function GET(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const { searchParams } = request.nextUrl;
    const { monthKey, year, monthIndex } = parseMonthKey(searchParams.get("month") || currentMonthKey());
    const branchCode = String(searchParams.get("branchCode") || "").trim().toUpperCase();
    const areaCode = String(searchParams.get("areaCode") || "").trim();
    const roleCode = String(searchParams.get("roleCode") || "").trim();
    const employeeId = String(searchParams.get("employeeId") || "").trim();
    const start = makeEcuadorDate(year, monthIndex, 1);
    const end = makeEcuadorDate(year, monthIndex + 1, 1);
    const { contextStart, contextEnd } = getWeekContextRange(start, end);
    const employeeQuery = buildEmployeeActiveInMonthQuery(start);

    if (branchCode) {
      employeeQuery.branchCode = branchCode;
    }

    if (areaCode) {
      employeeQuery.areaCode = areaCode;
    }

    if (roleCode) {
      employeeQuery.roleCode = roleCode;
    }

    if (employeeId) {
      employeeQuery._id = employeeId;
    }

    const [employees, laborRules, holidays, vacations] = await Promise.all([
      Employee.find(employeeQuery).sort({ branchName: 1, areaName: 1, roleName: 1, fullName: 1 }).lean(),
      LaborRuleConfig.findOne({ key: "default" }).lean(),
      Holiday.find({
        date: {
          $gte: contextStart,
          $lt: contextEnd,
        },
      }).lean(),
      VacationRequest.find({
        status: "scheduled",
        startDate: { $lt: contextEnd },
        endDate: { $gte: contextStart },
      }).lean(),
    ]);
    const employeeIds = employees.map((employee) => employee._id);
    const contextMonthKeys = new Set();
    const contextCursorEnd = contextEnd;

    for (let date = contextStart; date < contextCursorEnd; date = addDays(date, 1)) {
      contextMonthKeys.add(monthKeyFromDateKey(formatEcuadorDateKey(date)));
    }

    const [manualAssignments, fixedScheduleTemplates] = employeeIds.length
      ? await Promise.all([
          ScheduleAssignment.find({
            employee: { $in: employeeIds },
            monthKey: { $in: [...contextMonthKeys] },
          }).lean(),
          BaseScheduleTemplate.find({
            isActive: { $ne: false },
            areaCode: { $nin: [...VARIABLE_SCHEDULE_AREA_CODES] },
          }).lean(),
        ])
      : [[], []];
    const fallbackAssignments = buildFixedScheduleFallbackAssignments({
      employees,
      templates: fixedScheduleTemplates,
      monthKeys: [...contextMonthKeys],
      holidays,
    });
    const assignments = [...fallbackAssignments, ...manualAssignments];
    const manualDaysByEmployeeDate = new Map();

    manualAssignments.forEach((assignment) => {
      const employeeKey = toId(assignment.employee);

      if (!employeeKey || !Array.isArray(assignment.generatedDays)) return;

      assignment.generatedDays.forEach((day) => {
        if (!day?.dateKey) return;

        manualDaysByEmployeeDate.set(`${employeeKey}|${day.dateKey}`, {
          ...day,
          source: day.source || "manual_override",
        });
      });
    });
    const punches = employeeIds.length
      ? await AttendancePunch.find({
          employee: { $in: employeeIds },
          punchedAt: {
            $gte: contextStart,
            $lt: contextEnd,
          },
        }).sort({ punchedAt: 1 }).lean()
      : [];
    const assignmentsByEmployeeMonth = new Map(
      assignments.map((assignment) => [`${toId(assignment.employee)}|${assignment.monthKey}`, assignment]),
    );
    const [dayDecisions, operationalExceptions] = employeeIds.length
      ? await Promise.all([
          AttendanceDayDecision.find({
            employee: { $in: employeeIds },
            date: {
              $gte: start,
              $lt: end,
            },
          }).lean(),
          OperationalException.find({
            employee: { $in: employeeIds },
            status: { $ne: "void" },
            resolution: { $in: ["complete_scheduled_time", "paid_leave", "approved_work_time", "discount_day"] },
            $or: [
              { date: { $gte: start, $lt: end } },
              { date: { $lt: end }, endDate: { $gte: start } },
            ],
          }).lean(),
        ])
      : [[], []];
    const dayDecisionsByEmployeeDate = buildDayDecisionMap(dayDecisions);
    const operationalDecisionsByEmployeeDate = buildOperationalExceptionDecisionMap(operationalExceptions);
    const justifiedWorkIntervalsByEmployeeDate = buildJustifiedWorkIntervalMap(operationalExceptions);
    const discountedWorkIntervalsByEmployeeDate = buildDiscountedWorkIntervalMap(operationalExceptions);
    const exceptionPlannedSchedulesByEmployeeDate = buildExceptionPlannedScheduleMap(operationalExceptions);

    operationalDecisionsByEmployeeDate.forEach((decision, key) => {
      if (!dayDecisionsByEmployeeDate.has(key)) {
        dayDecisionsByEmployeeDate.set(key, decision);
      }
    });
    const vacationDateKeysByEmployee = buildVacationDateKeysByEmployee(vacations);
    const punchesByEmployeeDate = new Map();

    punches.forEach((punch) => {
      const key = `${toId(punch.employee)}|${formatEcuadorDateKey(punch.punchedAt)}`;

      if (!punchesByEmployeeDate.has(key)) {
        punchesByEmployeeDate.set(key, []);
      }

      punchesByEmployeeDate.get(key).push(punch);
    });

    const holidayDateKeys = new Set(holidays.map((holiday) => holiday.dateKey));
    const referenceDays = buildReferenceDaysInRange(contextStart, contextEnd, holidayDateKeys);
    const visibleReferenceDays = referenceDays.filter((day) => monthKeyFromDateKey(day.dateKey) === monthKey);
    const rows = employees.map((employee) => {
      const employeeKey = toId(employee);
      const employmentStartDateKey = resolveEmploymentStartDateKey(employee);
      const terminationDateKey = resolveTerminationDateKey(employee);
      const employeeVisibleReferenceDays = visibleReferenceDays
        .map((day) => applyEmploymentEndDay(applyEmploymentStartDay(day, employmentStartDateKey), terminationDateKey));
      const baseLaborDays = countBaseLaborDays(employeeVisibleReferenceDays);
      const regularTargetMinutes = baseLaborDays * REGULAR_DAY_MINUTES;
      const vacationDateKeys = vacationDateKeysByEmployee.get(employeeKey) || new Set();
      const baseComparableDays = referenceDays.map((referenceDay) => {
        const assignment = assignmentsByEmployeeMonth.get(`${employeeKey}|${monthKeyFromDateKey(referenceDay.dateKey)}`);
        const assignedDay = {
          ...mergeReferenceDaysWithAssignment([referenceDay], assignment)[0],
          ...(manualDaysByEmployeeDate.get(`${employeeKey}|${referenceDay.dateKey}`) || {}),
        };

        return applyEmploymentEndDay(
          applyExceptionPlannedSchedule(
            applyVacationDay(applyEmploymentStartDay(assignedDay, employmentStartDateKey), vacationDateKeys),
            exceptionPlannedSchedulesByEmployeeDate.get(`${employeeKey}|${referenceDay.dateKey}`),
          ),
          terminationDateKey,
        );
      });
      const comparableDays = applyWeeklyExtraDayTypes(
        baseComparableDays.map((day) => applyLunchPolicyByDay(day, employee, laborRules)),
      );
      const comparedDays = comparableDays.map((day) =>
        applyDiscountedWorkIntervals(
          applyJustifiedWorkIntervals(
            compareDay(day, punchesByEmployeeDate.get(`${employeeKey}|${day.dateKey}`) || [], laborRules, employee),
            justifiedWorkIntervalsByEmployeeDate.get(`${employeeKey}|${day.dateKey}`) || [],
          ),
          discountedWorkIntervalsByEmployeeDate.get(`${employeeKey}|${day.dateKey}`) || [],
        ),
      );
      const attendanceClassifiedDays = applyWeeklyExtraByAttendance(comparedDays);
      const visibleDays = attendanceClassifiedDays.filter((day) => monthKeyFromDateKey(day.dateKey) === monthKey);
      const classifiedDays = applyMonthlyHourTarget(visibleDays);
      const days = classifiedDays.map((day) =>
        applyDayDecision(day, dayDecisionsByEmployeeDate.get(`${employeeKey}|${day.dateKey}`)),
      );
      const assignment = assignmentsByEmployeeMonth.get(`${employeeKey}|${monthKey}`);
      const hasManualScheduleDays = visibleDays.some((day) => day.source !== "calendar" && day.source !== "holiday");
      const summary = days.reduce((totals, day) => {
        if (isPlannedPaidDay(day)) {
          totals.plannedDays += 1;
          if (day.punchCount > 0) totals.plannedDaysWithPunches += 1;
        }
        if (day.punchCount > 0) totals.daysWithPunches += 1;
        if (day.tags.includes("Sin picadas")) totals.absentDays += 1;
        if (day.tags.includes("Picadas incompletas") || day.tags.includes("Picadas insuficientes")) {
          totals.missingPunchDays += 1;
          totals.incompletePunchDays += 1;
        }
        if (day.tags.includes("Salida anticipada")) {
          totals.missingPunchDays += 1;
        }
        if (day.lateMinutes > 0) totals.lateDays += 1;
        if (day.earlyLeaveMinutes > 0) totals.earlyLeaveDays += 1;
        if (day.tags.includes("Picadas adicionales")) totals.extraPunchDays += 1;
        if (day.tags.some((tag) => UNPLANNED_WORK_TAGS.has(tag))) {
          totals.unplannedWorkDays += 1;
        }
        if (day.supplementaryMinutes > 0 || day.additionalSupplementaryMinutes > 0 || day.extraordinaryMinutes > 0) {
          totals.extraDays += 1;
        }
        if (day.hasIssue) totals.issueDays += 1;
        totals.operationalAlertDays = totals.absentDays + totals.incompletePunchDays + totals.unplannedWorkDays;

        totals.plannedRegularMinutes += resolvePlannedRegularMinutes(day);
        totals.plannedSupplementaryMinutes += resolvePlannedSupplementaryMinutes(day);
        totals.plannedExtraordinaryMinutes += resolvePlannedExtraordinaryMinutes(day);
        totals.lateMinutes += day.lateMinutes;
        totals.earlyLeaveMinutes += day.earlyLeaveMinutes;
        totals.regularWorkedMinutes += day.regularWorkedMinutes;
        totals.supplementaryMinutes += day.supplementaryMinutes;
        totals.detectedSupplementaryMinutes += Number(day.detectedSupplementaryMinutes) || 0;
        totals.extraordinaryMinutes += day.extraordinaryMinutes;
        totals.detectedExtraordinaryMinutes += Number(day.detectedExtraordinaryMinutes) || 0;
        totals.unplannedExtraMinutes += day.additionalSupplementaryMinutes;
        totals.additionalSupplementaryMinutes += day.additionalSupplementaryMinutes;
        totals.justifiedWorkMinutes += day.justifiedWorkMinutes || 0;
        totals.discountedWorkMinutes += day.discountedWorkMinutes || 0;
        return totals;
      }, emptyEmployeeSummary());
      summary.regularWorkedMinutes = Math.min(summary.regularWorkedMinutes, summary.plannedRegularMinutes);
      const salary = Number(employee.salary) || 0;
      const hourlyDivisor = 30 * (REGULAR_DAY_MINUTES / 60);
      const hourlyRate = hourlyDivisor > 0 ? salary / hourlyDivisor : 0;
      const daysWithPay = days.map((day) => ({
        ...day,
        pay: buildDailyPay(day, hourlyRate),
      }));
      const isDismissedInPayrollMonth = isEmployeeDismissedInMonth(employee, monthKey);
      const workedRegularSalary = Math.min(
        salary,
        (Math.max(0, Number(summary.regularWorkedMinutes) || 0) / 60) * hourlyRate,
      );
      const salaryExpected = isDismissedInPayrollMonth ? workedRegularSalary : salary;
      const additionalPayrollTotal = daysWithPay.reduce((total, day) => {
        const items = day.pay?.items || [];

        return total + items.reduce((dayTotal, item) =>
          dayTotal + (item.label === "Laboral" ? 0 : Number(item.rawAmount) || 0), 0);
      }, 0);
      const plannedPayrollTotal =
        (summary.plannedSupplementaryMinutes / 60) * hourlyRate * SUPPLEMENTARY_SURCHARGE_MULTIPLIER +
        (summary.plannedExtraordinaryMinutes / 60) * hourlyRate * EXTRAORDINARY_SURCHARGE_MULTIPLIER;
      const realPayrollTotal =
        (summary.detectedSupplementaryMinutes / 60) * hourlyRate * SUPPLEMENTARY_SURCHARGE_MULTIPLIER +
        (summary.detectedExtraordinaryMinutes / 60) * hourlyRate * EXTRAORDINARY_SURCHARGE_MULTIPLIER;
      const salaryPlanned = salaryExpected + plannedPayrollTotal;
      const salaryReal = salaryExpected + realPayrollTotal;
      const salaryProjected = salaryExpected + additionalPayrollTotal;

      return {
        employee: {
          id: employeeKey,
          fullName: employee.fullName || "",
          dni: employee.dni || "",
          branchCode: employee.branchCode || "",
          branchName: employee.branchName || employee.branchCode || "",
          areaCode: employee.areaCode || "",
          areaName: employee.areaName || "",
          roleCode: employee.roleCode || "",
          roleName: employee.roleName || "",
          isActive: employee.isActive !== false,
          terminationDate: employee.terminationDate ? employee.terminationDate.toISOString().slice(0, 10) : "",
        },
        hasSchedule: Boolean(assignment) || hasManualScheduleDays,
        templateName: assignment?.templateName || "",
        summary: {
          ...summary,
          baseLaborDays,
          regularTargetMinutes,
          regularTargetLabel: minutesLabel(regularTargetMinutes),
          regularDeficitMinutes: Math.max(0, summary.plannedRegularMinutes - summary.regularWorkedMinutes),
          regularDeficitLabel: minutesLabel(Math.max(0, summary.plannedRegularMinutes - summary.regularWorkedMinutes)),
          plannedRegularLabel: minutesLabel(summary.plannedRegularMinutes),
          plannedSupplementaryLabel: minutesLabel(summary.plannedSupplementaryMinutes),
          plannedExtraordinaryLabel: minutesLabel(summary.plannedExtraordinaryMinutes),
          salaryExpected: money(salaryExpected),
          salaryExpectedRaw: salaryExpected,
          salaryExpectedValue: money(salaryExpected),
          salaryExpectedLabel: moneyLabel(salaryExpected),
          salaryPlanned: money(salaryPlanned),
          salaryPlannedLabel: moneyLabel(salaryPlanned),
          salaryReal: money(salaryReal),
          salaryRealLabel: moneyLabel(salaryReal),
          salaryProjected: money(salaryProjected),
          salaryProjectedLabel: moneyLabel(salaryProjected),
          hourlyRate: money(hourlyRate),
          hourlyRateRaw: hourlyRate,
          hourlyRateLabel: moneyLabel(hourlyRate),
          supplementaryMultiplier: SUPPLEMENTARY_SURCHARGE_MULTIPLIER,
          extraordinaryMultiplier: EXTRAORDINARY_SURCHARGE_MULTIPLIER,
          regularWorkedLabel: minutesLabel(summary.regularWorkedMinutes),
          supplementaryLabel: minutesLabel(summary.supplementaryMinutes),
          detectedSupplementaryLabel: minutesLabel(summary.detectedSupplementaryMinutes),
          extraordinaryLabel: minutesLabel(summary.extraordinaryMinutes),
          detectedExtraordinaryLabel: minutesLabel(summary.detectedExtraordinaryMinutes),
          unplannedExtraLabel: minutesLabel(summary.unplannedExtraMinutes),
          additionalSupplementaryLabel: minutesLabel(summary.additionalSupplementaryMinutes),
          justifiedWorkLabel: minutesLabel(summary.justifiedWorkMinutes),
          discountedWorkLabel: minutesLabel(summary.discountedWorkMinutes),
          lateLabel: minutesLabel(summary.lateMinutes),
          earlyLeaveLabel: minutesLabel(summary.earlyLeaveMinutes),
        },
        days: daysWithPay,
      };
    });

    const summary = rows.reduce(
      (totals, row) => {
        totals.employees += 1;
        if (!row.hasSchedule) totals.withoutSchedule += 1;
        if (row.summary.issueDays > 0) totals.withIssues += 1;
        totals.issueDays += row.summary.issueDays;
        totals.absentDays += row.summary.absentDays;
        totals.missingPunchDays += row.summary.missingPunchDays;
        totals.incompletePunchDays += row.summary.incompletePunchDays;
        totals.operationalAlertDays += row.summary.operationalAlertDays;
        totals.lateDays += row.summary.lateDays;
        totals.earlyLeaveDays += row.summary.earlyLeaveDays;
        totals.lateMinutes += row.summary.lateMinutes;
        totals.earlyLeaveMinutes += row.summary.earlyLeaveMinutes;
        totals.extraDays += row.summary.extraDays;
        totals.unplannedWorkDays += row.summary.unplannedWorkDays;
        totals.plannedRegularMinutes += row.summary.plannedRegularMinutes;
        totals.plannedSupplementaryMinutes += row.summary.plannedSupplementaryMinutes;
        totals.plannedExtraordinaryMinutes += row.summary.plannedExtraordinaryMinutes;
        totals.regularWorkedMinutes += row.summary.regularWorkedMinutes;
        totals.supplementaryMinutes += row.summary.supplementaryMinutes;
        totals.detectedSupplementaryMinutes += row.summary.detectedSupplementaryMinutes;
        totals.extraordinaryMinutes += row.summary.extraordinaryMinutes;
        totals.detectedExtraordinaryMinutes += row.summary.detectedExtraordinaryMinutes;
        totals.unplannedExtraMinutes += row.summary.additionalSupplementaryMinutes;
        totals.additionalSupplementaryMinutes = (totals.additionalSupplementaryMinutes || 0) + row.summary.additionalSupplementaryMinutes;
        totals.justifiedWorkMinutes += row.summary.justifiedWorkMinutes || 0;
        totals.discountedWorkMinutes += row.summary.discountedWorkMinutes || 0;
        return totals;
      },
      {
        employees: 0,
        withIssues: 0,
        withoutSchedule: 0,
        issueDays: 0,
        absentDays: 0,
        missingPunchDays: 0,
        incompletePunchDays: 0,
        operationalAlertDays: 0,
        lateDays: 0,
        earlyLeaveDays: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        extraDays: 0,
        unplannedWorkDays: 0,
        plannedRegularMinutes: 0,
        plannedSupplementaryMinutes: 0,
        plannedExtraordinaryMinutes: 0,
        regularWorkedMinutes: 0,
        supplementaryMinutes: 0,
        detectedSupplementaryMinutes: 0,
        extraordinaryMinutes: 0,
        detectedExtraordinaryMinutes: 0,
        unplannedExtraMinutes: 0,
        additionalSupplementaryMinutes: 0,
        justifiedWorkMinutes: 0,
        discountedWorkMinutes: 0,
      },
    );

    return NextResponse.json({
      monthKey,
      summary: {
        ...summary,
        plannedRegularLabel: minutesLabel(summary.plannedRegularMinutes),
        plannedSupplementaryLabel: minutesLabel(summary.plannedSupplementaryMinutes),
        plannedExtraordinaryLabel: minutesLabel(summary.plannedExtraordinaryMinutes),
        regularWorkedLabel: minutesLabel(summary.regularWorkedMinutes),
        supplementaryLabel: minutesLabel(summary.supplementaryMinutes),
        detectedSupplementaryLabel: minutesLabel(summary.detectedSupplementaryMinutes),
        extraordinaryLabel: minutesLabel(summary.extraordinaryMinutes),
        detectedExtraordinaryLabel: minutesLabel(summary.detectedExtraordinaryMinutes),
        unplannedExtraLabel: minutesLabel(summary.unplannedExtraMinutes),
        additionalSupplementaryLabel: minutesLabel(summary.additionalSupplementaryMinutes),
        justifiedWorkLabel: minutesLabel(summary.justifiedWorkMinutes),
        discountedWorkLabel: minutesLabel(summary.discountedWorkMinutes),
        lateLabel: minutesLabel(summary.lateMinutes),
        earlyLeaveLabel: minutesLabel(summary.earlyLeaveMinutes),
      },
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo comparar la asistencia con el horario." },
      { status: 400 },
    );
  }
}
