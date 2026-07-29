import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import { attendancePayrollPolicy } from "@/modules/planner/lib/attendance/exemptions";
import { dedupePunchesByMinute } from "@/modules/planner/lib/attendance/punchIdentity";
import {
  formatEcuadorDate,
  formatEcuadorDateKey,
  formatEcuadorMonthKey,
  formatEcuadorTime,
  makeEcuadorDate,
  setEcuadorTime,
} from "@/lib/datetime/ecuador";
import connectToDatabase from "@/lib/db/mongodb";
import { buildEmployeeActiveInMonthQuery, isEmployeeDismissedInMonth } from "@/modules/company/submodules/people/lib/employees";
import { buildGeneratedDays } from "@/modules/planner/lib/planning/scheduleAssignments";
import { AttendanceDayDecision } from "@/modules/planner/models";
import { parseMonthKey } from "@/modules/planner/lib/planning/holidays";
import { AttendancePunch } from "@/modules/planner/models";
import { BaseScheduleTemplate } from "@/modules/planner/models";
import { Employee } from "@/modules/company/models";
import { Role } from "@/modules/company/models";
import { Holiday } from "@/modules/planner/models";
import {
  DEFAULT_ATTENDANCE_GRACE_MINUTES,
  DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES,
  EXTRAORDINARY_PAY_MULTIPLIER,
  MONTHLY_HOURLY_DIVISOR,
  SUPPLEMENTARY_PAY_MULTIPLIER,
} from "@/modules/planner/lib/payroll/laborConstants";
import { OperationalException } from "@/modules/planner/models";
import { calculatePayrollAdditionalRate, calculatePayrollHourlyRate } from "@/modules/planner/lib/payroll/rates";
import { resolveOperationalExceptionEffect } from "@/modules/planner/lib/planning/exceptions";
import { APPROVED_VACATION_STATUS_QUERY } from "@/modules/planner/lib/planning/vacations";
import { ScheduleAssignment } from "@/modules/planner/models";
import { ScheduleRuleConfig } from "@/modules/planner/models";
import { VacationRequest } from "@/modules/planner/models";

const REGULAR_DAY_MINUTES = 8 * 60;
const MIN_TWO_PUNCH_SPAN_MINUTES = 60;
const MIN_EXTRAORDINARY_TWO_PUNCH_SPAN_MINUTES = 30;
const MIN_REAL_LUNCH_MINUTES = 5;
const MAX_REAL_LUNCH_MINUTES = 180;
const SUPPLEMENTARY_SURCHARGE_MULTIPLIER = SUPPLEMENTARY_PAY_MULTIPLIER;
const EXTRAORDINARY_SURCHARGE_MULTIPLIER = EXTRAORDINARY_PAY_MULTIPLIER;
const ATTENDANCE_ISSUE_TAGS = new Set([
  "Sin picadas",
  "Picadas incompletas",
  "Picadas de más",
  "Salida anticipada",
  "Atraso",
  "No planificado",
  "Trabajo sin horario",
  "Tiempo adicional",
]);
const BLOCKING_ATTENDANCE_TAGS = new Set([
  "Sin picadas",
  "Picadas incompletas",
  "Picadas de más",
  "No planificado",
  "Trabajo sin horario",
]);
const SECONDARY_ATTENDANCE_TAGS = new Set([
  "Atraso",
  "Salida anticipada",
  "Tiempo adicional",
]);
const UNPLANNED_WORK_TAGS = new Set(["No planificado", "Trabajo sin horario"]);
const PENDING_LOAD_SUPPRESSED_TAGS = new Set([
  ...ATTENDANCE_ISSUE_TAGS,
  "Atraso justificado",
  "Salida justificada",
  "Jornada incompleta",
]);
const WEEKDAY_LABEL_FORMATTER = new Intl.DateTimeFormat("es-EC", {
  weekday: "short",
  timeZone: "America/Guayaquil",
});

function currentMonthKey() {
  return formatEcuadorMonthKey();
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function minutesLabel(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const rest = value % 60;

  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function plannedMinutesLabel(minutes) {
  const value = Math.max(0, Number(minutes) || 0);

  return value ? minutesLabel(value) : "--";
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

    const amount = (safeMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, multiplier) * sign;
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

  const normalizedTime = String(timeValue)
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

  return setEcuadorTime(new Date(`${dateKey}T12:00:00.000Z`), {
    hours,
    minutes,
    seconds: 0,
    milliseconds: 0,
  });
}

function resolveLunchDurationMinutes(day) {
  const explicitDuration = Number(day?.lunchDurationMinutes) || 0;

  if (explicitDuration > 0) return explicitDuration;

  const lunchStart = combineDateAndTime(day?.dateKey, day?.lunchStartTime);
  const lunchEnd = combineDateAndTime(day?.dateKey, day?.lunchEndTime);

  if (!lunchStart || !lunchEnd || lunchEnd <= lunchStart) return 0;

  return Math.max(0, Math.round((lunchEnd - lunchStart) / 60000));
}

function parseScheduleTimeToMinutes(value) {
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

function resolveLunchDurationFromScheduleText(day) {
  const text = [
    day?.scheduleLabel,
    day?.templateName,
    day?.plannedTemplateName,
    day?.holidayPlannedScheduleLabel,
  ].filter(Boolean).join(" ");
  const matches = text.match(/\b\d{1,2}(?::|H)\d{2}\b/g) || [];

  if (matches.length < 4) return 0;

  const lunchStart = parseScheduleTimeToMinutes(matches[1]);
  const lunchEnd = parseScheduleTimeToMinutes(matches[2]);

  if (lunchStart === null || lunchEnd === null || lunchEnd <= lunchStart) return 0;

  return lunchEnd - lunchStart;
}

function resolvePlannedLunchDurationMinutes(day) {
  return resolveLunchDurationMinutes(day) || resolveLunchDurationFromScheduleText(day);
}

function isPlannedWorkDay(day) {
  return ["workday", "weekend_overtime"].includes(day?.dayType);
}

function isPlannedPaidDay(day) {
  return ["workday", "weekend_overtime", "vacation"].includes(day?.dayType);
}

function isExtraordinaryAttendanceDay(day) {
  return Boolean(day?.isHoliday) || ["weekend_overtime", "off_day"].includes(day?.dayType);
}

function hasIncompletePunchStructure({ punchCount, expectedPunches, hasLunch, hasInsufficientTwoPunchSpan }) {
  if (punchCount <= 0) return false;
  if (punchCount === 1 || punchCount === 3) return true;
  if (hasLunch && punchCount === 2) return true;
  if (punchCount === 2 && expectedPunches > 2) return true;
  if (punchCount === 2 && !hasLunch && hasInsufficientTwoPunchSpan) return true;

  return false;
}

function minimumTwoPunchSpanMinutes(day, employee = {}) {
  const areaCode = String(employee?.areaCode || "").trim().toUpperCase();
  const roleCode = String(employee?.roleCode || "").trim().toUpperCase();

  if (areaCode === "OPER" && roleCode === "TECBOD" && isExtraordinaryAttendanceDay(day)) {
    return MIN_EXTRAORDINARY_TWO_PUNCH_SPAN_MINUTES;
  }

  return MIN_TWO_PUNCH_SPAN_MINUTES;
}

function isWeekendDateKey(dateKey) {
  const day = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();

  return day === 0 || day === 6;
}

function isAfterAttendanceReviewCutoffDateKey(dateKey, cutoffDateKey) {
  const normalizedDateKey = String(dateKey || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateKey)) {
    return false;
  }

  if (!cutoffDateKey) {
    return true;
  }

  return normalizedDateKey > cutoffDateKey;
}

function suppressPendingAttendanceLoadNoise(day, cutoffDateKey) {
  if (!isAfterAttendanceReviewCutoffDateKey(day?.dateKey, cutoffDateKey)) {
    return day;
  }

  const tags = (day.tags || []).filter((tag) => !PENDING_LOAD_SUPPRESSED_TAGS.has(tag));

  return {
    ...day,
    isPendingAttendanceLoad: true,
    tags,
    hasIssue: false,
    lateMinutes: 0,
    entryLateMinutes: 0,
    earlyLeaveMinutes: 0,
    lateLabel: "--",
    earlyLeaveLabel: "--",
    additionalSupplementaryMinutes: 0,
    additionalSupplementaryLabel: "--",
  };
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
    vacation: "Vacaciones",
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

function buildScheduleHoursLabel(day) {
  if (!day?.startTime || !day?.endTime) return "";

  if (day.lunchStartTime && day.lunchEndTime) {
    return `${day.startTime} - ${day.lunchStartTime} / ${day.lunchEndTime} - ${day.endTime}`;
  }

  return `${day.startTime} - ${day.endTime}`;
}

function resolveScheduledMinutes(day) {
  const hasPlannedExtraSchedule = day?.dayType === "off_day" && day?.startTime && day?.endTime;

  if (!isPlannedWorkDay(day) && !hasPlannedExtraSchedule) {
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

  const lunchDiscount = resolvePlannedLunchDurationMinutes(day);
  const scheduledWorkedMinutes = Math.max(0, Math.round((scheduleEnd - scheduleStart) / 60000) - lunchDiscount);
  const plannedRegularMinutes = day.dayType === "workday"
    ? Math.min(scheduledWorkedMinutes, REGULAR_DAY_MINUTES)
    : 0;
  const plannedSupplementaryMinutes = day.dayType === "workday"
    ? Math.max(0, scheduledWorkedMinutes - plannedRegularMinutes)
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
    Math.round((scheduleEnd - scheduleStart) / 60000) - resolvePlannedLunchDurationMinutes(day),
  );
}

function resolveHolidayPlannedNetMinutes(day) {
  const scheduleStart = combineDateAndTime(day?.dateKey, day?.holidayPlannedStartTime);
  const scheduleEnd = combineDateAndTime(day?.dateKey, day?.holidayPlannedEndTime);

  if (!scheduleStart || !scheduleEnd || scheduleEnd <= scheduleStart) {
    return 0;
  }

  const lunchStart = combineDateAndTime(day?.dateKey, day?.holidayPlannedLunchStartTime);
  const lunchEnd = combineDateAndTime(day?.dateKey, day?.holidayPlannedLunchEndTime);
  const lunchDurationMinutes = lunchStart && lunchEnd && lunchEnd > lunchStart
    ? Math.max(0, Math.round((lunchEnd - lunchStart) / 60000))
    : Number(day?.lunchDurationMinutes) || 0;

  return Math.max(0, Math.round((scheduleEnd - scheduleStart) / 60000) - lunchDurationMinutes);
}

function hasPlannedHolidaySchedule(day) {
  return Boolean(day?.isHoliday) && resolveHolidayPlannedNetMinutes(day) > 0;
}

function resolvePlannedExtraordinaryMinutes(day) {
  if (day?.plannedScheduleExists === false) {
    return 0;
  }

  if (day?.payrollPolicy?.appliesExtraordinaryHours === false) {
    return 0;
  }

  const plannedDayType = day?.plannedDayType || day?.dayType;

  if (plannedDayType === "weekend_overtime") {
    return Number(day.originalScheduledWorkedMinutes) || Number(day.scheduledWorkedMinutes) || resolveScheduledNetMinutes(day);
  }

  if (day?.isHoliday) {
    return Number(day.plannedExtraordinaryMinutes) ||
      Number(day.originalScheduledWorkedMinutes) ||
      resolveHolidayPlannedNetMinutes(day) ||
      resolveScheduledNetMinutes(day);
  }

  return 0;
}

function resolvePlannedRegularMinutes(day) {
  return Number(day?.plannedRegularMinutes) || 0;
}

function resolvePlannedSupplementaryMinutes(day) {
  return Number(day?.plannedSupplementaryMinutes) || 0;
}

function resolveVisibleLateMinutes(day) {
  if (!day) return 0;

  const entryLateMinutes = Math.max(0, Number(day.entryLateMinutes ?? day.lateMinutes) || 0);
  const lunchLateMinutes = Math.max(
    0,
    Number(day.lunchOverageMinutes ?? day.lunchOverageRemainderMinutes) || 0,
  );
  const detectedLateMinutes = Math.max(
    Number(day.lateMinutes) || 0,
    Number(day.authorization?.adjustedLateMinutes) || 0,
    Number(day.authorization?.detectedLateMinutes) || 0,
    entryLateMinutes + lunchLateMinutes,
  );

  return Math.max(0, detectedLateMinutes);
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

function applyLunchPolicyByDay(day) {
  const dayOfWeek = new Date(`${day?.dateKey}T12:00:00.000Z`).getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  if (!day?.startTime || !day?.endTime) {
    return day;
  }

  if (day.source === "operational_exception_schedule" && !day.lunchStartTime && !day.lunchEndTime) {
    return {
      ...day,
      lunchDurationMinutes: 0,
    };
  }

  if (!isWeekend) {
    return day;
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
    lunchDurationMinutes: isFullWeekendShift ? (Number(day.lunchDurationMinutes) || 60) : 0,
  };
}

function resolveHolidayLunchDiscountMinutes(day = {}) {
  return Math.max(0, Number(day.lunchDurationMinutes) || 60);
}

function buildReferenceDaysInRange(contextStart, contextEnd, holidayDateKeys = new Set()) {
  const days = [];

  for (let date = contextStart; date < contextEnd; date = addDays(date, 1)) {
    const dateKey = formatEcuadorDateKey(date);

    days.push({
      dateKey,
      dayOfWeek: date.getDay(),
      label: WEEKDAY_LABEL_FORMATTER.format(date).replace(".", ""),
      dayType: "off_day",
      isHoliday: holidayDateKeys.has(dateKey),
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
  const assignmentTemplateId = assignment?.template?.toString?.() || String(assignment?.template || "");

  return referenceDays.map((referenceDay) => {
    const assignmentDay = assignmentDaysByDate.get(referenceDay.dateKey) || {};
    const dayTemplateId = assignmentDay.template?.toString?.() || String(assignmentDay.template || "");
    const fallbackTemplateId = assignmentDay.source === "template" ? assignmentTemplateId : "";

    if (referenceDay.isHoliday) {
      const normalizedAssignmentDayType = assignmentDay.dayType === "holiday"
        ? "off_day"
        : assignmentDay.dayType || referenceDay.dayType;
      const normalizedAssignmentSource = assignmentDay.dayType === "holiday" || assignmentDay.source === "holiday"
        ? "calendar"
        : assignmentDay.source || referenceDay.source;

      return {
        ...referenceDay,
        ...assignmentDay,
        isHoliday: true,
        dayType: normalizedAssignmentDayType,
        source: normalizedAssignmentSource,
        dayOfWeek: assignmentDay.dayOfWeek ?? referenceDay.dayOfWeek,
        label: assignmentDay.label || referenceDay.label,
        graceMinutes: assignmentDay.graceMinutes ?? referenceDay.graceMinutes,
        plannedTemplateId: dayTemplateId || fallbackTemplateId,
        plannedTemplateName: assignmentDay.templateName || assignment?.templateName || "",
        holidayPlannedStartTime: assignmentDay.startTime || "",
        holidayPlannedLunchStartTime: assignmentDay.lunchStartTime || "",
        holidayPlannedLunchEndTime: assignmentDay.lunchEndTime || "",
        holidayPlannedEndTime: assignmentDay.endTime || "",
        holidayPlannedScheduleLabel: buildScheduleHoursLabel(assignmentDay),
      };
    }

    return {
      ...referenceDay,
      ...assignmentDay,
      plannedTemplateId: dayTemplateId || fallbackTemplateId,
      plannedTemplateName: assignmentDay.templateName || assignment?.templateName || "",
    };
  });
}

function buildRoleScheduleTemplate(role, templatesById = new Map()) {
  if (role?.scheduleMode !== "fixed") return null;

  const templateId = role?.fixedScheduleTemplate?.toString?.() || String(role?.fixedScheduleTemplate || "");
  const sourceTemplate = templateId ? templatesById.get(templateId) : null;
  const snapshotRows = Array.isArray(role.fixedScheduleWeeklyRows) ? role.fixedScheduleWeeklyRows : [];
  const weeklyRows = snapshotRows.length ? snapshotRows : sourceTemplate?.weeklyRows || [];

  if (!weeklyRows.length) return null;

  return {
    ...(sourceTemplate || {}),
    _id: sourceTemplate?._id || role.fixedScheduleTemplate || undefined,
    name: role.fixedScheduleTemplateName || sourceTemplate?.name || "HORARIO COPIADO",
    areaCode: role.areaCode || role.fixedScheduleAreaCode || sourceTemplate?.areaCode || "",
    areaName: role.areaName || role.fixedScheduleAreaName || sourceTemplate?.areaName || "",
    roleCode: role.fixedScheduleRoleCode || sourceTemplate?.roleCode || role.code || "",
    roleName: role.fixedScheduleRoleName || sourceTemplate?.roleName || role.name || "",
    rotationGroup: role.fixedScheduleRotationGroup || sourceTemplate?.rotationGroup || "",
    weeklyRows,
  };
}

function buildFixedScheduleFallbackAssignments({ employees = [], rolesByCode = new Map(), templates = [], monthKeys = [], holidays = [] }) {
  const templatesById = new Map();
  const holidaysByMonth = new Map();
  const assignments = [];

  templates.forEach((template) => {
    templatesById.set(template._id.toString(), template);
  });

  holidays.forEach((holiday) => {
    const holidayMonthKey = monthKeyFromDateKey(holiday.dateKey);

    if (!holidaysByMonth.has(holidayMonthKey)) {
      holidaysByMonth.set(holidayMonthKey, []);
    }

    holidaysByMonth.get(holidayMonthKey).push(holiday);
  });

  employees.forEach((employee) => {
    const roleCode = String(employee.roleCode || "").trim().toUpperCase();
    const role = rolesByCode.get(roleCode);
    const template = buildRoleScheduleTemplate(role, templatesById);

    if (!template) {
      return;
    }

    monthKeys.forEach((fallbackMonthKey) => {
      assignments.push({
        monthKey: fallbackMonthKey,
        employee: employee._id,
        employeeName: employee.fullName || "",
        areaCode: employee.areaCode || template.areaCode || "",
        areaName: employee.areaName || template.areaName || "",
        roleCode: template.roleCode || employee.roleCode || "",
        roleName: template.roleName || employee.roleName || "",
        template: template._id,
        templateName: template.name || "",
        rotationGroup: template.rotationGroup || "",
        generatedDays: buildGeneratedDays(
          fallbackMonthKey,
          template,
          holidaysByMonth.get(fallbackMonthKey) || [],
          [],
          { weekdaysOnly: true },
        ),
        weeklyPlan: [],
        source: "fixed_template",
      });
    });
  });

  return assignments;
}

function assignmentMatchesCurrentEmployeeOrg(assignment, employee) {
  if (!assignment || !employee) return true;

  const assignmentAreaCode = normalizeCode(assignment.areaCode);
  const employeeAreaCode = normalizeCode(employee.areaCode);

  if (assignmentAreaCode && employeeAreaCode && assignmentAreaCode !== employeeAreaCode) {
    return false;
  }

  const assignmentRoleCode = normalizeCode(assignment.roleCode);
  const employeeRoleCode = normalizeCode(employee.roleCode);

  if (assignmentRoleCode && employeeRoleCode && assignmentRoleCode !== employeeRoleCode) {
    return false;
  }

  return true;
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
  if (day.dayType === "off_day") return day;

  return {
    ...day,
    dayType: "vacation",
    tags: [...new Set([...(day.tags || []), "Vacaciones"])],
    source: "vacation",
  };
}

function enforceHolidayDay(day, holidayDateKeys = new Set()) {
  if (!holidayDateKeys.has(day.dateKey)) return day;

  const hasPlannedHolidaySchedule = isPlannedWorkDay(day) && day.startTime && day.endTime;
  const holidayPlannedStartTime = day.holidayPlannedStartTime || (hasPlannedHolidaySchedule ? day.startTime : "");
  const holidayPlannedLunchStartTime = day.holidayPlannedLunchStartTime || (hasPlannedHolidaySchedule ? day.lunchStartTime : "");
  const holidayPlannedLunchEndTime = day.holidayPlannedLunchEndTime || (hasPlannedHolidaySchedule ? day.lunchEndTime : "");
  const holidayPlannedEndTime = day.holidayPlannedEndTime || (hasPlannedHolidaySchedule ? day.endTime : "");
  const holidayPlannedScheduleLabel = day.holidayPlannedScheduleLabel ||
    (hasPlannedHolidaySchedule ? buildScheduleHoursLabel(day) : "");

  return {
    ...day,
    isHoliday: true,
    tags: [...new Set([...(day.tags || []), "Feriado"])],
    holidayPlannedStartTime,
    holidayPlannedLunchStartTime,
    holidayPlannedLunchEndTime,
    holidayPlannedEndTime,
    holidayPlannedScheduleLabel,
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
    !isWeekendDateKey(day.dateKey) && !day.isHoliday
  )).length;
}

function cleanPayrollTags(tags) {
  return [...new Set(tags
    .map(normalizeAttendanceTag)
    .filter(Boolean)
    .filter((tag) =>
      !["Suplementaria", "Suplementarias adicionales", "Extraordinaria", "Todo autorizado"].includes(tag),
    ))];
}

function normalizeAttendanceTag(tag) {
  if (tag === "Falta almuerzo") return "Picadas incompletas";
  if (tag === "Tiempo adicional sin justificar") return "Tiempo adicional";
  return tag;
}

function isAttendanceIssueTag(tag) {
  return ATTENDANCE_ISSUE_TAGS.has(normalizeAttendanceTag(tag));
}

function hasBlockingAttendanceIssue(tags = []) {
  return tags.some((tag) => BLOCKING_ATTENDANCE_TAGS.has(normalizeAttendanceTag(tag)));
}

function hasPendingOperationalAlert(day) {
  return hasBlockingAttendanceIssue(day?.tags || []);
}

function hasPendingLateAlert(day) {
  if (!day || hasPendingOperationalAlert(day)) return false;
  if (day.authorization?.lateResolved === true) return false;
  if (day.authorization?.decision === "reviewed") return false;

  return (Number(day.lateMinutes) || 0) > 0 ||
    (Number(day.entryLateMinutes) || 0) > 0 ||
    (Number(day.lunchOverageMinutes ?? day.lunchOverageRemainderMinutes) || 0) > 0 ||
    (Number(day.earlyLeaveMinutes) || 0) > 0;
}

function hasPendingAdditionalAlert(day) {
  if (!day || hasPendingOperationalAlert(day) || hasPendingLateAlert(day)) return false;
  if (day.authorization?.additionalResolved === true) return false;
  if ((day.tags || []).map(normalizeAttendanceTag).includes("Tiempo adicional")) return true;

  const hasPlannedTime =
    (Number(day.plannedRegularMinutes) || 0) > 0 ||
    (Number(day.plannedSupplementaryMinutes) || 0) > 0 ||
    (Number(day.plannedExtraordinaryMinutes) || 0) > 0 ||
    (Number(day.scheduledWorkedMinutes) || 0) > 0;
  const toleranceMinutes = hasPlannedTime
    ? Math.max(
        0,
        Number(day.lateDepartureToleranceMinutes ?? DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES) || 0,
      )
    : 0;
  const pendingSupplementaryMinutes = Math.max(
    Number(day.additionalSupplementaryMinutes) || 0,
    (Number(day.detectedSupplementaryMinutes) || 0) - (Number(day.supplementaryMinutes) || 0),
  );
  const pendingExtraordinaryMinutes = Math.max(
    0,
    (Number(day.detectedExtraordinaryMinutes) || 0) - (Number(day.extraordinaryMinutes) || 0),
  );

  return Math.max(pendingSupplementaryMinutes, pendingExtraordinaryMinutes) > toleranceMinutes;
}

function decisionWithResolutionState(decision) {
  if (!decision) return decision;

  const note = String(decision.note || "");
  const isAdditionalDecision = note.startsWith("Tiempo adicional") || [
    "full",
    "planned",
    "none",
    "discount_day",
    "pay_planned_day",
    "complete_regular_day",
  ].includes(decision.decision);
  const preservesDetectedDelay =
    (Number(decision.adjustedLateMinutes) || 0) >= (Number(decision.detectedLateMinutes) || 0) &&
    (Number(decision.adjustedEarlyLeaveMinutes) || 0) >= (Number(decision.detectedEarlyLeaveMinutes) || 0);
  const isLateDecision = [
    "reviewed",
    "resolve_late",
    "justify_late",
    "justify_early_leave",
    "none",
    "discount_day",
    "pay_planned_day",
    "complete_regular_day",
  ].includes(decision.decision) || (note.startsWith("Tiempo adicional") && preservesDetectedDelay);

  return {
    ...decision,
    additionalResolved: decision.additionalResolved === true || isAdditionalDecision,
    lateResolved: decision.lateResolved === true || isLateDecision,
  };
}

function suppressSecondaryAttendanceIssues(day) {
  const tags = [...new Set((day?.tags || []).map(normalizeAttendanceTag).filter(Boolean))];

  if (!hasBlockingAttendanceIssue(tags)) return day;

  const nextTags = tags.filter((tag) => !SECONDARY_ATTENDANCE_TAGS.has(tag));

  return {
    ...day,
    tags: nextTags,
    hasIssue: nextTags.some(isAttendanceIssueTag),
    lateMinutes: 0,
    lateLabel: "--",
    entryLateMinutes: 0,
    earlyLeaveMinutes: 0,
    earlyLeaveLabel: "--",
    additionalSupplementaryMinutes: 0,
    additionalSupplementaryLabel: "--",
    detectedSupplementaryMinutes: 0,
    detectedSupplementaryLabel: "--",
    detectedExtraordinaryMinutes: 0,
    detectedExtraordinaryLabel: "--",
    supplementaryMinutes: 0,
    supplementaryLabel: "--",
    extraordinaryMinutes: 0,
    extraordinaryLabel: "--",
  };
}

function hasAssignedScheduleDay(day) {
  if (!day || day.source === "calendar" || day.source === "employment_pending" || day.source === "employment_ended") {
    return false;
  }

  return true;
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

function isResolvedOperationalException(exception = {}) {
  return String(exception.resolution || "pending").trim() !== "pending";
}

function buildOperationalExceptionDecisionMap(exceptions = []) {
  const decisions = new Map();

  exceptions.forEach((exception) => {
    if (!isResolvedOperationalException(exception)) return;

    const effect = resolveOperationalExceptionEffect(exception);
    const attendanceMode = exception.attendanceMode || "";

    if (effect === "planning_change" || effect === "manual_punch" || effect === "alert_review") {
      return;
    }

    if (!["complete_scheduled_time", "paid_leave", "approved_work_time", "discount_day"].includes(exception.resolution)) return;
    if (effect === "external_work" && attendanceMode === "use_punches") return;

    const employeeId = toId(exception.employee);
    if (!employeeId || !exception.dateKey) return;

    if (effect === "authorized_overtime" && exception.resolution === "approved_work_time") {
      const authorizedMinutes = justifiedIntervalMinutes(exception);

      if (!authorizedMinutes) return;

      decisions.set(`${employeeId}|${exception.dateKey}`, {
        employee: exception.employee,
        dateKey: exception.dateKey,
        decision: "full",
        authorizedAdditionalMinutes: authorizedMinutes,
        allowSupplementaryTime: true,
        note: [
          "Autorización de tiempo adicional",
          exception.resolutionNotes || exception.notes || "",
        ].filter(Boolean).join(": "),
        decidedBy: exception.authorizedBy || exception.registeredBy || "TALENTO HUMANO",
        source: "operational_exception",
      });
      return;
    }

    const scope = exception.scope || "full_day";
    if (scope === "partial_day" || scope === "other") return;

    const startKey = exception.dateKey;
    const endKey = exception.endDateKey || startKey;
    const decision = effect === "unpaid_absence" || exception.resolution === "discount_day"
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
      allowSupplementaryTime:
        exception.payMode === "regular_and_extra" || exception.allowSupplementaryTime === true,
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
    if (!isResolvedOperationalException(exception)) return;

    const effect = resolveOperationalExceptionEffect(exception);
    const attendanceMode = exception.attendanceMode || "";
    const shouldUseAuthorizedExternalWork = effect === "external_work" && attendanceMode === "use_authorized_schedule";
    const shouldUseApprovedInterval = exception.resolution === "approved_work_time" && exception.countsAsWorkedTime !== false;

    if (!shouldUseAuthorizedExternalWork && !shouldUseApprovedInterval) return;
    if (effect === "planning_change" || effect === "manual_punch" || effect === "alert_review") return;

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
        allowSupplementaryTime: exception.payMode === "regular_and_extra" || exception.allowSupplementaryTime !== false,
        note: exception.resolutionNotes || exception.notes || "",
        decidedBy: exception.authorizedBy || exception.registeredBy || "",
        statusLabel: effect === "paid_partial_leave" ? "Permiso sin descuento" : "Trabajo fuera justificado",
      });
    }
  });

  return intervalsByKey;
}

function buildDiscountedWorkIntervalMap(exceptions = []) {
  const intervalsByKey = new Map();

  exceptions.forEach((exception) => {
    if (!isResolvedOperationalException(exception)) return;

    const effect = resolveOperationalExceptionEffect(exception);

    if (effect !== "unpaid_absence" && exception.resolution !== "discount_day") return;

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
    if (!isResolvedOperationalException(exception)) return;

    const effect = resolveOperationalExceptionEffect(exception);

    if (!["planning_change", "external_work"].includes(effect)) return;
    if (exception.scope === "other") return;

    const isAuthorizedExtraDay = effect === "planning_change" && exception.isExtraDay === true;
    const plannedDayType = effect === "planning_change" && exception.plannedDayType === "off_day"
      ? "off_day"
      : isAuthorizedExtraDay
        ? "weekend_overtime"
      : "workday";
    const startTime = plannedDayType === "off_day"
      ? ""
      : exception.plannedStartTime || (effect === "external_work" ? exception.startTime : "");
    const endTime = plannedDayType === "off_day"
      ? ""
      : exception.plannedEndTime || (effect === "external_work" ? exception.endTime : "");

    if (plannedDayType !== "off_day" && (!startTime || !endTime)) return;

    const employeeId = toId(exception.employee);
    if (!employeeId || !exception.dateKey) return;

    const startKey = exception.dateKey;
    const endKey = exception.endDateKey || startKey;
    const lunchStartTime = exception.plannedLunchStartTime || "";
    const lunchEndTime = exception.plannedLunchEndTime || "";
    const lunchDurationMinutes = lunchStartTime && lunchEndTime
      ? Number(exception.plannedLunchDurationMinutes) || 0
      : 0;

    const applicableWeekdays = Array.isArray(exception.applicableWeekdays) && exception.applicableWeekdays.length
      ? new Set(exception.applicableWeekdays.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))
      : null;

    for (let cursor = new Date(`${startKey}T12:00:00.000Z`); formatEcuadorDateKey(cursor) <= endKey; cursor = addDays(cursor, 1)) {
      const dayOfWeek = cursor.getUTCDay();

      if (applicableWeekdays && !applicableWeekdays.has(dayOfWeek)) {
        continue;
      }

      const dateKey = formatEcuadorDateKey(cursor);
      schedulesByKey.set(`${employeeId}|${dateKey}`, {
        dateKey,
        dayOfWeek,
        dayType: plannedDayType,
        startTime,
        endTime,
        lunchStartTime,
        lunchEndTime,
        lunchDurationMinutes,
        authorizedExtraMinutes: 0,
        effect,
        isAuthorizedExtraDay,
        source: "operational_exception_schedule",
      });
    }
  });

  return schedulesByKey;
}

function buildAttendanceExecutionExceptionMap(exceptions = []) {
  const exceptionsByKey = new Map();

  exceptions.forEach((exception) => {
    if (exception.planningSource !== "attendance_comparison" || !isResolvedOperationalException(exception)) return;

    const employeeId = toId(exception.employee);
    if (!employeeId || !exception.dateKey) return;

    const startKey = exception.dateKey;
    const endKey = exception.endDateKey || startKey;
    const applicableWeekdays = Array.isArray(exception.applicableWeekdays) && exception.applicableWeekdays.length
      ? new Set(exception.applicableWeekdays.map(Number))
      : null;
    const timestamp = new Date(exception.updatedAt || exception.createdAt || 0).getTime();

    for (let cursor = new Date(`${startKey}T12:00:00.000Z`); formatEcuadorDateKey(cursor) <= endKey; cursor = addDays(cursor, 1)) {
      if (applicableWeekdays && !applicableWeekdays.has(cursor.getUTCDay())) continue;

      const dateKey = formatEcuadorDateKey(cursor);
      const key = `${employeeId}|${dateKey}`;
      const current = exceptionsByKey.get(key);

      if (!current || timestamp >= current.timestamp) {
        exceptionsByKey.set(key, {
          id: exception._id.toString(),
          type: exception.type || "other",
          effect: resolveOperationalExceptionEffect(exception),
          timestamp,
        });
      }
    }
  });

  return exceptionsByKey;
}

function buildAuthorizedExternalWorkDateMap(exceptions = []) {
  const datesByEmployee = new Map();

  exceptions.forEach((exception) => {
    if (!isResolvedOperationalException(exception)) return;

    const effect = resolveOperationalExceptionEffect(exception);
    const attendanceMode = exception.attendanceMode || "";
    const resolution = exception.resolution || "";

    if (effect !== "external_work") return;
    if (attendanceMode !== "use_authorized_schedule") return;
    if (!["approved_work_time", "complete_scheduled_time"].includes(resolution)) return;

    const employeeId = toId(exception.employee);
    if (!employeeId || !exception.dateKey) return;

    const startKey = exception.dateKey;
    const endKey = exception.endDateKey || startKey;

    if (!datesByEmployee.has(employeeId)) {
      datesByEmployee.set(employeeId, new Set());
    }

    const employeeDates = datesByEmployee.get(employeeId);

    for (let cursor = new Date(`${startKey}T12:00:00.000Z`); formatEcuadorDateKey(cursor) <= endKey; cursor = addDays(cursor, 1)) {
      employeeDates.add(formatEcuadorDateKey(cursor));
    }
  });

  return datesByEmployee;
}

function copyScheduleFromFallback(day, fallback) {
  return {
    ...day,
    dayType: "workday",
    startTime: fallback.startTime || "",
    endTime: fallback.endTime || "",
    lunchStartTime: fallback.lunchStartTime || "",
    lunchEndTime: fallback.lunchEndTime || "",
    lunchDurationMinutes: Number(fallback.lunchDurationMinutes) || 0,
    authorizedExtraMinutes: 0,
    source: "operational_exception_schedule_fallback",
    tags: [...new Set([...(day.tags || []), "Justificación operativa"])],
  };
}

function dateKeyDistance(leftDateKey, rightDateKey) {
  const left = new Date(`${leftDateKey}T12:00:00.000Z`);
  const right = new Date(`${rightDateKey}T12:00:00.000Z`);

  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return Number.MAX_SAFE_INTEGER;

  return Math.abs(left.getTime() - right.getTime());
}

function applyAuthorizedExternalWorkFallbackSchedules(days = [], authorizedExternalDates = new Set()) {
  if (!authorizedExternalDates.size) return days;

  const candidates = days.filter((day) => (
    isPlannedWorkDay(day) &&
    day.startTime &&
    day.endTime &&
    !authorizedExternalDates.has(day.dateKey)
  ));

  return days.map((day) => {
    if (!authorizedExternalDates.has(day.dateKey)) return day;

    const withTag = {
      ...day,
      tags: [...new Set([...(day.tags || []), "Justificación operativa"])],
    };

    if (day.dayType === "vacation") {
      return withTag;
    }

    if (isPlannedWorkDay(day) && day.startTime && day.endTime) {
      return withTag;
    }

    const sameWeekFallback = candidates
      .filter((candidate) => weekStartKey(candidate.dateKey) === weekStartKey(day.dateKey))
      .sort((left, right) => dateKeyDistance(left.dateKey, day.dateKey) - dateKeyDistance(right.dateKey, day.dateKey))[0];
    const anyFallback = sameWeekFallback || [...candidates]
      .sort((left, right) => dateKeyDistance(left.dateKey, day.dateKey) - dateKeyDistance(right.dateKey, day.dateKey))[0];

    return anyFallback ? copyScheduleFromFallback(withTag, anyFallback) : withTag;
  });
}

function applyExceptionPlannedSchedule(day, plannedSchedule) {
  if (!plannedSchedule) return day;
  const isPlanningChange = plannedSchedule.effect === "planning_change";
  const plannedDayType = plannedSchedule.dayType === "off_day"
    ? "off_day"
    : isPlanningChange && isWeekendDateKey(day?.dateKey)
      ? "weekend_overtime"
      : plannedSchedule.dayType || day.dayType || "workday";
  const previousPlanningTags = new Set([
    "Sin picadas",
    "Picadas incompletas",
    "Picadas de más",
    "No planificado",
    "Trabajo sin horario",
    "Atraso",
    "Salida anticipada",
  ]);
  const retainedTags = isPlanningChange
    ? (day.tags || []).filter((tag) => !previousPlanningTags.has(tag))
    : day.tags || [];

  return {
    ...day,
    ...plannedSchedule,
    dayType: plannedDayType,
    dayTypeLabel: dayTypeLabel(plannedDayType),
    label: day.label,
    scheduleLabel: isPlanningChange ? "" : day.scheduleLabel,
    templateName: isPlanningChange ? "" : day.templateName,
    plannedTemplateName: isPlanningChange ? "" : day.plannedTemplateName,
    holidayPlannedScheduleLabel: isPlanningChange ? "" : day.holidayPlannedScheduleLabel,
    tags: [...new Set([...retainedTags, "Justificación operativa"])],
  };
}

function weeklyRegularDayLimit(weekDays = []) {
  const weekdayHolidayCount = weekDays.filter((day) =>
    day.isHoliday && !isWeekendDateKey(day.dateKey)
  ).length;

  return Math.max(0, 5 - weekdayHolidayCount);
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
    const regularDayLimit = weeklyRegularDayLimit(weekDays);

    [...weekDays]
      .sort((left, right) => String(left.dateKey || "").localeCompare(String(right.dateKey || "")))
      .forEach((day) => {
        if (day.isAuthorizedExtraDay && day.startTime && day.endTime) {
          const plannedExtraordinaryMinutes = resolveScheduledNetMinutes(day);

          byDate.set(day.dateKey, {
            ...day,
            dayType: "weekend_overtime",
            dayTypeLabel: dayTypeLabel("weekend_overtime"),
            scheduleLabel: "Día extra autorizado",
            authorizedExtraMinutes: plannedExtraordinaryMinutes,
            weeklyAttendanceClassification: "extra",
          });
          return;
        }

        if (!isPlannedWorkDay(day) || !day.startTime || !day.endTime) {
          byDate.set(day.dateKey, day);
          return;
        }

        workedDayCount += 1;

        if (workedDayCount <= regularDayLimit) {
          byDate.set(day.dateKey, {
            ...day,
            dayType: "workday",
            dayTypeLabel: dayTypeLabel("workday"),
            weeklyAttendanceClassification: day.weeklyAttendanceClassification || "regular",
          });
          return;
        }

        byDate.set(day.dateKey, {
          ...day,
          dayType: "weekend_overtime",
          dayTypeLabel: dayTypeLabel("weekend_overtime"),
          authorizedExtraMinutes: resolveScheduledNetMinutes(day),
          weeklyAttendanceClassification: "extra",
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
    const regularDayLimit = weeklyRegularDayLimit(weekDays);

    [...weekDays]
      .sort((left, right) => String(left.dateKey || "").localeCompare(String(right.dateKey || "")))
      .forEach((day) => {
        const workedMinutes = Math.max(0, Number(day.workedMinutes) || 0);
        const hasPlannedSchedule = day.plannedScheduleExists === true;
        const isWorkedAttendanceDay = workedMinutes > 0 && day.dayType !== "vacation" && !day.isHoliday;
        const isPlannedWeeklyExtraDay =
          day.weeklyAttendanceClassification === "extra" ||
          day.plannedDayType === "weekend_overtime";

        if (!isWorkedAttendanceDay) {
          byDate.set(day.dateKey, day);
          return;
        }

        if (day.isAuthorizedExtraDay || isPlannedWeeklyExtraDay) {
          const plannedExtraordinaryMinutes =
            Number(day.originalScheduledWorkedMinutes ?? day.scheduledWorkedMinutes)
            || resolveScheduledNetMinutes(day);
          const tags = (day.tags || []).filter((tag) => !UNPLANNED_WORK_TAGS.has(tag));
          const extraDayTags = day.isAuthorizedExtraDay
            ? [...new Set([...tags, "Día extra aprobado"])]
            : tags;

          byDate.set(day.dateKey, {
            ...day,
            tags: extraDayTags,
            hasIssue: extraDayTags.some(isAttendanceIssueTag),
            dayType: "weekend_overtime",
            dayTypeLabel: dayTypeLabel("weekend_overtime"),
            scheduleLabel: day.isAuthorizedExtraDay
              ? "Día extra autorizado"
              : day.scheduleLabel || dayTypeLabel("weekend_overtime"),
            plannedRegularMinutes: 0,
            plannedRegularLabel: "--",
            plannedSupplementaryMinutes: 0,
            plannedSupplementaryLabel: "--",
            plannedExtraordinaryMinutes,
            plannedExtraordinaryLabel: plannedExtraordinaryMinutes ? minutesLabel(plannedExtraordinaryMinutes) : "--",
            scheduledWorkedMinutes: plannedExtraordinaryMinutes,
            scheduledWorkedLabel: plannedExtraordinaryMinutes ? minutesLabel(plannedExtraordinaryMinutes) : "--",
            authorizedExtraMinutes: plannedExtraordinaryMinutes,
            weeklyAttendanceClassification: "extra",
          });
          return;
        }

        if (!hasPlannedSchedule) {
          const tags = [
            ...new Set([
              ...(day.tags || []).filter((tag) => !UNPLANNED_WORK_TAGS.has(tag)),
              "Trabajo sin horario",
            ]),
          ];

          byDate.set(day.dateKey, {
            ...day,
            tags,
            hasIssue: tags.some(isAttendanceIssueTag),
            dayType: day.dayType || "off_day",
            dayTypeLabel: dayTypeLabel(day.dayType || "off_day"),
            scheduleLabel: "Sin horario",
            plannedRegularMinutes: 0,
            plannedRegularLabel: "--",
            plannedSupplementaryMinutes: 0,
            plannedSupplementaryLabel: "--",
            plannedExtraordinaryMinutes: 0,
            plannedExtraordinaryLabel: "--",
            scheduledWorkedMinutes: 0,
            scheduledWorkedLabel: "--",
            authorizedExtraMinutes: 0,
            weeklyAttendanceClassification: "unplanned",
          });
          return;
        }

        actualWorkedDayCount += 1;

        if (actualWorkedDayCount <= regularDayLimit) {
          const plannedRegularMinutes = Number(day.originalPlannedRegularMinutes ?? day.plannedRegularMinutes) || 0;
          const scheduledWorkedMinutes = Number(day.originalScheduledWorkedMinutes ?? day.scheduledWorkedMinutes) || 0;
          const tags = (day.tags || []).filter((tag) => !UNPLANNED_WORK_TAGS.has(tag));

          byDate.set(day.dateKey, {
            ...day,
            tags,
            hasIssue: tags.some(isAttendanceIssueTag),
            dayType: "workday",
            dayTypeLabel: dayTypeLabel("workday"),
            scheduleLabel: day.scheduleLabel || dayTypeLabel("workday"),
            plannedRegularMinutes,
            plannedRegularLabel: plannedRegularMinutes ? minutesLabel(plannedRegularMinutes) : "--",
            plannedSupplementaryMinutes: Number(day.plannedSupplementaryMinutes) || 0,
            plannedSupplementaryLabel: day.plannedSupplementaryMinutes
              ? minutesLabel(day.plannedSupplementaryMinutes)
              : "--",
            scheduledWorkedMinutes,
            scheduledWorkedLabel: scheduledWorkedMinutes ? minutesLabel(scheduledWorkedMinutes) : "--",
            authorizedExtraMinutes: 0,
            weeklyAttendanceClassification: "regular",
          });
          return;
        }

        const tags = (day.tags || []).filter((tag) => !UNPLANNED_WORK_TAGS.has(tag));
        const plannedExtraordinaryMinutes =
          Number(day.originalScheduledWorkedMinutes ?? day.scheduledWorkedMinutes) || resolveScheduledNetMinutes(day);

        byDate.set(day.dateKey, {
          ...day,
          tags,
          hasIssue: tags.some(isAttendanceIssueTag),
          dayType: "weekend_overtime",
          dayTypeLabel: dayTypeLabel("weekend_overtime"),
          scheduleLabel: dayTypeLabel("weekend_overtime"),
          plannedRegularMinutes: 0,
          plannedRegularLabel: "--",
          plannedSupplementaryMinutes: 0,
          plannedSupplementaryLabel: "--",
          plannedExtraordinaryMinutes,
          plannedExtraordinaryLabel: plannedExtraordinaryMinutes ? minutesLabel(plannedExtraordinaryMinutes) : "--",
          scheduledWorkedMinutes: plannedExtraordinaryMinutes,
          scheduledWorkedLabel: plannedExtraordinaryMinutes ? minutesLabel(plannedExtraordinaryMinutes) : "--",
          authorizedExtraMinutes: 0,
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
  const statusLabels = [...new Set(intervals.map((interval) => interval.statusLabel).filter(Boolean))];
  const statusLabel = statusLabels.join(" / ") || "Trabajo fuera justificado";
  const workedMinutes = (Number(day.workedMinutes) || 0) + justifiedWorkMinutes;
  const plannedRegularMinutes = Number(day.plannedRegularMinutes) || REGULAR_DAY_MINUTES;
  const regularFloor = Math.min(workedMinutes, plannedRegularMinutes);

  return {
    ...day,
    tags: [...new Set([...nextTags, statusLabel])],
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
        statusLabel: interval.statusLabel,
      })),
    ],
    payrollPolicy: {
      ...(day.payrollPolicy || {}),
      appliesSupplementaryHours: allowSupplementaryTime && day.payrollPolicy?.appliesSupplementaryHours !== false,
    },
    authorization: {
      ...(day.authorization || {}),
      decision: "approved_work_time",
      statusLabel,
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
    : Math.max(
      Number(day.supplementaryMinutes) || 0,
      Number(day.detectedSupplementaryMinutes) || 0,
      Number(decision?.detectedSupplementaryMinutes) || 0,
    );
  let detectedExtraordinaryMinutes = policy.appliesExtraordinaryHours === false || !isExtraordinaryDay
    ? 0
    : Math.max(
      Number(day.extraordinaryMinutes) || 0,
      Number(day.detectedExtraordinaryMinutes) || 0,
      Number(decision?.detectedExtraordinaryMinutes) || 0,
    );
  const shouldInferAdditionalFromIncompletePunches =
    decision?.decision === "justify_incomplete_punches" &&
    decision.allowSupplementaryTime === true;

  if (shouldInferAdditionalFromIncompletePunches) {
    const inferredWorkedMinutes = Math.max(0, Number(day.workedMinutes) || 0);

    if (isExtraordinaryDay && policy.appliesExtraordinaryHours !== false) {
      detectedExtraordinaryMinutes = Math.max(detectedExtraordinaryMinutes, inferredWorkedMinutes);
    } else if (policy.appliesSupplementaryHours !== false) {
      const regularLimitMinutes = Math.max(0, Number(day.plannedRegularMinutes) || 0);
      detectedSupplementaryMinutes = Math.max(
        detectedSupplementaryMinutes,
        Math.max(0, inferredWorkedMinutes - regularLimitMinutes),
      );
    }
  }
  const detectedLateIssueMinutes = (isExtraordinaryDay && !isScheduledExtraDay) || policy.scheduleAffectsSalary === false
    ? 0
    : Math.max(
      0,
      Number(day.lateMinutes) || 0,
      (Number(day.entryLateMinutes) || 0) + (Number(day.lunchOverageMinutes ?? day.lunchOverageRemainderMinutes) || 0),
    );
  const detectedLateMinutes = detectedLateIssueMinutes;
  const detectedEarlyLeaveMinutes = Math.max(Number(day.earlyLeaveMinutes) || 0, Number(decision?.detectedEarlyLeaveMinutes) || 0);
  const entryLateMinutes = Math.max(0, Number(day.entryLateMinutes ?? day.lateMinutes) || 0);
  const lunchReturnLateMinutes = Math.max(0, Number(day.lunchOverageMinutes ?? day.lunchOverageRemainderMinutes) || 0);
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
    Math.max(0, day.dayType === "weekend_overtime"
        ? Number(day.scheduledWorkedMinutes) || 0
        : Number(day.plannedExtraordinaryMinutes) || 0),
  );
  const authorizedAdditionalMinutes = Math.max(0, Number(decision?.authorizedAdditionalMinutes) || 0);
  const effectiveDecision = decision
    ? authorizedAdditionalMinutes
      ? {
          ...decision,
          authorizedSupplementaryMinutes: plannedSupplementaryMinutes + authorizedAdditionalMinutes,
          authorizedExtraordinaryMinutes: plannedExtraordinaryMinutes + authorizedAdditionalMinutes,
        }
      : decision
    : {
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
      lateMinutes: 0,
      entryLateMinutes: 0,
      earlyLeaveMinutes: 0,
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

  if (effectiveDecision.decision === "resolve_late") {
    const resolvedTags = cleanPayrollTags(day.tags || [])
      .filter((tag) => tag !== "Atraso");

    return {
      ...day,
      tags: [...resolvedTags, "Revisado"].filter(Boolean),
      hasIssue: resolvedTags.some(isAttendanceIssueTag),
      lateMinutes: isExtraordinaryDay && !isScheduledExtraDay ? 0 : adjustedLateMinutes,
      entryLateMinutes: Math.min(entryLateMinutes, adjustedLateMinutes),
      earlyLeaveMinutes: Number(day.earlyLeaveMinutes) || 0,
      detectedSupplementaryMinutes,
      detectedSupplementaryLabel: detectedSupplementaryMinutes ? minutesLabel(detectedSupplementaryMinutes) : "--",
      detectedExtraordinaryMinutes,
      detectedExtraordinaryLabel: detectedExtraordinaryMinutes ? minutesLabel(detectedExtraordinaryMinutes) : "--",
      authorization: {
        decision: "resolve_late",
        statusLabel: "Revisado",
        authorizedSupplementaryMinutes: Math.min(detectedSupplementaryMinutes, Number(day.supplementaryMinutes) || 0),
        authorizedExtraordinaryMinutes: Math.min(detectedExtraordinaryMinutes, Number(day.extraordinaryMinutes) || 0),
        detectedLateMinutes,
        detectedEntryLateMinutes: entryLateMinutes,
        adjustedLateMinutes,
        detectedEarlyLeaveMinutes,
        adjustedEarlyLeaveMinutes,
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

  const shouldPayPlannedRegularOnly =
    Boolean(decision) &&
    effectiveDecision.decision === "planned" &&
    plannedPaidRegularMinutes > 0;

  if (paidPlannedDayDecisions.has(effectiveDecision.decision) || shouldPayPlannedRegularOnly) {
    const operationalTag = operationalDecisionTag(effectiveDecision);
    const statusLabel = effectiveDecision.decision === "justify_no_punches"
      ? "Ajustado a planificación"
      : effectiveDecision.decision === "justify_incomplete_punches"
        ? "Picadas justificadas"
      : shouldPayPlannedRegularOnly
        ? "Ajustado a planificación"
        : "Dia planificado pagado";
    const paidTags = cleanPayrollTags(day.tags || [])
      .filter((tag) => ![
        "Sin picadas",
        "Picadas incompletas",
        "Salida anticipada",
        "Atraso",
        "Dia descontado",
      ].includes(tag));
    const shouldKeepInferredAdditional =
      effectiveDecision.decision === "justify_incomplete_punches" &&
      effectiveDecision.allowSupplementaryTime === true;
    const authorizedPlannedSupplementaryMinutes = shouldKeepInferredAdditional
      ? 0
      : Math.min(
        Math.max(0, Number(effectiveDecision.authorizedSupplementaryMinutes) || 0),
        plannedPaidSupplementaryMinutes,
      );
    const authorizedPlannedExtraordinaryMinutes = shouldKeepInferredAdditional
      ? 0
      : Math.min(
        Math.max(0, Number(effectiveDecision.authorizedExtraordinaryMinutes) || 0),
        Math.max(0, Number(day.plannedExtraordinaryMinutes) || 0),
      );
    const plannedPaidWorkedMinutes = plannedPaidRegularMinutes +
      authorizedPlannedSupplementaryMinutes +
      authorizedPlannedExtraordinaryMinutes;
    const resolvedWorkedMinutes = shouldKeepInferredAdditional
      ? Math.max(plannedPaidWorkedMinutes, Number(day.workedMinutes) || 0)
      : plannedPaidWorkedMinutes;
    const unresolvedSupplementaryMinutes = shouldKeepInferredAdditional
      ? Math.max(
        Number(day.additionalSupplementaryMinutes) || 0,
        detectedSupplementaryMinutes - authorizedPlannedSupplementaryMinutes,
      )
      : Number(day.additionalSupplementaryMinutes) || 0;
    const unresolvedExtraordinaryMinutes = shouldKeepInferredAdditional
      ? Math.max(0, detectedExtraordinaryMinutes - authorizedPlannedExtraordinaryMinutes)
      : 0;
    const extraTimeToleranceMinutes = Math.max(
      0,
      Number(day.lateDepartureToleranceMinutes ?? DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES) || 0,
    );
    const shouldWarnAboutInferredAdditional =
      shouldKeepInferredAdditional &&
      Math.max(unresolvedSupplementaryMinutes, unresolvedExtraordinaryMinutes) > extraTimeToleranceMinutes;
    const decisionTags = operationalTag
      ? [...paidTags, operationalTag, ...(shouldWarnAboutInferredAdditional ? ["Tiempo adicional"] : [])]
      : [...paidTags, statusLabel];

    return {
      ...day,
      tags: [...new Set(decisionTags.filter(Boolean))],
      hasIssue: shouldWarnAboutInferredAdditional,
      workedMinutes: resolvedWorkedMinutes,
      workedLabel: resolvedWorkedMinutes ? minutesLabel(resolvedWorkedMinutes) : "--",
      regularWorkedMinutes: plannedPaidRegularMinutes,
      regularWorkedLabel: plannedPaidRegularMinutes ? minutesLabel(plannedPaidRegularMinutes) : "--",
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      supplementaryMinutes: authorizedPlannedSupplementaryMinutes,
      supplementaryLabel: authorizedPlannedSupplementaryMinutes ? minutesLabel(authorizedPlannedSupplementaryMinutes) : "--",
      additionalSupplementaryMinutes: unresolvedSupplementaryMinutes,
      additionalSupplementaryLabel: unresolvedSupplementaryMinutes ? minutesLabel(unresolvedSupplementaryMinutes) : "--",
      extraordinaryMinutes: authorizedPlannedExtraordinaryMinutes,
      extraordinaryLabel: authorizedPlannedExtraordinaryMinutes ? minutesLabel(authorizedPlannedExtraordinaryMinutes) : "--",
      detectedSupplementaryMinutes: Math.max(detectedSupplementaryMinutes, authorizedPlannedSupplementaryMinutes),
      detectedSupplementaryLabel: Math.max(detectedSupplementaryMinutes, authorizedPlannedSupplementaryMinutes)
        ? minutesLabel(Math.max(detectedSupplementaryMinutes, authorizedPlannedSupplementaryMinutes))
        : "--",
      detectedExtraordinaryMinutes: Math.max(detectedExtraordinaryMinutes, authorizedPlannedExtraordinaryMinutes),
      detectedExtraordinaryLabel: Math.max(detectedExtraordinaryMinutes, authorizedPlannedExtraordinaryMinutes)
        ? minutesLabel(Math.max(detectedExtraordinaryMinutes, authorizedPlannedExtraordinaryMinutes))
        : "--",
      authorization: {
        decision: effectiveDecision.decision,
        statusLabel,
        authorizedSupplementaryMinutes: authorizedPlannedSupplementaryMinutes,
        authorizedExtraordinaryMinutes: authorizedPlannedExtraordinaryMinutes,
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
    ? plannedSupplementaryMinutes
    : effectiveDecision.decision === "planned"
    ? plannedSupplementaryMinutes
    : Math.min(
      detectedSupplementaryMinutes,
      Math.max(0, Number(effectiveDecision.authorizedSupplementaryMinutes) || 0),
    );
  const rawAuthorizedExtraordinaryMinutes = isAutomaticDecision
    ? plannedExtraordinaryMinutes
    : effectiveDecision.decision === "planned"
    ? plannedExtraordinaryMinutes
    : Math.min(
      detectedExtraordinaryMinutes,
      Math.max(0, Number(effectiveDecision.authorizedExtraordinaryMinutes) || 0),
    );
  const authorizedSupplementaryMinutes = isExtraordinaryDay
    ? 0
    : isAutomaticDecision
      ? Math.min(plannedSupplementaryMinutes, detectedSupplementaryMinutes)
    : effectiveDecision.decision === "planned"
      ? Math.min(rawAuthorizedSupplementaryMinutes, detectedSupplementaryMinutes)
      : effectiveDecision.decision === "justify_early_leave" && adjustedEarlyLeaveMinutes === 0
        ? plannedPaidSupplementaryMinutes
      : rawAuthorizedSupplementaryMinutes;
  const authorizedExtraordinaryMinutes = isExtraordinaryDay
    ? isAutomaticDecision
      ? Math.min(plannedExtraordinaryMinutes, detectedExtraordinaryMinutes)
    : effectiveDecision.decision === "planned"
      ? Math.min(rawAuthorizedExtraordinaryMinutes, detectedExtraordinaryMinutes)
      : rawAuthorizedExtraordinaryMinutes
    : 0;
  const adjustedTags = cleanPayrollTags(day.tags || []);
  const lateAdjustedTags = adjustedTags.filter((tag) => tag !== "Atraso");
  const hasUnauthorizedSupplementaryTime = authorizedSupplementaryMinutes < detectedSupplementaryMinutes;
  const hasUnauthorizedExtraordinaryTime = authorizedExtraordinaryMinutes < detectedExtraordinaryMinutes;
  const additionalApprovalToleranceMinutes = Math.max(0, Number(day.lateDepartureToleranceMinutes) || 0);
  const hasApprovedAdditionalTime =
    authorizedSupplementaryMinutes - Math.max(0, Number(day.plannedSupplementaryMinutes) || 0) > additionalApprovalToleranceMinutes ||
    authorizedExtraordinaryMinutes - Math.max(0, Number(day.plannedExtraordinaryMinutes) || 0) > additionalApprovalToleranceMinutes;
  const shouldShowLateWarning =
    adjustedLateMinutes > 0 &&
    (Number(day.entryLateMinutes ?? day.lateMinutes) || 0) > (Number(day.graceMinutes) || 0);

  if (effectiveDecision.decision === "discount_day") {
    const operationalTag = operationalDecisionTag(effectiveDecision);
    const discountedTags = cleanPayrollTags(day.tags || [])
      .filter((tag) => ![
        "Atraso",
        "Salida anticipada",
        "Sin picadas",
        "Picadas incompletas",
        "Picadas de más",
        "No planificado",
        "Trabajo sin horario",
        "Tiempo adicional",
      ].includes(tag));

    return {
      ...day,
      tags: [...discountedTags, "Dia descontado", operationalTag].filter(Boolean),
      hasIssue: false,
      workedMinutes: 0,
      workedLabel: "--",
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
  ].includes(tag)).filter((tag) => !isSavedDecision || ![
    "Tiempo adicional",
    "Tiempo adicional sin justificar",
  ].includes(tag));
  if (!isSavedDecision && authorizedExtraordinaryMinutes > 0) issueAdjustedTags.push("Extraordinaria");
  if (
    isSavedDecision
    && (
      detectedSupplementaryMinutes - authorizedSupplementaryMinutes > additionalApprovalToleranceMinutes
      || detectedExtraordinaryMinutes - authorizedExtraordinaryMinutes > additionalApprovalToleranceMinutes
    )
  ) {
    issueAdjustedTags.push("Tiempo adicional");
  }
  if (shouldShowLateWarning) issueAdjustedTags.push("Atraso");
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
        ? "No aprobado"
        : effectiveDecision.decision === "justify_early_leave"
          ? "Salida justificada"
        : effectiveDecision.decision === "justify_late"
          ? "Atraso justificado"
        : effectiveDecision.decision === "full"
          ? hasApprovedAdditionalTime
            ? "Aprobado"
            : "Revisado"
        : effectiveDecision.decision === "planned"
            ? isAutomaticDecision
              ? "Registrado"
              : hasApprovedAdditionalTime
                ? "Aprobado"
                : "Revisado"
            : hasApprovedAdditionalTime
              ? "Aprobado"
              : "Revisado",
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
    const plannedSupplementaryMinutes = Math.max(0, Number(day.plannedSupplementaryMinutes) || 0);
    const plannedExtraordinaryMinutes = Math.max(0, Number(day.plannedExtraordinaryMinutes) || 0);
    const extraTimeToleranceMinutes = Math.max(
      0,
      Number(day.lateDepartureToleranceMinutes ?? DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES) || 0,
    );
    const applicableExtraTimeToleranceMinutes = (
      plannedRegularMinutes > 0 ||
      plannedSupplementaryMinutes > 0 ||
      plannedExtraordinaryMinutes > 0 ||
      (Number(day.scheduledWorkedMinutes) || 0) > 0
    ) ? extraTimeToleranceMinutes : 0;
    const markUnauthorizedExtraTime = () => {
      if (hasBlockingAttendanceIssue(nextDay.tags || [])) return;

      const unauthorizedSupplementaryMinutes = Math.max(
        0,
        (Number(nextDay.detectedSupplementaryMinutes) || 0) - (Number(nextDay.supplementaryMinutes) || 0),
      );
      const unauthorizedExtraordinaryMinutes = Math.max(
        0,
        (Number(nextDay.detectedExtraordinaryMinutes) || 0) - (Number(nextDay.extraordinaryMinutes) || 0),
      );
      const hasUnauthorizedSupplementary = unauthorizedSupplementaryMinutes > applicableExtraTimeToleranceMinutes;
      const hasUnauthorizedExtraordinary = unauthorizedExtraordinaryMinutes > applicableExtraTimeToleranceMinutes;

      if (!hasUnauthorizedSupplementary && !hasUnauthorizedExtraordinary) return;

      nextDay.tags = [...new Set([...nextDay.tags, "Tiempo adicional"])];
      nextDay.hasIssue = nextDay.tags.some(isAttendanceIssueTag);
    };

    if (hasWorkWithoutScheduleTag(nextDay) && nextDay.weeklyAttendanceClassification !== "regular") {
      nextDay.hasIssue = nextDay.tags.some(isAttendanceIssueTag);
      return nextDay;
    }

    if (hasBlockingAttendanceIssue(nextDay.tags || [])) {
      nextDay.hasIssue = nextDay.tags.some(isAttendanceIssueTag);
      return nextDay;
    }

    if (day.isHoliday) {
      nextDay.plannedRegularMinutes = 0;
      nextDay.plannedRegularLabel = "--";

      if (workedMinutes > 0 && appliesExtraordinaryHours) {
        const detectedExtraordinaryMinutes = workedMinutes;
        const payableExtraordinaryMinutes = Math.min(detectedExtraordinaryMinutes, plannedExtraordinaryMinutes);
        nextDay.detectedExtraordinaryMinutes = detectedExtraordinaryMinutes;
        nextDay.detectedExtraordinaryLabel = minutesLabel(detectedExtraordinaryMinutes);
        nextDay.extraordinaryMinutes = payableExtraordinaryMinutes;
        nextDay.extraordinaryLabel = payableExtraordinaryMinutes ? minutesLabel(payableExtraordinaryMinutes) : "--";
        if (payableExtraordinaryMinutes > 0) {
          nextDay.tags = [...new Set([...nextDay.tags, "Extraordinaria"])];
        }
        markUnauthorizedExtraTime();
      }

      return nextDay;
    }

    if (day.dayType === "vacation") {
      nextDay.plannedRegularMinutes = 0;
      nextDay.plannedRegularLabel = "--";
      nextDay.regularWorkedMinutes = 0;
      nextDay.regularWorkedLabel = "--";
      return nextDay;
    }

    if (!workedMinutes) {
      return nextDay;
    }

    if (day.dayType === "weekend_overtime") {
      if (!appliesExtraordinaryHours) {
        return nextDay;
      }

      const plannedWeekendExtraordinaryMinutes = Math.max(
        plannedExtraordinaryMinutes,
        Number(day.scheduledWorkedMinutes) || 0,
      );
      const detectedExtraordinaryMinutes = workedMinutes;
      const payableExtraordinaryMinutes = Math.min(detectedExtraordinaryMinutes, plannedWeekendExtraordinaryMinutes);
      nextDay.detectedExtraordinaryMinutes = detectedExtraordinaryMinutes;
      nextDay.detectedExtraordinaryLabel = detectedExtraordinaryMinutes ? minutesLabel(detectedExtraordinaryMinutes) : "--";
      nextDay.extraordinaryMinutes = payableExtraordinaryMinutes;
      nextDay.extraordinaryLabel = payableExtraordinaryMinutes ? minutesLabel(payableExtraordinaryMinutes) : "--";
      nextDay.tags = payableExtraordinaryMinutes > 0
        ? [...new Set([...nextDay.tags, "Extraordinaria"])]
        : nextDay.tags;
      markUnauthorizedExtraTime();
      nextDay.hasIssue = nextDay.tags.some(isAttendanceIssueTag);
      return nextDay;
    }

    if (isRestOrWeekendDay(day)) {
      if (!appliesExtraordinaryHours) {
        return nextDay;
      }

      nextDay.detectedExtraordinaryMinutes = workedMinutes;
      nextDay.detectedExtraordinaryLabel = minutesLabel(workedMinutes);
      nextDay.extraordinaryMinutes = 0;
      nextDay.extraordinaryLabel = "--";
      markUnauthorizedExtraTime();
      return nextDay;
    }

    const dailyRegularLimitMinutes = Math.max(0, Math.min(plannedRegularMinutes || REGULAR_DAY_MINUTES, REGULAR_DAY_MINUTES));
    const regularMinutes = Math.min(workedMinutes, dailyRegularLimitMinutes);

    nextDay.regularWorkedMinutes = regularMinutes;
    nextDay.regularWorkedLabel = regularMinutes ? minutesLabel(regularMinutes) : "--";

    const detectedSupplementaryMinutes = Math.max(
      0,
      workedMinutes - regularMinutes,
      Number(day.detectedSupplementaryMinutes) || 0,
      Number(day.supplementaryMinutes) || 0,
      Number(day.additionalSupplementaryMinutes) || 0,
    );
    const payableSupplementaryMinutes = appliesSupplementaryHours
      ? Math.min(detectedSupplementaryMinutes, plannedSupplementaryMinutes)
      : 0;
    const additionalSupplementaryMinutes = Math.max(
      Number(day.additionalSupplementaryMinutes) || 0,
      detectedSupplementaryMinutes - payableSupplementaryMinutes,
    );

    nextDay.detectedSupplementaryMinutes = detectedSupplementaryMinutes;
    nextDay.detectedSupplementaryLabel = detectedSupplementaryMinutes ? minutesLabel(detectedSupplementaryMinutes) : "--";
    nextDay.supplementaryMinutes = payableSupplementaryMinutes;
    nextDay.supplementaryLabel = nextDay.supplementaryMinutes ? minutesLabel(nextDay.supplementaryMinutes) : "--";
    nextDay.additionalSupplementaryMinutes = additionalSupplementaryMinutes;
    nextDay.additionalSupplementaryLabel = additionalSupplementaryMinutes ? minutesLabel(additionalSupplementaryMinutes) : "--";
    markUnauthorizedExtraTime();

    nextDay.hasIssue = nextDay.tags.some(isAttendanceIssueTag);

    return nextDay;
  });
}

function compareDay(day, punches, employee = {}, scheduleRules = {}) {
  const activeSortedPunches = dedupePunchesByMinute(punches.filter((punch) => punch.isIgnored !== true));
  const ignoredSortedPunches = dedupePunchesByMinute(punches.filter((punch) => punch.isIgnored === true));
  const allSortedPunches = [...activeSortedPunches, ...ignoredSortedPunches]
    .sort((left, right) => left.punchedAt - right.punchedAt);
  const sortedPunches = activeSortedPunches.sort((left, right) => left.punchedAt - right.punchedAt);
  const punchCount = sortedPunches.length;
  const isWorkingDay = isPlannedWorkDay(day);
  const hasAssignedSchedule = hasAssignedScheduleDay(day);
  const isExtraordinaryDay = isExtraordinaryAttendanceDay(day);
  const isPlannedHolidayWork = hasPlannedHolidaySchedule(day);
  const payrollPolicy = attendancePayrollPolicy(employee);
  const scheduleAffectsSalary = payrollPolicy.scheduleAffectsSalary !== false;
  const punchesAffectHours = scheduleAffectsSalary;
  const shouldUsePlannedAttendance = !scheduleAffectsSalary && isWorkingDay && punchCount === 0;
  const shouldSuppressScheduleIssues = !scheduleAffectsSalary;
  const shouldIgnorePunchesForPayroll =
    !punchesAffectHours ||
    (!payrollPolicy.appliesSupplementaryHours &&
      !payrollPolicy.appliesExtraordinaryHours &&
      !isWorkingDay);
  const isWeekendOrHoliday = isWeekendDateKey(day.dateKey) || day?.isHoliday;
  const plannedLunchDurationMinutes = resolvePlannedLunchDurationMinutes(day);
  const hasScheduledTimeRange = Boolean(day?.startTime && day?.endTime);
  const hasPlannedAttendanceSchedule = hasScheduledTimeRange;
  const hasLunch = hasPlannedAttendanceSchedule && plannedLunchDurationMinutes > 0;
  const hasHolidayLunchPunches = day?.isHoliday && punchCount >= 4;
  const expectedPunches = hasPlannedAttendanceSchedule ? (hasLunch ? 4 : 2) : 0;
  const scheduleStart = isWorkingDay ? combineDateAndTime(day.dateKey, day.startTime) : null;
  const scheduleEnd = isWorkingDay ? combineDateAndTime(day.dateKey, day.endTime) : null;
  const graceMinutes = Number(scheduleRules?.lateToleranceMinutes ?? DEFAULT_ATTENDANCE_GRACE_MINUTES) || 0;
  const earlyLeaveToleranceMinutes = Number(scheduleRules?.earlyLeaveToleranceMinutes ?? 5) || 0;
  const lateDepartureToleranceMinutes = Number(
    scheduleRules?.lateDepartureToleranceMinutes ?? DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES,
  ) || 0;
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
  const hasIncompleteStructure = hasIncompletePunchStructure({
    punchCount,
    expectedPunches,
    hasLunch,
    hasInsufficientTwoPunchSpan,
  });
  let tags = [...new Set(day.tags || [])];

  if (isPlannedHolidayWork) {
    tags = tags.filter((tag) => tag !== "No planificado");
  }
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
    const countedStart = !isExtraordinaryDay && scheduleStart && firstPunch.punchedAt < scheduleStart
      ? scheduleStart
      : firstPunch.punchedAt;
    const grossMinutes = lastPunch.punchedAt > countedStart
      ? Math.max(0, Math.round((lastPunch.punchedAt - countedStart) / 60000))
      : 0;
    const scheduledLunchMinutes = hasLunch
      ? plannedLunchDurationMinutes
      : (hasHolidayLunchPunches ? resolveHolidayLunchDiscountMinutes(day) : 0);
    lunchDiscountMinutes = scheduledLunchMinutes;
    const lunchDiscount = Math.max(actualLunchMinutes || 0, scheduledLunchMinutes);
    const rawLunchOverageMinutes = scheduledLunchMinutes > 0
      ? Math.max(0, (actualLunchMinutes || 0) - lunchDiscountMinutes)
      : 0;
    lunchOverageMinutes = rawLunchOverageMinutes > graceMinutes ? rawLunchOverageMinutes : 0;
    workedMinutes = Math.max(0, grossMinutes - lunchDiscount);
  }

  if (shouldIgnorePunchesForPayroll) {
    workedMinutes = 0;
    actualLunchMinutes = null;
    lunchOverageMinutes = 0;
    lunchOverageRemainderMinutes = 0;
    lunchDiscountMinutes = 0;
  }

  const hasWorkWithoutAssignedSchedule =
    !hasScheduledTimeRange &&
    punchCount > 0 &&
    !shouldUsePlannedAttendance &&
    !shouldIgnorePunchesForPayroll;

  if (hasWorkWithoutAssignedSchedule) {
    tags = tags.filter((tag) => !["Picadas de más", "No planificado"].includes(tag));
    tags.push("Trabajo sin horario");
  }

  if (isWorkingDay && punchCount === 0 && !shouldUsePlannedAttendance && !shouldSuppressScheduleIssues) {
    tags.push("Sin picadas");
  }

  if (
    !hasWorkWithoutAssignedSchedule &&
    (isWorkingDay || isExtraordinaryDay || hasPlannedAttendanceSchedule) &&
    hasIncompleteStructure &&
    !shouldUsePlannedAttendance &&
    !shouldSuppressScheduleIssues &&
    !shouldIgnorePunchesForPayroll
  ) {
    tags.push("Picadas incompletas");
  }

  if (hasIncompleteStructure) {
    tags = tags.filter((tag) => !SECONDARY_ATTENDANCE_TAGS.has(tag));
  }

  if (
    !hasWorkWithoutAssignedSchedule &&
    hasPlannedAttendanceSchedule &&
    punchCount > expectedPunches &&
    !shouldUsePlannedAttendance &&
    !shouldSuppressScheduleIssues
  ) {
    tags.push("Picadas de más");
  }

  if (
    !hasWorkWithoutAssignedSchedule &&
    hasAssignedSchedule &&
    !isWorkingDay &&
    !isPlannedHolidayWork &&
    punchCount > 0 &&
    !shouldUsePlannedAttendance &&
    !shouldIgnorePunchesForPayroll
  ) {
    tags.push("No planificado");
  }

  if (!hasWorkWithoutAssignedSchedule && isWorkingDay && scheduleStart && firstPunch && firstPunch.punchedAt > scheduleStart && !shouldUsePlannedAttendance && !hasIncompleteStructure && !hasInsufficientTwoPunchSpan && scheduleAffectsSalary) {
    const rawLateMinutes = Math.max(0, Math.round((firstPunch.punchedAt - scheduleStart) / 60000));
    lateMinutes = rawLateMinutes > graceMinutes ? rawLateMinutes : 0;
  }

  if (
    !hasWorkWithoutAssignedSchedule &&
    isWorkingDay &&
    punchCount >= expectedPunches &&
    !hasUnusablePunchesForPayroll &&
    !hasIncompleteStructure &&
    scheduleEnd &&
    lastPunch &&
    lastPunch.punchedAt < scheduleEnd &&
    !shouldUsePlannedAttendance &&
    !hasInsufficientTwoPunchSpan &&
    scheduleAffectsSalary
  ) {
    const rawEarlyLeaveMinutes = Math.max(0, Math.round((scheduleEnd - lastPunch.punchedAt) / 60000));
    earlyLeaveMinutes = rawEarlyLeaveMinutes > earlyLeaveToleranceMinutes ? rawEarlyLeaveMinutes : 0;
    const workedMinutesWithoutLunchOverage = workedMinutes + lunchOverageMinutes;
    const earlyLeaveAffectsPlannedTime = isExtraordinaryDay
      ? workedMinutes < plannedMinutes.scheduledWorkedMinutes
      : workedMinutes < plannedMinutes.plannedRegularMinutes;
    const earlyLeaveIsOnlyLunchOverage = !isExtraordinaryDay &&
      lunchOverageMinutes > 0 &&
      workedMinutesWithoutLunchOverage >= plannedMinutes.plannedRegularMinutes;

    if (earlyLeaveIsOnlyLunchOverage) {
      earlyLeaveMinutes = 0;
    } else if (earlyLeaveMinutes > 0 && earlyLeaveAffectsPlannedTime) {
      tags.push("Salida anticipada");
    }
  }

  if (!hasWorkWithoutAssignedSchedule && isWorkingDay && scheduleEnd && lastPunch && lastPunch.punchedAt > scheduleEnd && !shouldUsePlannedAttendance && !hasIncompleteStructure && !hasInsufficientTwoPunchSpan && payrollPolicy.appliesSupplementaryHours) {
    const rawAdditionalSupplementaryMinutes = Math.max(0, Math.round((lastPunch.punchedAt - scheduleEnd) / 60000));
    const reviewableAdditionalSupplementaryMinutes =
      rawAdditionalSupplementaryMinutes > lateDepartureToleranceMinutes
        ? rawAdditionalSupplementaryMinutes
        : 0;
    const workedSurplusOverPlan = Math.max(0, workedMinutes - plannedMinutes.scheduledWorkedMinutes);
    additionalSupplementaryMinutes = Math.min(reviewableAdditionalSupplementaryMinutes, workedSurplusOverPlan);
    lunchOverageRemainderMinutes = Math.max(0, lunchOverageMinutes - rawAdditionalSupplementaryMinutes);
  } else {
    lunchOverageRemainderMinutes = lunchOverageMinutes;
  }

  const detectedLateMinutes = !hasWorkWithoutAssignedSchedule && isWorkingDay && scheduleAffectsSalary
    ? hasIncompleteStructure ? 0 : lateMinutes + lunchOverageMinutes
    : 0;

  if (
    additionalSupplementaryMinutes > 0 &&
    !shouldUsePlannedAttendance &&
    !shouldIgnorePunchesForPayroll &&
    !tags.includes("Tiempo adicional")
  ) {
    tags.push("Tiempo adicional");
  }

  if (
    isWorkingDay &&
    detectedLateMinutes > graceMinutes &&
    !shouldUsePlannedAttendance &&
    !hasIncompleteStructure &&
    !hasInsufficientTwoPunchSpan &&
    scheduleAffectsSalary &&
    !tags.includes("Atraso")
  ) {
    tags.push("Atraso");
  }

  if (
    isWorkingDay &&
    scheduleEnd &&
    lastPunch &&
    plannedMinutes.plannedSupplementaryMinutes > 0 &&
    !shouldUsePlannedAttendance &&
    !hasIncompleteStructure &&
    !hasInsufficientTwoPunchSpan &&
    payrollPolicy.appliesSupplementaryHours
  ) {
    const actualSupplementaryMinutes = Math.max(0, workedMinutes - plannedMinutes.plannedRegularMinutes);
    supplementaryMinutes = Math.min(actualSupplementaryMinutes, plannedMinutes.plannedSupplementaryMinutes);
  }

  const hasIssue = tags.some(isAttendanceIssueTag);
  const hasRestDayAttendance = hasAssignedSchedule && day.dayType === "off_day" && punchCount > 0;
  const displayDayTypeLabel = hasRestDayAttendance ? "Extraordinaria" : dayTypeLabel(day.dayType);
  const displayScheduleLabel = hasRestDayAttendance ? "Extraordinaria" : buildScheduleLabel(day);
  const plannedExtraordinaryMinutes = hasAssignedSchedule && isExtraordinaryAttendanceDay(day)
    ? day.isHoliday
      ? resolveHolidayPlannedNetMinutes(day) || plannedMinutes.scheduledWorkedMinutes
      : plannedMinutes.scheduledWorkedMinutes
    : 0;

  return {
    dateKey: day.dateKey,
    dateLabel: formatEcuadorDate(new Date(`${day.dateKey}T12:00:00.000Z`)),
    dayLabel: day.label || "",
    dayType: day.dayType || "off_day",
    dayTypeLabel: displayDayTypeLabel,
    source: day.source || "calendar",
    isHoliday: Boolean(day.isHoliday),
    plannedScheduleExists: hasPlannedAttendanceSchedule || isPlannedHolidayWork,
    plannedTemplateId: day.plannedTemplateId || "",
    plannedTemplateName: day.plannedTemplateName || "",
    holidayPlannedStartTime: day.holidayPlannedStartTime || "",
    holidayPlannedLunchStartTime: day.holidayPlannedLunchStartTime || "",
    holidayPlannedLunchEndTime: day.holidayPlannedLunchEndTime || "",
    holidayPlannedEndTime: day.holidayPlannedEndTime || "",
    holidayPlannedScheduleLabel: day.holidayPlannedScheduleLabel || "",
    scheduleLabel: displayScheduleLabel,
    startTime: day.startTime || "",
    endTime: day.endTime || "",
    lunchStartTime: day.lunchStartTime || "",
    lunchEndTime: day.lunchEndTime || "",
    lunchDurationMinutes: plannedLunchDurationMinutes,
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
    lateDepartureToleranceMinutes,
    scheduledWorkedMinutes: plannedMinutes.scheduledWorkedMinutes,
    plannedRegularMinutes: plannedMinutes.plannedRegularMinutes,
    plannedSupplementaryMinutes: plannedMinutes.plannedSupplementaryMinutes,
    plannedExtraordinaryMinutes,
    plannedExtraordinaryLabel: plannedExtraordinaryMinutes ? minutesLabel(plannedExtraordinaryMinutes) : "--",
    plannedDayType: day.dayType || "off_day",
    weeklyAttendanceClassification: day.weeklyAttendanceClassification || "",
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
    punches: allSortedPunches.map((punch) => {
      const time = formatEcuadorTime(punch.punchedAt);
      const isIgnored = punch.isIgnored === true;

      return {
        id: punch._id.toString(),
        time,
        originalTime: time,
        source: punch.source || "upload",
        isIgnored,
        ignoredAt: punch.ignoredAt || null,
        ignoredBy: punch.ignoredBy || "",
        ignoredReason: punch.ignoredReason || "",
      };
    }),
    workedMinutes,
    workedLabel: workedMinutes ? minutesLabel(workedMinutes) : "--",
    regularWorkedMinutes,
    regularWorkedLabel: regularWorkedMinutes ? minutesLabel(regularWorkedMinutes) : "--",
    lateMinutes: detectedLateMinutes,
    entryLateMinutes: lateMinutes,
    earlyLeaveMinutes,
    earlyLeaveLabel: earlyLeaveMinutes ? minutesLabel(earlyLeaveMinutes) : "--",
    lateLabel: detectedLateMinutes ? minutesLabel(detectedLateMinutes) : "--",
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
    missingLunchDays: 0,
    absentDays: 0,
    lateDays: 0,
    earlyLeaveDays: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    extraDays: 0,
    extraPunchDays: 0,
    vacationDays: 0,
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
    pendingOperationalAlertDays: 0,
    pendingLateDays: 0,
    pendingAdditionalDays: 0,
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
    const summaryOnly = searchParams.get("summaryOnly") === "1";
    const start = makeEcuadorDate(year, monthIndex, 1);
    const end = makeEcuadorDate(year, monthIndex + 1, 1);
    const { contextStart, contextEnd } = getWeekContextRange(start, end);
    const contextStartKey = formatEcuadorDateKey(contextStart);
    const contextEndKey = formatEcuadorDateKey(contextEnd);
    const startKey = formatEcuadorDateKey(start);
    const endKey = formatEcuadorDateKey(end);
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

    const [allEmployees, roles, holidays, vacations, scheduleRuleConfig] = await Promise.all([
      Employee.find(employeeQuery)
        .select({
          fullName: 1,
          dni: 1,
          branchCode: 1,
          branchName: 1,
          areaCode: 1,
          areaName: 1,
          roleCode: 1,
          roleName: 1,
          salary: 1,
          employmentStartDate: 1,
          hireDate: 1,
          startDate: 1,
          terminationDate: 1,
          isActive: 1,
        })
        .sort({ branchName: 1, areaName: 1, roleName: 1, fullName: 1 })
        .lean(),
      Role.find({})
        .select({
          code: 1,
          name: 1,
          areaCode: 1,
          areaName: 1,
          punchesAffectHours: 1,
          scheduleMode: 1,
          fixedScheduleTemplate: 1,
          fixedScheduleTemplateName: 1,
          fixedScheduleAreaCode: 1,
          fixedScheduleAreaName: 1,
          fixedScheduleRoleCode: 1,
          fixedScheduleRoleName: 1,
          fixedScheduleRotationGroup: 1,
          fixedScheduleWeeklyRows: 1,
        })
        .lean(),
      Holiday.find({
        dateKey: {
          $gte: contextStartKey,
          $lt: contextEndKey,
        },
      }).select({ dateKey: 1 }).lean(),
      VacationRequest.find({
        status: APPROVED_VACATION_STATUS_QUERY,
        startDate: { $lt: contextEnd },
        endDate: { $gte: contextStart },
      }).select({ employee: 1, startDateKey: 1, endDateKey: 1 }).lean(),
      ScheduleRuleConfig.findOne({ key: "default" }).lean(),
    ]);
    const scheduleRules = {
      lateToleranceMinutes: Number(
        scheduleRuleConfig?.lateToleranceMinutes ?? DEFAULT_ATTENDANCE_GRACE_MINUTES,
      ) || 0,
      earlyLeaveToleranceMinutes: Number(
        scheduleRuleConfig?.earlyLeaveToleranceMinutes ?? 5,
      ) || 0,
      lateDepartureToleranceMinutes: Number(
        scheduleRuleConfig?.lateDepartureToleranceMinutes ?? DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES,
      ) || 0,
    };
    const rolesByCode = new Map(
      roles.map((role) => [String(role.code || "").trim().toUpperCase(), role]),
    );
    const employees = allEmployees.map((employee) => {
      const role = rolesByCode.get(String(employee.roleCode || "").trim().toUpperCase());

      return {
        ...employee,
        punchesAffectHours: role?.punchesAffectHours !== false,
      };
    }).filter((employee) => employee.punchesAffectHours !== false);
    const employeeIds = employees.map((employee) => employee._id);
    const coverageBranchCodes = [...new Set(employees.map((employee) => employee.branchCode).filter(Boolean))];
    const coverageBranchNames = [...new Set(employees.map((employee) => employee.branchName).filter(Boolean))];
    const coverageEmployeeQuery = buildEmployeeActiveInMonthQuery(start);

    if (coverageBranchCodes.length || coverageBranchNames.length) {
      coverageEmployeeQuery.$and.push({
        $or: [
          ...(coverageBranchCodes.length ? [{ branchCode: { $in: coverageBranchCodes } }] : []),
          ...(coverageBranchNames.length ? [{ branchName: { $in: coverageBranchNames } }] : []),
        ],
      });
    }

    const needsExpandedCoverage = Boolean(areaCode || roleCode || employeeId);
    const coverageEmployeeIds = employeeIds.length
      ? needsExpandedCoverage
        ? await Employee.distinct("_id", coverageEmployeeQuery)
        : employeeIds
      : [];
    const contextMonthKeys = new Set();
    const contextCursorEnd = contextEnd;

    for (let date = contextStart; date < contextCursorEnd; date = addDays(date, 1)) {
      contextMonthKeys.add(monthKeyFromDateKey(formatEcuadorDateKey(date)));
    }

    const fixedTemplateIds = [
      ...new Set(
        employees
          .map((employee) => rolesByCode.get(String(employee.roleCode || "").trim().toUpperCase()))
          .filter((role) => role?.scheduleMode === "fixed" && role?.fixedScheduleTemplate)
          .map((role) => role.fixedScheduleTemplate.toString()),
      ),
    ];
    const [
      manualAssignments,
      fixedScheduleTemplates,
      punches,
      latestCoveragePunch,
      dayDecisions,
      operationalExceptions,
    ] = employeeIds.length
      ? await Promise.all([
          ScheduleAssignment.find({
            employee: { $in: employeeIds },
            monthKey: { $in: [...contextMonthKeys] },
          }).lean(),
          fixedTemplateIds.length
            ? BaseScheduleTemplate.find({
                _id: { $in: fixedTemplateIds },
                isActive: { $ne: false },
              }).lean()
            : [],
          AttendancePunch.find({
            employee: { $in: employeeIds },
            punchedAt: {
              $gte: contextStart,
              $lt: contextEnd,
            },
          })
            .select({
              employee: 1,
              punchedAt: 1,
              source: 1,
              isIgnored: 1,
              ignoredAt: 1,
              ignoredBy: 1,
              ignoredReason: 1,
            })
            .sort({ punchedAt: 1 })
            .lean(),
          AttendancePunch.findOne({
            employee: { $in: coverageEmployeeIds },
            isIgnored: { $ne: true },
            punchedAt: {
              $gte: contextStart,
              $lt: contextEnd,
            },
          }).sort({ punchedAt: -1 }).select({ punchedAt: 1 }).lean(),
          AttendanceDayDecision.find({
            employee: { $in: employeeIds },
            dateKey: {
              $gte: startKey,
              $lt: endKey,
            },
          }).lean(),
          OperationalException.find({
            employee: { $in: employeeIds },
            status: { $ne: "void" },
            resolution: { $ne: "pending" },
            $and: [
              {
                $or: [
                  { resolution: { $in: ["complete_scheduled_time", "paid_leave", "approved_work_time", "discount_day"] } },
                  {
                    plannedStartTime: { $type: "string", $ne: "" },
                    plannedEndTime: { $type: "string", $ne: "" },
                  },
                  { plannedDayType: "off_day" },
                ],
              },
              {
                $or: [
                  { date: { $gte: start, $lt: end } },
                  { date: { $lt: end }, endDate: { $gte: start } },
                ],
              },
            ],
          }).lean(),
        ])
      : [[], [], [], null, [], []];
    const employeesById = new Map(employees.map((employee) => [toId(employee), employee]));
    const currentManualAssignments = manualAssignments.filter((assignment) =>
      assignmentMatchesCurrentEmployeeOrg(assignment, employeesById.get(toId(assignment.employee))),
    );
    const fallbackAssignments = buildFixedScheduleFallbackAssignments({
      employees,
      rolesByCode,
      templates: fixedScheduleTemplates,
      monthKeys: [...contextMonthKeys],
      holidays,
    });
    const fixedEmployeeIds = new Set(
      employees
        .filter((employee) =>
          rolesByCode.get(String(employee.roleCode || "").trim().toUpperCase())?.scheduleMode === "fixed",
        )
        .map((employee) => toId(employee)),
    );
    const effectiveManualAssignments = currentManualAssignments.filter((assignment) =>
      !fixedEmployeeIds.has(toId(assignment.employee)),
    );
    const assignments = [...fallbackAssignments, ...effectiveManualAssignments];
    const manualDaysByEmployeeDate = new Map();

    effectiveManualAssignments.forEach((assignment) => {
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
    const assignmentsByEmployeeMonth = new Map(
      assignments.map((assignment) => [`${toId(assignment.employee)}|${assignment.monthKey}`, assignment]),
    );
    const dayDecisionsByEmployeeDate = buildDayDecisionMap(dayDecisions);
    const operationalDecisionsByEmployeeDate = buildOperationalExceptionDecisionMap(operationalExceptions);
    const justifiedWorkIntervalsByEmployeeDate = buildJustifiedWorkIntervalMap(operationalExceptions);
    const discountedWorkIntervalsByEmployeeDate = buildDiscountedWorkIntervalMap(operationalExceptions);
    const exceptionPlannedSchedulesByEmployeeDate = buildExceptionPlannedScheduleMap(operationalExceptions);
    const attendanceExecutionExceptionsByEmployeeDate = buildAttendanceExecutionExceptionMap(operationalExceptions);
    const authorizedExternalDatesByEmployee = buildAuthorizedExternalWorkDateMap(operationalExceptions);

    const vacationDateKeysByEmployee = buildVacationDateKeysByEmployee(vacations);
    const punchesByEmployeeDate = new Map();
    const todayKey = formatEcuadorDateKey(new Date());
    const latestPunchDateKey = latestCoveragePunch?.punchedAt
      ? formatEcuadorDateKey(latestCoveragePunch.punchedAt)
      : "";
    const attendanceReviewCutoffDateKey =
      latestPunchDateKey && latestPunchDateKey < todayKey ? latestPunchDateKey : latestPunchDateKey ? todayKey : "";

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
      const vacationDateKeys = vacationDateKeysByEmployee.get(employeeKey) || new Set();
      const baseComparableDays = referenceDays.map((referenceDay) => {
        const assignment = assignmentsByEmployeeMonth.get(`${employeeKey}|${monthKeyFromDateKey(referenceDay.dateKey)}`);
        const assignedDay = {
          ...mergeReferenceDaysWithAssignment([referenceDay], assignment)[0],
          ...(manualDaysByEmployeeDate.get(`${employeeKey}|${referenceDay.dateKey}`) || {}),
        };

        return applyEmploymentEndDay(
          enforceHolidayDay(
            applyExceptionPlannedSchedule(
              applyVacationDay(applyEmploymentStartDay(assignedDay, employmentStartDateKey), vacationDateKeys),
              exceptionPlannedSchedulesByEmployeeDate.get(`${employeeKey}|${referenceDay.dateKey}`),
            ),
            holidayDateKeys,
          ),
          terminationDateKey,
        );
      });
      const baseDaysWithExternalFallback = applyAuthorizedExternalWorkFallbackSchedules(
        baseComparableDays,
        authorizedExternalDatesByEmployee.get(employeeKey) || new Set(),
      );
      const comparableDays = applyWeeklyExtraDayTypes(
        baseDaysWithExternalFallback.map((day) => applyLunchPolicyByDay(day)),
      );
      const comparedDays = comparableDays.map((day) =>
        applyDiscountedWorkIntervals(
          applyJustifiedWorkIntervals(
            compareDay(day, punchesByEmployeeDate.get(`${employeeKey}|${day.dateKey}`) || [], employee, scheduleRules),
            justifiedWorkIntervalsByEmployeeDate.get(`${employeeKey}|${day.dateKey}`) || [],
          ),
          discountedWorkIntervalsByEmployeeDate.get(`${employeeKey}|${day.dateKey}`) || [],
        ),
      );
      const attendanceClassifiedDays = applyWeeklyExtraByAttendance(comparedDays);
      const visibleDays = attendanceClassifiedDays.filter((day) => monthKeyFromDateKey(day.dateKey) === monthKey);
      const classifiedDays = applyMonthlyHourTarget(visibleDays);
      const days = classifiedDays.map((day) => {
        const employeeDateKey = `${employeeKey}|${day.dateKey}`;
        const operationalDecision = operationalDecisionsByEmployeeDate.get(employeeDateKey);
        const savedDayDecision = decisionWithResolutionState(
          dayDecisionsByEmployeeDate.get(employeeDateKey),
        );
        const dayWithOperationalDecision = operationalDecision
          ? applyDayDecision(day, operationalDecision)
          : day;
        const dayWithDecisions = savedDayDecision
          ? applyDayDecision(dayWithOperationalDecision, savedDayDecision)
          : operationalDecision
            ? dayWithOperationalDecision
            : applyDayDecision(day);
        const dayWithResolutionState = savedDayDecision && dayWithDecisions.authorization
          ? {
              ...dayWithDecisions,
              authorization: {
                ...dayWithDecisions.authorization,
                additionalResolved: savedDayDecision.additionalResolved === true,
                lateResolved: savedDayDecision.lateResolved === true,
              },
            }
          : dayWithDecisions;
        const comparedDay = suppressSecondaryAttendanceIssues(
          suppressPendingAttendanceLoadNoise(
            dayWithResolutionState,
            attendanceReviewCutoffDateKey,
          ),
        );
        const executionException = attendanceExecutionExceptionsByEmployeeDate.get(employeeDateKey);

        return {
          ...comparedDay,
          executionException: executionException
            ? {
                id: executionException.id,
                type: executionException.type,
                effect: executionException.effect,
              }
            : null,
        };
      });
      const assignment = assignmentsByEmployeeMonth.get(`${employeeKey}|${monthKey}`);
      const hasManualScheduleDays = visibleDays.some((day) => day.source !== "calendar" && day.source !== "holiday");
      const summary = days.reduce((totals, day) => {
        if (day.dayType === "vacation") {
          totals.vacationDays += 1;
        }

        if (isPlannedPaidDay(day)) {
          totals.plannedDays += 1;
          if (day.punchCount > 0) totals.plannedDaysWithPunches += 1;
        }
        if (day.punchCount > 0) totals.daysWithPunches += 1;
        if (day.tags.includes("Sin picadas")) totals.absentDays += 1;
        if (day.tags.includes("Picadas incompletas")) {
          totals.missingPunchDays += 1;
          totals.incompletePunchDays += 1;
        }
        if (day.tags.includes("Salida anticipada")) {
          totals.missingPunchDays += 1;
        }
        const visibleLateMinutes = resolveVisibleLateMinutes(day);
        if (visibleLateMinutes > 0) totals.lateDays += 1;
        if (day.earlyLeaveMinutes > 0) totals.earlyLeaveDays += 1;
        if (day.tags.includes("Picadas de más")) totals.extraPunchDays += 1;
        if (day.tags.some((tag) => UNPLANNED_WORK_TAGS.has(tag))) {
          totals.unplannedWorkDays += 1;
        }
        if (day.supplementaryMinutes > 0 || day.additionalSupplementaryMinutes > 0 || day.extraordinaryMinutes > 0) {
          totals.extraDays += 1;
        }
        if (day.hasIssue) totals.issueDays += 1;
        totals.operationalAlertDays = totals.absentDays + totals.incompletePunchDays + totals.extraPunchDays + totals.unplannedWorkDays;
        if (hasPendingOperationalAlert(day)) totals.pendingOperationalAlertDays += 1;
        if (hasPendingLateAlert(day)) totals.pendingLateDays += 1;
        if (hasPendingAdditionalAlert(day)) totals.pendingAdditionalDays += 1;

        totals.plannedRegularMinutes += resolvePlannedRegularMinutes(day);
        totals.plannedSupplementaryMinutes += resolvePlannedSupplementaryMinutes(day);
        totals.plannedExtraordinaryMinutes += resolvePlannedExtraordinaryMinutes(day);
        totals.lateMinutes += visibleLateMinutes;
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
      const effectiveBaseLaborDays = Math.max(0, baseLaborDays - summary.vacationDays);
      const regularTargetMinutes = effectiveBaseLaborDays * REGULAR_DAY_MINUTES;
      const salary = Number(employee.salary) || 0;
      const hourlyDivisor = MONTHLY_HOURLY_DIVISOR;
      const hourlyRate = calculatePayrollHourlyRate(salary, hourlyDivisor);
      const daysWithPay = summaryOnly
        ? []
        : days.map((day) => ({
            ...day,
            pay: buildDailyPay(day, hourlyRate),
          }));
      const isDismissedInPayrollMonth = isEmployeeDismissedInMonth(employee, monthKey);
      const workedRegularSalary = Math.min(
        salary,
        (Math.max(0, Number(summary.regularWorkedMinutes) || 0) / 60) * hourlyRate,
      );
      const salaryExpected = isDismissedInPayrollMonth ? workedRegularSalary : salary;
      const regularShortfallMinutes = Math.max(
        0,
        regularTargetMinutes - Math.max(0, Number(summary.regularWorkedMinutes) || 0),
      );
      const regularShortfallAffectsSalary = !isDismissedInPayrollMonth;
      const regularShortfallDiscount = regularShortfallAffectsSalary
        ? Math.min(salaryExpected, (regularShortfallMinutes / 60) * hourlyRate)
        : 0;
      const salaryBaseAfterAttendance = Math.max(0, salaryExpected - regularShortfallDiscount);
      const plannedPayrollTotal =
        (summary.plannedSupplementaryMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, SUPPLEMENTARY_SURCHARGE_MULTIPLIER) +
        (summary.plannedExtraordinaryMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, EXTRAORDINARY_SURCHARGE_MULTIPLIER);
      const realPayrollTotal =
        (summary.detectedSupplementaryMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, SUPPLEMENTARY_SURCHARGE_MULTIPLIER) +
        (summary.detectedExtraordinaryMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, EXTRAORDINARY_SURCHARGE_MULTIPLIER);
      const approvedPayrollTotal =
        (summary.supplementaryMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, SUPPLEMENTARY_SURCHARGE_MULTIPLIER) +
        (summary.extraordinaryMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, EXTRAORDINARY_SURCHARGE_MULTIPLIER);
      const approvedExtraMinutes =
        Math.max(0, Number(summary.supplementaryMinutes) || 0) +
        Math.max(0, Number(summary.extraordinaryMinutes) || 0);
      const potentialExtraMinutes =
        Math.max(
          Math.max(0, Number(summary.supplementaryMinutes) || 0),
          Math.max(0, Number(summary.detectedSupplementaryMinutes) || 0),
        ) +
        Math.max(
          Math.max(0, Number(summary.extraordinaryMinutes) || 0),
          Math.max(0, Number(summary.detectedExtraordinaryMinutes) || 0),
        );
      const pendingExtraMinutes = Math.max(0, potentialExtraMinutes - approvedExtraMinutes);
      const salaryPlanned = salaryBaseAfterAttendance + plannedPayrollTotal;
      const salaryReal = salaryBaseAfterAttendance + realPayrollTotal;
      const salaryApproved = salaryBaseAfterAttendance + approvedPayrollTotal;
      const salaryProjected = salaryApproved;

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
          effectiveBaseLaborDays,
          regularTargetMinutes,
          regularTargetLabel: minutesLabel(regularTargetMinutes),
          regularDeficitMinutes: Math.max(0, summary.plannedRegularMinutes - summary.regularWorkedMinutes),
          regularDeficitLabel: minutesLabel(Math.max(0, summary.plannedRegularMinutes - summary.regularWorkedMinutes)),
          plannedRegularLabel: plannedMinutesLabel(summary.plannedRegularMinutes),
          plannedSupplementaryLabel: plannedMinutesLabel(summary.plannedSupplementaryMinutes),
          plannedExtraordinaryLabel: plannedMinutesLabel(summary.plannedExtraordinaryMinutes),
          salaryExpected: money(salaryExpected),
          salaryExpectedRaw: salaryExpected,
          salaryExpectedValue: money(salaryExpected),
          salaryExpectedLabel: moneyLabel(salaryExpected),
          salaryBaseAfterAttendance: money(salaryBaseAfterAttendance),
          salaryBaseAfterAttendanceRaw: salaryBaseAfterAttendance,
          salaryBaseAfterAttendanceLabel: moneyLabel(salaryBaseAfterAttendance),
          regularShortfallMinutes,
          regularShortfallLabel: minutesLabel(regularShortfallMinutes),
          regularShortfallDiscount: money(regularShortfallDiscount),
          regularShortfallDiscountRaw: regularShortfallDiscount,
          regularShortfallDiscountLabel: moneyLabel(regularShortfallDiscount),
          regularShortfallAffectsSalary,
          salaryPlanned: money(salaryPlanned),
          salaryPlannedLabel: moneyLabel(salaryPlanned),
          salaryReal: money(salaryReal),
          salaryRealLabel: moneyLabel(salaryReal),
          salaryApproved: money(salaryApproved),
          salaryApprovedLabel: moneyLabel(salaryApproved),
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
          approvedExtraMinutes,
          approvedExtraLabel: minutesLabel(approvedExtraMinutes),
          potentialExtraMinutes,
          potentialExtraLabel: minutesLabel(potentialExtraMinutes),
          pendingExtraMinutes,
          pendingExtraLabel: minutesLabel(pendingExtraMinutes),
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
        totals.missingLunchDays += row.summary.missingLunchDays || 0;
        totals.operationalAlertDays += row.summary.operationalAlertDays;
        totals.pendingOperationalAlertDays += row.summary.pendingOperationalAlertDays;
        totals.pendingLateDays += row.summary.pendingLateDays;
        totals.pendingAdditionalDays += row.summary.pendingAdditionalDays;
        totals.lateDays += row.summary.lateDays;
        totals.earlyLeaveDays += row.summary.earlyLeaveDays;
        totals.lateMinutes += row.summary.lateMinutes;
        totals.earlyLeaveMinutes += row.summary.earlyLeaveMinutes;
        totals.extraDays += row.summary.extraDays;
        totals.vacationDays += row.summary.vacationDays || 0;
        totals.baseLaborDays += row.summary.baseLaborDays || 0;
        totals.effectiveBaseLaborDays += row.summary.effectiveBaseLaborDays || 0;
        totals.regularTargetMinutes += row.summary.regularTargetMinutes || 0;
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
        missingLunchDays: 0,
        operationalAlertDays: 0,
        pendingOperationalAlertDays: 0,
        pendingLateDays: 0,
        pendingAdditionalDays: 0,
        lateDays: 0,
        earlyLeaveDays: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        extraDays: 0,
        vacationDays: 0,
        baseLaborDays: 0,
        effectiveBaseLaborDays: 0,
        regularTargetMinutes: 0,
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
      attendanceReview: {
        cutoffDateKey: attendanceReviewCutoffDateKey,
        latestPunchDateKey,
        isLimitedByPunchLoad: Boolean(latestPunchDateKey),
      },
      summary: {
        ...summary,
        plannedRegularLabel: plannedMinutesLabel(summary.plannedRegularMinutes),
        plannedSupplementaryLabel: plannedMinutesLabel(summary.plannedSupplementaryMinutes),
        plannedExtraordinaryLabel: plannedMinutesLabel(summary.plannedExtraordinaryMinutes),
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
