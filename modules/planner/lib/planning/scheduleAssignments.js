import { addDays, format, startOfWeek } from "date-fns";

import { makeEcuadorDate } from "@/lib/datetime/ecuador";
import { parseMonthKey } from "@/modules/planner/lib/planning/holidays";
import { WEEK_DAYS } from "@/modules/planner/lib/schedules";

const DAY_LABELS = new Map(WEEK_DAYS.map((day) => [day.dayOfWeek, day.label]));

function toId(value) {
  return value?._id?.toString?.() || value?.toString?.() || "";
}

export function getMonthDateKeys(monthKey) {
  const { year, monthIndex } = parseMonthKey(monthKey);
  const startDate = makeEcuadorDate(year, monthIndex, 1);
  const nextMonthDate = makeEcuadorDate(year, monthIndex + 1, 1);
  const dateKeys = [];

  for (let date = startDate; date < nextMonthDate; date = addDays(date, 1)) {
    dateKeys.push(format(date, "yyyy-MM-dd"));
  }

  return dateKeys;
}

function getDayOfWeek(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);

  return date.getDay();
}

function cloneTemplateRow(row) {
  return {
    dayType: row?.dayType || "off_day",
    startTime: row?.startTime || "",
    lunchDurationMinutes: Number(row?.lunchDurationMinutes) || 0,
    lunchStartTime: row?.lunchStartTime || "",
    lunchEndTime: row?.lunchEndTime || "",
    endTime: row?.endTime || "",
    authorizedExtraMinutes: 0,
  };
}

function parseTimeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) {
    return null;
  }

  const [hours, minutes] = String(value).split(":").map(Number);

  return hours * 60 + minutes;
}

function calculateNetMinutes(row) {
  const start = parseTimeToMinutes(row?.startTime);
  const end = parseTimeToMinutes(row?.endTime);

  if (start === null || end === null || end <= start) {
    return 0;
  }

  return Math.max(0, end - start - (Number(row?.lunchDurationMinutes) || 0));
}

export function getWeekStartKey(dateKey) {
  return format(startOfWeek(new Date(`${dateKey}T12:00:00`), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export function getMonthWeekOptions(monthKey) {
  const dateKeys = getMonthDateKeys(monthKey);
  const datesByWeek = dateKeys.reduce((map, dateKey) => {
    const weekStartKey = getWeekStartKey(dateKey);

    if (!map.has(weekStartKey)) {
      map.set(weekStartKey, []);
    }

    map.get(weekStartKey).push(dateKey);
    return map;
  }, new Map());

  return [...datesByWeek.keys()].map((weekStartKey, index) => {
    const weekStart = new Date(`${weekStartKey}T12:00:00`);
    const weekEnd = addDays(weekStart, 6);
    const weekEndKey = format(weekEnd, "yyyy-MM-dd");
    const crossesMonth = weekStartKey.slice(5, 7) !== weekEndKey.slice(5, 7);

    return {
      weekStartKey,
      label: `Sem. ${index + 1}`,
      rangeLabel: crossesMonth
        ? `${format(weekStart, "dd/MM")}-${format(weekEnd, "dd/MM")}`
        : `${weekStartKey.slice(8, 10)}-${weekEndKey.slice(8, 10)}`,
    };
  });
}

export function getPreviousMonthKey(monthKey) {
  const { year, monthIndex } = parseMonthKey(monthKey);
  const previous = makeEcuadorDate(year, monthIndex - 1, 1);

  return format(previous, "yyyy-MM");
}

export function getNextMonthKey(monthKey) {
  const { year, monthIndex } = parseMonthKey(monthKey);
  const next = makeEcuadorDate(year, monthIndex + 1, 1);

  return format(next, "yyyy-MM");
}

export function getTemplateVariant(template) {
  const weeklyRows = template?.weeklyRows || [];
  const saturday = weeklyRows.find((row) => row.dayOfWeek === 6)?.dayType === "weekend_overtime";
  const sunday = weeklyRows.find((row) => row.dayOfWeek === 0)?.dayType === "weekend_overtime";
  const startTime = [...new Set(
    weeklyRows
      .filter((row) => [1, 2, 3, 4, 5].includes(row.dayOfWeek))
      .map((row) => row.startTime)
      .filter(Boolean),
  )][0] || "";
  const variantType = saturday && sunday
    ? "sabado_domingo"
    : saturday
      ? "sabado"
      : sunday
        ? "domingo"
        : "base";

  return {
    variantType,
    startTime,
    key: `${variantType}|${startTime}`,
  };
}

export function sortTemplatesByVariant(templates = []) {
  const typeOrder = new Map([
    ["base", 0],
    ["sabado", 1],
    ["domingo", 2],
    ["sabado_domingo", 3],
    ["custom", 4],
  ]);

  return [...templates].sort((left, right) => {
    const leftVariant = getTemplateVariant(left);
    const rightVariant = getTemplateVariant(right);
    const typeDelta =
      (typeOrder.get(leftVariant.variantType) ?? 9) - (typeOrder.get(rightVariant.variantType) ?? 9);

    if (typeDelta) {
      return typeDelta;
    }

    return `${leftVariant.startTime}${left.name || ""}`.localeCompare(
      `${rightVariant.startTime}${right.name || ""}`,
      "es",
    );
  });
}

function buildRotationRowsByWeek(monthKey, template, rotationTemplates = []) {
  const dateKeys = getMonthDateKeys(monthKey);
  const weekKeys = [...new Set(dateKeys.map(getWeekStartKey))];
  const activeRotationTemplates = (rotationTemplates || [])
    .filter((candidate) => candidate?.weeklyRows?.length)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "es"));

  if (!template?.rotationGroup || activeRotationTemplates.length < 2) {
    return new Map([[0, new Map((template?.weeklyRows || []).map((row) => [row.dayOfWeek, cloneTemplateRow(row)]))]]);
  }

  return new Map(
    weekKeys.map((weekKey, index) => {
      const weeklyTemplate = activeRotationTemplates[index % activeRotationTemplates.length];

      return [
        weekKey,
        new Map((weeklyTemplate.weeklyRows || []).map((row) => [row.dayOfWeek, cloneTemplateRow(row)])),
      ];
    }),
  );
}

function resolveTemplateRowForDate(rowsByDay, dayOfWeek) {
  const directRow = rowsByDay.get(dayOfWeek);

  if (directRow) {
    return directRow;
  }

  if (![1, 2, 3, 4, 5].includes(dayOfWeek)) {
    return cloneTemplateRow();
  }

  const weekdayFallback = [1, 2, 3, 4, 5]
    .map((weekday) => rowsByDay.get(weekday))
    .find((row) => row?.dayType === "workday");

  return weekdayFallback || cloneTemplateRow();
}

export function buildGeneratedDays(
  monthKey,
  template,
  holidays = [],
  rotationTemplates = [],
  { weekdaysOnly = false } = {},
) {
  const rowsByWeek = buildRotationRowsByWeek(monthKey, template, rotationTemplates);
  const fallbackRows = rowsByWeek.get(0) || new Map();
  const holidayNamesByDate = new Map(holidays.map((holiday) => [holiday.dateKey, holiday.name]));

  return getMonthDateKeys(monthKey).map((dateKey) => {
    const dayOfWeek = getDayOfWeek(dateKey);
    const weekKey = getWeekStartKey(dateKey);
    const rowsByDay = rowsByWeek.get(weekKey) || fallbackRows;
    const baseRow = resolveTemplateRowForDate(rowsByDay, dayOfWeek);
    const holidayName = holidayNamesByDate.get(dateKey);

    if (holidayName) {
      return {
        dateKey,
        dayOfWeek,
        label: DAY_LABELS.get(dayOfWeek) || "",
        dayType: "holiday",
        startTime: "",
        lunchDurationMinutes: 0,
        endTime: "",
        authorizedExtraMinutes: 0,
        source: "holiday",
      };
    }

    if (weekdaysOnly && ![1, 2, 3, 4, 5].includes(dayOfWeek)) {
      return {
        dateKey,
        dayOfWeek,
        label: DAY_LABELS.get(dayOfWeek) || "",
        dayType: "off_day",
        startTime: "",
        lunchDurationMinutes: 0,
        lunchStartTime: "",
        lunchEndTime: "",
        endTime: "",
        authorizedExtraMinutes: 0,
        source: "fixed_role_weekend",
      };
    }

    return {
      dateKey,
      dayOfWeek,
      label: DAY_LABELS.get(dayOfWeek) || "",
      ...baseRow,
      source: "template",
    };
  });
}

function normalizeWeeklyPlanEntry(entry, fallbackLabel = "") {
  const template = entry?.templateDoc || entry?.template;
  const variant = getTemplateVariant(template);

  return {
    weekStartKey: entry?.weekStartKey || "",
    label: entry?.label || fallbackLabel,
    template: template?._id || template || entry?.template || null,
    templateName: template?.name || entry?.templateName || "",
    rotationGroup: template?.rotationGroup || entry?.rotationGroup || "",
    variantType: variant.variantType,
    startTime: variant.startTime,
    templateDoc: template?.weeklyRows ? template : entry?.templateDoc,
  };
}

export function buildGeneratedDaysFromWeeklyPlan(monthKey, weeklyPlan = [], holidays = []) {
  const weekOptions = getMonthWeekOptions(monthKey);
  const planByWeek = new Map(
    weeklyPlan
      .map((entry, index) => normalizeWeeklyPlanEntry(entry, weekOptions[index]?.label || ""))
      .filter((entry) => entry.weekStartKey && entry.templateDoc?.weeklyRows?.length)
      .map((entry) => [
        entry.weekStartKey,
        new Map(entry.templateDoc.weeklyRows.map((row) => [row.dayOfWeek, cloneTemplateRow(row)])),
      ]),
  );
  const fallbackRows = planByWeek.values().next().value || new Map();
  const holidayNamesByDate = new Map(holidays.map((holiday) => [holiday.dateKey, holiday.name]));

  return getMonthDateKeys(monthKey).map((dateKey) => {
    const dayOfWeek = getDayOfWeek(dateKey);
    const weekKey = getWeekStartKey(dateKey);
    const rowsByDay = planByWeek.get(weekKey) || fallbackRows;
    const baseRow = resolveTemplateRowForDate(rowsByDay, dayOfWeek);
    const holidayName = holidayNamesByDate.get(dateKey);

    if (holidayName) {
      return {
        dateKey,
        dayOfWeek,
        label: DAY_LABELS.get(dayOfWeek) || "",
        dayType: "holiday",
        startTime: "",
        lunchDurationMinutes: 0,
        endTime: "",
        authorizedExtraMinutes: 0,
        source: "holiday",
      };
    }

    return {
      dateKey,
      dayOfWeek,
      label: DAY_LABELS.get(dayOfWeek) || "",
      ...baseRow,
      source: "template",
    };
  });
}

export function summarizeGeneratedDays(days = []) {
  return days.reduce(
    (summary, day) => {
      if (day.dayType === "workday") {
        summary.workdays += 1;
        summary.supplementaryMinutes += Number(day.authorizedExtraMinutes) || 0;
      }

      if (day.dayType === "weekend_overtime") {
        summary.extraordinaryDays += 1;
      }

      if (day.dayType === "holiday") {
        summary.holidays += 1;
      }

      if (day.dayType === "off_day") {
        summary.restDays += 1;
      }

      return summary;
    },
    {
      workdays: 0,
      restDays: 0,
      holidays: 0,
      extraordinaryDays: 0,
      supplementaryMinutes: 0,
    },
  );
}

export function buildAssignmentPayload({
  employee,
  template,
  monthKey,
  holidays,
  notes = "",
  rotationTemplates = [],
  weeklyPlan = [],
  weekdaysOnly = false,
}) {
  const normalizedWeeklyPlan = weeklyPlan
    .map((entry, index) =>
      normalizeWeeklyPlanEntry(entry, getMonthWeekOptions(monthKey)[index]?.label || ""),
    )
    .filter((entry) => entry.weekStartKey && entry.template);
  const generatedDays = normalizedWeeklyPlan.length
    ? buildGeneratedDaysFromWeeklyPlan(monthKey, normalizedWeeklyPlan, holidays)
    : buildGeneratedDays(monthKey, template, holidays, rotationTemplates, { weekdaysOnly });
  const primaryTemplate = template || normalizedWeeklyPlan[0]?.templateDoc || {};

  return {
    monthKey,
    employee: employee._id,
    employeeName: employee.fullName || "",
    employeeDni: employee.dni || "",
    branchCode: employee.branchCode || "",
    branchName: employee.branchName || employee.branch || "",
    areaCode: primaryTemplate.areaCode || employee.areaCode || "",
    areaName: primaryTemplate.areaName || employee.areaName || "",
    roleCode: primaryTemplate.roleCode || employee.roleCode || "",
    roleName: primaryTemplate.roleName || employee.roleName || "",
    template: primaryTemplate._id,
    templateName: primaryTemplate.name || "",
    rotationGroup: primaryTemplate.rotationGroup || "",
    generatedDays,
    weeklyPlan: normalizedWeeklyPlan.map((entry) => ({
      weekStartKey: entry.weekStartKey,
      label: entry.label,
      template: entry.template,
      templateName: entry.templateName,
      rotationGroup: entry.rotationGroup,
      variantType: entry.variantType,
      startTime: entry.startTime,
    })),
    notes: String(notes || "").trim(),
  };
}

export function serializeScheduleAssignment(assignment) {
  const generatedDays = assignment.generatedDays || [];

  return {
    id: toId(assignment),
    monthKey: assignment.monthKey || "",
    employeeId: toId(assignment.employee),
    employeeName: assignment.employeeName || "",
    employeeDni: assignment.employeeDni || "",
    branchCode: assignment.branchCode || "",
    branchName: assignment.branchName || "",
    areaCode: assignment.areaCode || "",
    areaName: assignment.areaName || "",
    roleCode: assignment.roleCode || "",
    roleName: assignment.roleName || "",
    templateId: toId(assignment.template),
    templateName: assignment.templateName || "",
    rotationGroup: assignment.rotationGroup || "",
    generatedDays,
    weeklyPlan: (assignment.weeklyPlan || []).map((week) => ({
      weekStartKey: week.weekStartKey || "",
      label: week.label || "",
      templateId: toId(week.template),
      templateName: week.templateName || "",
      rotationGroup: week.rotationGroup || "",
      variantType: week.variantType || "custom",
      startTime: week.startTime || "",
    })),
    scheduleHistory: (assignment.scheduleHistory || []).map((entry) => ({
      groupId: toId(entry.groupId),
      groupName: entry.groupName || "",
      weekStartKey: entry.weekStartKey || "",
      savedAt: entry.savedAt,
      savedBy: entry.savedBy || "",
      savedByUser: entry.savedByUser || "",
      daysCount: (entry.generatedDays || []).length,
    })),
    planningApprovals: (assignment.planningApprovals || []).map((approval) => ({
      groupId: toId(approval.groupId),
      groupName: approval.groupName || "",
      weekStartKey: approval.weekStartKey || "",
      approvedAt: approval.approvedAt,
      approvedBy: approval.approvedBy || "",
      approvedByUser: approval.approvedByUser || "",
      versionSavedAt: approval.versionSavedAt || null,
      versionSavedBy: approval.versionSavedBy || "",
      versionSavedByUser: approval.versionSavedByUser || "",
      unlockedAt: approval.unlockedAt || null,
      unlockedBy: approval.unlockedBy || "",
      unlockedByUser: approval.unlockedByUser || "",
      unlockReason: approval.unlockReason || "",
    })),
    summary: summarizeGeneratedDays(generatedDays),
    notes: assignment.notes || "",
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}
