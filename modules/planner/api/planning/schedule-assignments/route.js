import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { getAuthenticatedUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { buildEmployeeActiveInMonthQuery, isEmployeeActiveOnDate } from "@/modules/company/submodules/people/lib/employees";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  applyPlannerScopeToAssignmentQuery,
  applyPlannerScopeToEmployeeQuery,
  applyPlannerScopeToEmployeeReferenceQuery,
  assertEmployeesInPlannerScope,
  assertWorkGroupInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import { parseMonthKey, serializeHoliday } from "@/modules/planner/lib/planning/holidays";
import { serializeOperationalException } from "@/modules/planner/lib/planning/exceptions";
import { serializeVacationRecord } from "@/modules/planner/lib/planning/vacations";
import {
  buildAssignmentPayload,
  buildGeneratedDays,
  getNextMonthKey,
  getMonthWeekOptions,
  getPreviousMonthKey,
  serializeScheduleAssignment,
  sortTemplatesByVariant,
} from "@/modules/planner/lib/planning/scheduleAssignments";
import { BaseScheduleTemplate } from "@/modules/planner/models";
import { Employee, Role } from "@/modules/company/models";
import { Holiday } from "@/modules/planner/models";
import { OperationalException } from "@/modules/planner/models";
import { ScheduleAssignment } from "@/modules/planner/models";
import { PlanningWorkGroup } from "@/modules/planner/models";
import { VacationRequest } from "@/modules/planner/models";

const DAY_LABELS = new Map([
  [0, "Domingo"],
  [1, "Lunes"],
  [2, "Martes"],
  [3, "Miercoles"],
  [4, "Jueves"],
  [5, "Viernes"],
  [6, "Sabado"],
]);
const EXCEPTION_STATUS_LABELS = new Map([
  ["open", "Abierta"],
  ["resolved", "Resuelta"],
  ["void", "Anulada"],
]);

function getDayOfWeek(dateKey) {
  return new Date(`${dateKey}T12:00:00`).getDay();
}

function parseTimeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return null;

  const [hours, minutes] = String(value).split(":").map(Number);
  return (hours * 60) + minutes;
}

function calculateNetScheduleMinutes(row) {
  const start = parseTimeToMinutes(row?.startTime);
  const end = parseTimeToMinutes(row?.endTime);

  if (start === null || end === null || end <= start) return 0;

  return Math.max(0, end - start - (Number(row?.lunchDurationMinutes) || 0));
}

function hasScheduledTemplateRow(row) {
  return ["workday", "weekend_overtime"].includes(row?.dayType) && row?.startTime && row?.endTime;
}

function resolveTemplateOverrideDay(templateDay, template, dateKey) {
  const dayOfWeek = getDayOfWeek(dateKey);
  const isHoliday = templateDay?.dayType === "holiday";

  if (hasScheduledTemplateRow(templateDay)) {
    const dayType = isHoliday || [0, 6].includes(dayOfWeek)
      ? "weekend_overtime"
      : templateDay.dayType;
    const netMinutes = calculateNetScheduleMinutes(templateDay);

    return {
      ...templateDay,
      dayType,
      authorizedExtraMinutes: dayType === "weekend_overtime" ? netMinutes : Number(templateDay.authorizedExtraMinutes) || 0,
    };
  }

  const fallbackRow = [1, 2, 3, 4, 5, 6, 0]
    .map((weekday) => (template?.weeklyRows || []).find((row) => row.dayOfWeek === weekday))
    .find(hasScheduledTemplateRow);

  if (!fallbackRow) return templateDay;

  const dayType = isHoliday || [0, 6].includes(dayOfWeek)
    ? "weekend_overtime"
    : fallbackRow.dayType;
  const netMinutes = calculateNetScheduleMinutes(fallbackRow);

  return {
    ...templateDay,
    dayType,
    startTime: fallbackRow.startTime || "",
    lunchDurationMinutes: Number(fallbackRow.lunchDurationMinutes) || 0,
    lunchStartTime: fallbackRow.lunchStartTime || "",
    lunchEndTime: fallbackRow.lunchEndTime || "",
    endTime: fallbackRow.endTime || "",
    authorizedExtraMinutes: dayType === "weekend_overtime" ? netMinutes : Number(fallbackRow.authorizedExtraMinutes) || 0,
  };
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function getWeekMonthKeys(weekStartKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekStartKey || ""))) {
    return [];
  }

  return [...new Set(Array.from({ length: 7 }, (_, index) =>
    addDaysToDateKey(weekStartKey, index).slice(0, 7),
  ))];
}

function getWeekDateKeySet(weekStartKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekStartKey || ""))) {
    return null;
  }

  return new Set(Array.from({ length: 7 }, (_, index) => addDaysToDateKey(weekStartKey, index)));
}

function normalizeEmployeeIdList(value) {
  const rawIds = Array.isArray(value) ? value : String(value || "").split(",");

  return [...new Set(rawIds
    .map((employeeId) => String(employeeId || "").trim())
    .filter(Boolean))];
}

function normalizeGroupId(value) {
  const groupId = String(value || "").trim();

  return /^[a-f\d]{24}$/i.test(groupId) ? groupId : "";
}

function castAssignmentEmployeeQuery(query = {}) {
  const nextQuery = { ...query };
  const employeeQuery = query.employee;

  if (typeof employeeQuery === "string" && mongoose.isValidObjectId(employeeQuery)) {
    nextQuery.employee = new mongoose.Types.ObjectId(employeeQuery);
  } else if (employeeQuery?.$in) {
    nextQuery.employee = {
      ...employeeQuery,
      $in: employeeQuery.$in.map((employeeId) =>
        mongoose.isValidObjectId(employeeId) ? new mongoose.Types.ObjectId(employeeId) : employeeId,
      ),
    };
  }

  return nextQuery;
}

function findScheduleAssignmentsForWeek(query, weekStartKey, groupId = "") {
  const weekDateKeys = getWeekDateKeySet(weekStartKey);

  if (!weekDateKeys) {
    return ScheduleAssignment.find(query).sort({ employeeName: 1 }).lean();
  }

  const historyConditions = [
    { $eq: ["$$entry.weekStartKey", weekStartKey] },
  ];
  const approvalConditions = [
    { $eq: ["$$approval.weekStartKey", weekStartKey] },
  ];

  if (groupId) {
    const groupObjectId = new mongoose.Types.ObjectId(groupId);
    historyConditions.push({ $eq: ["$$entry.groupId", groupObjectId] });
    approvalConditions.push({ $eq: ["$$approval.groupId", groupObjectId] });
  }

  return ScheduleAssignment.aggregate([
    { $match: castAssignmentEmployeeQuery(query) },
    {
      $set: {
        scheduleHistory: {
          $filter: {
            input: { $ifNull: ["$scheduleHistory", []] },
            as: "entry",
            cond: { $and: historyConditions },
          },
        },
        planningApprovals: {
          $filter: {
            input: { $ifNull: ["$planningApprovals", []] },
            as: "approval",
            cond: { $and: approvalConditions },
          },
        },
      },
    },
    { $sort: { employeeName: 1 } },
  ]);
}

function assertEmployeesBelongToGroup(employeeIds = [], workGroup = null) {
  if (!workGroup) {
    throw new Error("El grupo de trabajo seleccionado no existe.");
  }

  const memberIds = new Set((workGroup.members || []).map((member) => member.employee?.toString?.() || ""));
  const outOfGroupIds = employeeIds.filter((employeeId) => employeeId && !memberIds.has(employeeId));

  if (outOfGroupIds.length) {
    throw new Error("Uno o mas empleados ya no pertenecen al grupo de trabajo seleccionado.");
  }
}

function buildHistoryVersionKey(entry = {}) {
  const savedAt = entry.savedAt ? new Date(entry.savedAt).toISOString() : "";
  const actor = entry.savedByUser || entry.savedBy || "sistema";
  const groupId = normalizeGroupId(entry.groupId);

  return `${groupId}|${savedAt}|${actor}`;
}

function buildHistoryMatchFromVersion(version = {}, groupId = "") {
  const savedAt = new Date(version.savedAt || version.versionSavedAt || 0);
  const match = {
    ...(groupId ? { groupId } : {}),
    weekStartKey: String(version.weekStartKey || "").trim(),
    savedAt,
  };
  const savedByUser = String(version.savedByUser || version.versionSavedByUser || "").trim();
  const savedBy = String(version.savedBy || version.versionSavedBy || "").trim();

  if (Number.isNaN(savedAt.getTime())) {
    return null;
  }

  if (savedByUser) {
    match.savedByUser = savedByUser;
  } else if (savedBy) {
    match.savedBy = savedBy;
  }

  return match;
}

function getLatestHistoryVersion(assignments = [], weekStartKey, groupId = "") {
  return assignments
    .flatMap((assignment) => assignment.scheduleHistory || [])
    .filter((entry) =>
      entry.weekStartKey === weekStartKey
      && entry.savedAt
      && (!groupId || normalizeGroupId(entry.groupId) === groupId),
    )
    .sort((left, right) => new Date(right.savedAt || 0).getTime() - new Date(left.savedAt || 0).getTime())[0] || null;
}

function serializeScheduleAssignmentForWeek(assignment, weekStartKey, groupId = "") {
  const weekDateKeys = getWeekDateKeySet(weekStartKey);

  if (!weekDateKeys) {
    return serializeScheduleAssignment(assignment);
  }

  const matchingHistory = (assignment.scheduleHistory || []).filter((entry) =>
    entry.weekStartKey === weekStartKey
    && (!groupId || normalizeGroupId(entry.groupId) === groupId),
  );
  const latestPlanningVersion = matchingHistory.reduce((latest, entry) =>
    !latest || new Date(entry.savedAt || 0) > new Date(latest.savedAt || 0) ? entry : latest,
  null);
  const latestVersionKey = latestPlanningVersion
    ? buildHistoryVersionKey(latestPlanningVersion)
    : "";
  const latestPlanningDays = latestVersionKey
    ? matchingHistory
      .filter((entry) => buildHistoryVersionKey(entry) === latestVersionKey)
      .flatMap((entry) => entry.generatedDays || [])
    : assignment.generatedDays || [];
  const generatedDays = [...new Map(
    latestPlanningDays
      .filter((day) => weekDateKeys.has(day.dateKey))
      .map((day) => [day.dateKey, day]),
  ).values()].sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey)));
  const serialized = serializeScheduleAssignment({
    ...assignment,
    generatedDays,
    scheduleHistory: [],
    planningApprovals: [],
  });

  return {
    ...serialized,
    scheduleHistory: matchingHistory.map((entry) => ({
      groupId: normalizeGroupId(entry.groupId),
      groupName: entry.groupName || "",
      weekStartKey: entry.weekStartKey || "",
      savedAt: entry.savedAt,
      savedBy: entry.savedBy || "",
      savedByUser: entry.savedByUser || "",
      daysCount: (entry.generatedDays || []).length,
    })),
    planningApprovals: (assignment.planningApprovals || [])
      .filter((approval) =>
        approval.weekStartKey === weekStartKey
        && (!groupId || normalizeGroupId(approval.groupId) === groupId),
      )
      .map((approval) => ({
        groupId: normalizeGroupId(approval.groupId),
        groupName: approval.groupName || "",
        weekStartKey: approval.weekStartKey || "",
        approvedAt: approval.approvedAt,
        approvedBy: approval.approvedBy || "",
        approvedByUser: approval.approvedByUser || "",
        versionSavedAt: approval.versionSavedAt || null,
        versionSavedBy: approval.versionSavedBy || "",
        versionSavedByUser: approval.versionSavedByUser || "",
      })),
  };
}

function normalizeOperationalDay(day, holidayNamesByDate, isVacationDate = false) {
  const dateKey = String(day?.dateKey || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }

  const dayOfWeek = getDayOfWeek(dateKey);
  const holidayName = holidayNamesByDate.get(dateKey);
  const requestedType = String(day?.dayType || "off_day").trim();
  const isWorkday = requestedType === "workday" || requestedType === "weekend_overtime";
  const isVacation = requestedType === "vacation";
  const operationalNote = String(day?.operationalNote || "").trim().toUpperCase();
  const operationalJustification = Boolean(day?.operationalJustification && operationalNote);

  if (holidayName && isWorkday && day?.startTime && day?.endTime) {
    return {
      dateKey,
      dayOfWeek,
      label: DAY_LABELS.get(dayOfWeek) || "",
      dayType: "weekend_overtime",
      startTime: String(day.startTime).trim(),
      lunchDurationMinutes: Math.max(0, Number(day.lunchDurationMinutes) || 0),
      lunchStartTime: String(day.lunchStartTime || "").trim(),
      lunchEndTime: String(day.lunchEndTime || "").trim(),
      endTime: String(day.endTime).trim(),
      authorizedExtraMinutes: calculateNetScheduleMinutes(day),
      areaCode: String(day?.areaCode || "").trim(),
      areaName: String(day?.areaName || "").trim().toUpperCase(),
      roleCode: String(day?.roleCode || "").trim(),
      roleName: String(day?.roleName || "").trim().toUpperCase(),
      operationalNote,
      operationalJustification,
      source: "operational",
    };
  }

  if (holidayName) {
    return {
      dateKey,
      dayOfWeek,
      label: DAY_LABELS.get(dayOfWeek) || "",
      dayType: "holiday",
      startTime: "",
      lunchDurationMinutes: 0,
      lunchStartTime: "",
      lunchEndTime: "",
      endTime: "",
      authorizedExtraMinutes: 0,
      areaCode: String(day?.areaCode || "").trim(),
      areaName: String(day?.areaName || "").trim().toUpperCase(),
      roleCode: String(day?.roleCode || "").trim(),
      roleName: String(day?.roleName || "").trim().toUpperCase(),
      operationalNote,
      operationalJustification,
      source: "holiday",
    };
  }

  if (isVacationDate) {
    return {
      dateKey,
      dayOfWeek,
      label: DAY_LABELS.get(dayOfWeek) || "",
      dayType: "vacation",
      startTime: "",
      lunchDurationMinutes: 0,
      lunchStartTime: "",
      lunchEndTime: "",
      endTime: "",
      authorizedExtraMinutes: 0,
      areaCode: String(day?.areaCode || "").trim(),
      areaName: String(day?.areaName || "").trim().toUpperCase(),
      roleCode: String(day?.roleCode || "").trim(),
      roleName: String(day?.roleName || "").trim().toUpperCase(),
      operationalNote: "",
      operationalJustification: false,
      source: "vacation",
    };
  }

  return {
    dateKey,
    dayOfWeek,
    label: DAY_LABELS.get(dayOfWeek) || "",
    dayType: isWorkday ? requestedType : (isVacation ? "vacation" : "off_day"),
    startTime: isWorkday ? String(day?.startTime || "").trim() : "",
    lunchDurationMinutes: isWorkday ? Math.max(0, Number(day?.lunchDurationMinutes) || 0) : 0,
    lunchStartTime: isWorkday ? String(day?.lunchStartTime || "").trim() : "",
    lunchEndTime: isWorkday ? String(day?.lunchEndTime || "").trim() : "",
    endTime: isWorkday ? String(day?.endTime || "").trim() : "",
    authorizedExtraMinutes: isWorkday ? Math.max(0, Number(day?.authorizedExtraMinutes) || 0) : 0,
    areaCode: String(day?.areaCode || "").trim(),
    areaName: String(day?.areaName || "").trim().toUpperCase(),
    roleCode: String(day?.roleCode || "").trim(),
    roleName: String(day?.roleName || "").trim().toUpperCase(),
    operationalNote,
    operationalJustification,
    source: "operational",
  };
}

function buildAutoExceptionPayload({ employee, day }) {
  const note = String(day?.operationalNote || "").trim().toUpperCase();

  if (!note || day?.operationalJustification !== true) {
    return null;
  }

  const basePayload = {
    employee: employee._id,
    employeeName: employee.fullName || "",
    employeeDni: employee.dni || "",
    branchName: employee.branchName || employee.branch || "",
    areaName: employee.areaName || "",
    roleName: day.roleName || employee.roleName || "",
    date: new Date(`${day.dateKey}T12:00:00.000Z`),
    dateKey: day.dateKey,
    endDate: null,
    endDateKey: "",
    startTime: "",
    endTime: "",
    registeredBy: "IMPORTACION HORARIOS",
    authorizedBy: "",
    resolution: "pending",
    resolutionNotes: "",
    notes: `IMPORTADO DESDE HORARIO: ${note}`,
    status: "open",
  };

  if (note === "PERMISO") {
    return {
      ...basePayload,
      type: "permission",
      scope: "full_day",
      destination: "",
      countsAsWorkedTime: false,
      allowSupplementaryTime: false,
    };
  }

  return {
    ...basePayload,
    type: "other",
    scope: "other",
    destination: note,
    countsAsWorkedTime: false,
    allowSupplementaryTime: false,
  };
}

function serializeExceptionSnapshot(exception = {}) {
  const serialized = exception._id
    ? serializeOperationalException(exception)
    : serializeOperationalException({
      ...exception,
      _id: {
        toString: () => "",
      },
      createdAt: exception.createdAt || null,
      updatedAt: exception.updatedAt || null,
    });
  const title = [
    serialized.typeLabel || serialized.type || "Excepcion",
    serialized.destination,
  ].filter(Boolean).join(" - ");

  return {
    ...serialized,
    title,
    statusLabel: EXCEPTION_STATUS_LABELS.get(serialized.status) || serialized.status || "Sin estado",
  };
}

function doesExceptionCoverDate(exception = {}, dateKey = "") {
  const startKey = String(exception.dateKey || "").trim();
  const endKey = String(exception.endDateKey || "").trim() || startKey;

  return startKey && dateKey >= startKey && dateKey <= endKey;
}

function buildExceptionSnapshotKey(employeeId, dateKey) {
  return `${employeeId}|${dateKey}`;
}

function addExceptionSnapshot(snapshotMap, employeeId, dateKey, exception) {
  if (!employeeId || !dateKey || !exception) return;

  const key = buildExceptionSnapshotKey(employeeId, dateKey);

  if (!snapshotMap.has(key)) {
    snapshotMap.set(key, []);
  }

  snapshotMap.get(key).push(serializeExceptionSnapshot(exception));
}

function buildExceptionSnapshotsByEmployeeDate(exceptions = [], employeeIds = [], dateKeys = []) {
  const employeeIdSet = new Set(employeeIds.map((employeeId) => String(employeeId || "").trim()).filter(Boolean));
  const snapshotMap = new Map();

  exceptions.forEach((exception) => {
    const employeeId = exception.employee?.toString?.() || String(exception.employee || "");

    if (!employeeIdSet.has(employeeId)) return;

    dateKeys.forEach((dateKey) => {
      if (doesExceptionCoverDate(exception, dateKey)) {
        addExceptionSnapshot(snapshotMap, employeeId, dateKey, exception);
      }
    });
  });

  return snapshotMap;
}

function buildVacationDateKeysByEmployee(vacations = [], dateKeys = []) {
  const dateKeySet = new Set(dateKeys);
  const byEmployee = new Map();

  vacations.forEach((vacation) => {
    const employeeId = vacation.employee?.toString?.() || String(vacation.employee || "");
    const startKey = String(vacation.startDateKey || "").trim();
    const endKey = String(vacation.endDateKey || "").trim();

    if (!employeeId || !startKey || !endKey) return;
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, new Set());

    const employeeDates = byEmployee.get(employeeId);

    dateKeySet.forEach((dateKey) => {
      if (dateKey >= startKey && dateKey <= endKey) {
        employeeDates.add(dateKey);
      }
    });
  });

  return byEmployee;
}

function buildAutoExceptionSignature(payload) {
  return [
    payload.employee?.toString?.() || "",
    payload.type,
    payload.scope,
    payload.destination || "",
    payload.plannedStartTime || "",
    payload.plannedLunchStartTime || "",
    payload.plannedLunchEndTime || "",
    payload.plannedEndTime || "",
    Number(payload.plannedLunchDurationMinutes) || 0,
    payload.attendanceMode || "",
    payload.payMode || "",
    payload.countsAsWorkedTime ? "worked" : "not_worked",
    payload.allowSupplementaryTime ? "supplementary" : "regular",
    payload.notes || "",
  ].join("|");
}

function buildGroupedAutoExceptionOperations(candidates = []) {
  const groupsByEmployeeSignature = new Map();

  candidates.forEach((candidate) => {
    const payload = candidate?.payload;

    if (!payload?.employee || !payload.dateKey) return;

    const key = buildAutoExceptionSignature(payload);

    if (!groupsByEmployeeSignature.has(key)) {
      groupsByEmployeeSignature.set(key, []);
    }

    groupsByEmployeeSignature.get(key).push(payload);
  });

  const operations = [];

  groupsByEmployeeSignature.forEach((payloads) => {
    const orderedPayloads = [...payloads].sort((left, right) =>
      String(left.dateKey).localeCompare(String(right.dateKey)),
    );
    const ranges = [];

    orderedPayloads.forEach((payload) => {
      const currentRange = ranges.at(-1);

      if (!currentRange || payload.dateKey !== addDaysToDateKey(currentRange.endDateKey, 1)) {
        ranges.push({
          startPayload: payload,
          endDateKey: payload.dateKey,
        });
        return;
      }

      currentRange.endDateKey = payload.dateKey;
    });

    ranges.forEach((range) => {
      const isDateRange = range.endDateKey !== range.startPayload.dateKey;
      const payload = {
        ...range.startPayload,
        scope: isDateRange ? "date_range" : range.startPayload.scope,
        endDate: isDateRange ? new Date(`${range.endDateKey}T12:00:00.000Z`) : null,
        endDateKey: isDateRange ? range.endDateKey : "",
      };

      operations.push({
        updateOne: {
          filter: {
            employee: payload.employee,
            dateKey: payload.dateKey,
            registeredBy: "IMPORTACION HORARIOS",
            status: { $ne: "void" },
          },
          update: { $set: payload },
          upsert: true,
        },
      });
    });
  });

  return operations;
}

function employeeCanUseTemplate(employee, template) {
  const employeeRoleCode = String(employee?.roleCode || "").trim();
  const templateRoleCode = String(template?.roleCode || "").trim();

  if (!templateRoleCode) {
    return true;
  }

  if (employeeRoleCode === templateRoleCode) {
    return true;
  }

  return (employee?.roleAssignments || []).some((assignment) =>
    String(assignment?.code || "").trim() === templateRoleCode,
  );
}

function mergeAssignmentsByEmployee(assignments, requestedMonthKey) {
  const grouped = new Map();

  assignments.forEach((assignment) => {
    const employeeId = assignment.employee?.toString?.() || "";

    if (!employeeId) return;
    if (!grouped.has(employeeId)) grouped.set(employeeId, []);
    grouped.get(employeeId).push(assignment);
  });

  return [...grouped.values()].map((employeeAssignments) => {
    const primary =
      employeeAssignments.find((assignment) => assignment.monthKey === requestedMonthKey)
      || employeeAssignments[0];
    const generatedDaysByDate = new Map();
    const scheduleHistory = [];
    const planningApprovals = [];

    employeeAssignments
      .sort((left, right) => String(left.monthKey || "").localeCompare(String(right.monthKey || "")))
      .forEach((assignment) => {
        (assignment.generatedDays || []).forEach((day) => {
          if (day?.dateKey) generatedDaysByDate.set(day.dateKey, day);
        });
        scheduleHistory.push(...(assignment.scheduleHistory || []));
        planningApprovals.push(...(assignment.planningApprovals || []));
      });

    return {
      ...primary,
      monthKey: requestedMonthKey || primary.monthKey,
      generatedDays: [...generatedDaysByDate.values()]
        .sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey))),
      scheduleHistory,
      planningApprovals,
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

function buildFixedRoleAssignments({ employees = [], rolesByCode = new Map(), templatesById = new Map(), monthKeys = [], holidays = [] }) {
  const holidaysByMonth = new Map();
  const assignments = [];

  holidays.forEach((holiday) => {
    const key = String(holiday.dateKey || "").slice(0, 7);

    if (!holidaysByMonth.has(key)) {
      holidaysByMonth.set(key, []);
    }

    holidaysByMonth.get(key).push(holiday);
  });

  employees.forEach((employee) => {
    const role = rolesByCode.get(String(employee.roleCode || "").trim().toUpperCase());
    const template = buildRoleScheduleTemplate(role, templatesById);

    if (!template) {
      return;
    }

    monthKeys.forEach((assignmentMonthKey) => {
      assignments.push(buildAssignmentPayload({
        employee,
        template,
        monthKey: assignmentMonthKey,
        holidays: holidaysByMonth.get(assignmentMonthKey) || [],
        notes: "Horario fijo generado desde configuracion por cargo.",
        weekdaysOnly: true,
      }));
    });
  });

  return assignments;
}

export async function GET(request) {
  try {
    await connectToDatabase();
    const plannerScope = await resolvePlannerEmployeeScope();

    if (!plannerScope.isAuthenticated) {
      return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
    }

    if (
      !hasAccessPermission(plannerScope.user, "planner.schedules.weekly.view")
      && !hasAccessPermission(plannerScope.user, "planner.schedules.view")
    ) {
      return NextResponse.json({ error: "No tienes permiso para ver la planificación semanal." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const { monthKey } = parseMonthKey(searchParams.get("month"));
    const branchCode = String(searchParams.get("branchCode") || "").trim().toUpperCase();
    const areaCode = String(searchParams.get("areaCode") || "").trim();
    const roleCode = String(searchParams.get("roleCode") || "").trim();
    const employeeId = String(searchParams.get("employeeId") || "").trim();
    const employeeIds = normalizeEmployeeIdList(searchParams.get("employeeIds"));
    const groupId = normalizeGroupId(searchParams.get("groupId"));
    const weekStartKey = String(searchParams.get("weekStartKey") || "").trim();
    const includeOverlays = searchParams.get("includeOverlays") === "true";
    const weekDateKeySet = getWeekDateKeySet(weekStartKey);
    const weekDateKeys = weekDateKeySet ? [...weekDateKeySet].sort() : [];
    const monthKeys = getWeekMonthKeys(weekStartKey);
    const targetMonthKeys = monthKeys.length ? monthKeys : [getPreviousMonthKey(monthKey), monthKey, getNextMonthKey(monthKey)];
    const query = { monthKey: { $in: targetMonthKeys } };

    if (branchCode) {
      query.branchCode = branchCode;
    }

    if (areaCode) {
      query.areaCode = areaCode;
    }

    if (roleCode) {
      query.roleCode = roleCode;
    }

    if (employeeId) {
      assertEmployeesInPlannerScope([employeeId], plannerScope);
      query.employee = employeeId;
    } else if (employeeIds.length) {
      assertEmployeesInPlannerScope(employeeIds, plannerScope);
      query.employee = { $in: employeeIds };
    }

    if (!employeeId && !employeeIds.length) {
      applyPlannerScopeToAssignmentQuery(query, plannerScope);
    }

    if (groupId) {
      assertWorkGroupInPlannerScope(groupId, plannerScope);
      const workGroup = await PlanningWorkGroup.findById(groupId).lean();
      assertEmployeesBelongToGroup(employeeId ? [employeeId] : employeeIds, workGroup);
    }

    const exceptionOverlayQuery = weekDateKeys.length ? {
      status: { $ne: "void" },
      $or: [
        { dateKey: { $in: weekDateKeys } },
        { dateKey: { $lte: weekDateKeys.at(-1) }, endDateKey: { $gte: weekDateKeys[0] } },
      ],
    } : null;
    const vacationOverlayQuery = weekDateKeys.length ? {
      startDateKey: { $lte: weekDateKeys.at(-1) },
      endDateKey: { $gte: weekDateKeys[0] },
    } : null;

    if (exceptionOverlayQuery) applyPlannerScopeToEmployeeReferenceQuery(exceptionOverlayQuery, plannerScope);
    if (vacationOverlayQuery) applyPlannerScopeToEmployeeReferenceQuery(vacationOverlayQuery, plannerScope);
    if (employeeIds.length) {
      if (exceptionOverlayQuery) exceptionOverlayQuery.employee = { $in: employeeIds };
      if (vacationOverlayQuery) vacationOverlayQuery.employee = { $in: employeeIds };
    }

    const [assignments, roles, exceptionOverlays, vacationOverlays, holidayOverlays] = await Promise.all([
      findScheduleAssignmentsForWeek(query, weekStartKey, groupId),
      Role.find({}).select({
        code: 1,
        name: 1,
        areaCode: 1,
        areaName: 1,
        scheduleMode: 1,
        fixedScheduleTemplate: 1,
        fixedScheduleTemplateName: 1,
        fixedScheduleAreaCode: 1,
        fixedScheduleAreaName: 1,
        fixedScheduleRoleCode: 1,
        fixedScheduleRoleName: 1,
        fixedScheduleRotationGroup: 1,
        fixedScheduleWeeklyRows: 1,
      }).lean(),
      includeOverlays && exceptionOverlayQuery
        ? OperationalException.find(exceptionOverlayQuery).sort({ dateKey: 1, employeeName: 1 }).lean()
        : [],
      includeOverlays && vacationOverlayQuery
        ? VacationRequest.find(vacationOverlayQuery).sort({ startDateKey: 1, employeeName: 1 }).lean()
        : [],
      includeOverlays && weekDateKeys.length
        ? Holiday.find({ dateKey: { $in: weekDateKeys } }).sort({ dateKey: 1 }).lean()
        : [],
    ]);
    const rolesByCode = new Map(
      roles.map((role) => [String(role.code || "").trim().toUpperCase(), role]),
    );
    const fixedTemplateIds = [
      ...new Set(
        roles
          .filter((role) => role.scheduleMode === "fixed" && role.fixedScheduleTemplate)
          .map((role) => role.fixedScheduleTemplate.toString()),
      ),
    ];
    const fixedEmployeeQuery = buildEmployeeActiveInMonthQuery(monthKey);

    if (branchCode) {
      fixedEmployeeQuery.branchCode = branchCode;
    }

    if (areaCode) {
      fixedEmployeeQuery.areaCode = areaCode;
    }

    if (roleCode) {
      fixedEmployeeQuery.roleCode = roleCode;
    }

    if (employeeId) {
      fixedEmployeeQuery._id = employeeId;
    } else if (employeeIds.length) {
      fixedEmployeeQuery._id = { $in: employeeIds };
    }

    if (!employeeId && !employeeIds.length) {
      applyPlannerScopeToEmployeeQuery(fixedEmployeeQuery, plannerScope);
    }

    const [fixedEmployees, fixedTemplates, fixedHolidays] = await Promise.all([
      Employee.find(fixedEmployeeQuery).select({
        fullName: 1,
        dni: 1,
        branchCode: 1,
        branchName: 1,
        branch: 1,
        areaCode: 1,
        areaName: 1,
        roleCode: 1,
        roleName: 1,
      }).lean(),
      fixedTemplateIds.length
        ? BaseScheduleTemplate.find({ _id: { $in: fixedTemplateIds }, isActive: { $ne: false } }).lean()
        : [],
      Holiday.find({ dateKey: { $regex: `^(${targetMonthKeys.join("|")})` } }).lean(),
    ]);
    const templatesById = new Map(fixedTemplates.map((template) => [template._id.toString(), template]));
    const fixedAssignments = buildFixedRoleAssignments({
      employees: fixedEmployees,
      rolesByCode,
      templatesById,
      monthKeys: targetMonthKeys,
      holidays: fixedHolidays,
    });
    const fixedEmployeeIds = new Set(
      fixedAssignments.map((assignment) => assignment.employee?.toString?.() || "").filter(Boolean),
    );
    const variableAssignments = assignments.filter((assignment) =>
      !fixedEmployeeIds.has(assignment.employee?.toString?.() || ""),
    );

    return NextResponse.json({
      assignments: mergeAssignmentsByEmployee([...fixedAssignments, ...variableAssignments], monthKey)
        .map((assignment) => serializeScheduleAssignmentForWeek(assignment, weekStartKey, groupId)),
      overlays: includeOverlays ? {
        exceptions: exceptionOverlays.map(serializeOperationalException),
        vacations: vacationOverlays.map(serializeVacationRecord),
        holidays: holidayOverlays.map(serializeHoliday),
      } : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron cargar las asignaciones." },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  try {
    await connectToDatabase();
    const plannerScope = await resolvePlannerEmployeeScope();

    if (!plannerScope.isAuthenticated) {
      return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
    }

    const body = await request.json();
    const { monthKey } = parseMonthKey(body?.monthKey);
    const action = String(body?.action || "").trim();

    if (
      action !== "approve-week"
      && !hasAccessPermission(plannerScope.user, "planner.schedules.manage")
    ) {
      return NextResponse.json({ error: "No tienes permiso para modificar horarios." }, { status: 403 });
    }

    if (action === "update-day-schedule") {
      const employeeId = String(body?.employeeId || "").trim();
      const templateId = String(body?.templateId || "").trim();
      const dateKey = String(body?.dateKey || "").trim();

      if (!employeeId || !templateId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        throw new Error("Debes seleccionar empleado, fecha y plantilla.");
      }

      if (dateKey.slice(0, 7) !== monthKey) {
        throw new Error("La fecha seleccionada no pertenece al mes del reporte.");
      }

      assertEmployeesInPlannerScope([employeeId], plannerScope);

      const [employee, template, holidays, activeVacation, currentAssignment] = await Promise.all([
        Employee.findById(employeeId).lean(),
        BaseScheduleTemplate.findById(templateId).lean(),
        Holiday.find({ dateKey: { $regex: `^${monthKey}-` } }).lean(),
        VacationRequest.exists({
          employee: employeeId,
          startDateKey: { $lte: dateKey },
          endDateKey: { $gte: dateKey },
        }),
        ScheduleAssignment.findOne({ monthKey, employee: employeeId }).lean(),
      ]);

      if (!employee) {
        throw new Error("El empleado seleccionado no existe.");
      }

      if (!template || template.isActive === false) {
        throw new Error("La plantilla seleccionada no existe o esta inactiva.");
      }

      if (activeVacation) {
        throw new Error("El empleado tiene vacaciones programadas en esa fecha. Cancela o ajusta las vacaciones antes de modificar el horario.");
      }

      if (!employeeCanUseTemplate(employee, template)) {
        throw new Error("La plantilla seleccionada no corresponde al area o rol del empleado.");
      }

      const generatedTemplateDay = buildGeneratedDays(monthKey, template, holidays)
        .find((day) => day.dateKey === dateKey);
      const templateDay = resolveTemplateOverrideDay(generatedTemplateDay, template, dateKey);

      if (!templateDay) {
        throw new Error("No se pudo generar el horario para la fecha seleccionada.");
      }

      const dayOverride = {
        ...templateDay,
        template: template._id,
        templateName: template.name || "",
        areaCode: employee.areaCode || template.areaCode || "",
        areaName: employee.areaName || template.areaName || "",
        roleCode: template.roleCode || employee.roleCode || "",
        roleName: template.roleName || employee.roleName || "",
        source: "manual_override",
      };
      const existingDaysByDate = new Map(
        (currentAssignment?.generatedDays || []).map((day) => [day.dateKey, day]),
      );

      existingDaysByDate.set(dateKey, dayOverride);

      const generatedDays = [...existingDaysByDate.values()]
        .filter((day) => String(day.dateKey || "").startsWith(`${monthKey}-`))
        .sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey)));

      const assignment = await ScheduleAssignment.findOneAndUpdate(
        { monthKey, employee: employee._id },
        {
          $set: {
            monthKey,
            employee: employee._id,
            employeeName: employee.fullName || "",
            employeeDni: employee.dni || "",
            branchCode: employee.branchCode || "",
            branchName: employee.branchName || employee.branch || "",
            areaCode: employee.areaCode || "",
            areaName: employee.areaName || "",
            roleCode: employee.roleCode || "",
            roleName: employee.roleName || "",
            template: currentAssignment?.template || null,
            templateName: currentAssignment?.templateName || "AJUSTES DESDE REPORTE",
            rotationGroup: currentAssignment?.rotationGroup || "",
            generatedDays,
            weeklyPlan: currentAssignment?.weeklyPlan || [],
            notes: currentAssignment?.notes || "Ajustes puntuales registrados desde reporte de asistencia.",
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();

      return NextResponse.json({
        message: "Horario planificado actualizado correctamente.",
        assignment: serializeScheduleAssignment(assignment),
      });
    }

    if (action === "operational-save") {
      const employeeDays = Array.isArray(body?.employeeDays) ? body.employeeDays : [];
      const weekStartKey = String(body?.weekStartKey || "").trim();
      const groupId = normalizeGroupId(body?.groupId);
      const employeeIds = employeeDays
        .map((entry) => String(entry?.employeeId || "").trim())
        .filter(Boolean);

      if (!groupId) {
        throw new Error("Debes seleccionar un grupo de trabajo para guardar la planificacion.");
      }

      assertWorkGroupInPlannerScope(groupId, plannerScope);

      assertEmployeesInPlannerScope(employeeIds, plannerScope);
      const user = await getAuthenticatedUser();
      const savedBy = String(user?.employeeName || user?.username || user?.id || "SISTEMA").trim();
      const savedByUser = String(user?.id || user?.username || "").trim();

      const clearScheduleTargets = Array.isArray(body?.clearScheduleTargets) ? body.clearScheduleTargets : [];
      const clearScheduleTargetKeys = new Set(clearScheduleTargets
        .map((target) => `${String(target?.employeeId || "").trim()}|${String(target?.dateKey || "").trim()}`)
        .filter((key) => /\|(\d{4}-\d{2}-\d{2})$/.test(key)));
      const submittedDateKeys = [...new Set(employeeDays.flatMap((entry) =>
        (Array.isArray(entry?.days) ? entry.days : [])
          .map((day) => String(day?.dateKey || "").trim())
          .filter((dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey)),
      ))].sort();
      const targetMonthKeys = [...new Set([monthKey, ...submittedDateKeys.map((dateKey) => dateKey.slice(0, 7))])];
      const employeeQuery = { _id: { $in: employeeIds } };

      applyPlannerScopeToEmployeeQuery(employeeQuery, plannerScope);

      const exceptionDateConditions = submittedDateKeys.flatMap((dateKey) => [
        { dateKey },
        {
          dateKey: { $lte: dateKey },
          endDateKey: { $gte: dateKey },
        },
      ]);
      const [employees, holidays, vacations, currentAssignments, workGroup, existingExceptions] = await Promise.all([
        Employee.find(employeeQuery).lean(),
        Holiday.find({ dateKey: { $in: submittedDateKeys } }).lean(),
        VacationRequest.find({
          employee: { $in: employeeIds },
          startDateKey: { $lte: submittedDateKeys.at(-1) || "" },
          endDateKey: { $gte: submittedDateKeys[0] || "" },
        }).lean(),
        ScheduleAssignment.find({ monthKey: { $in: targetMonthKeys }, employee: { $in: employeeIds } }).lean(),
        PlanningWorkGroup.findById(groupId).lean(),
        exceptionDateConditions.length
          ? OperationalException.find({
            employee: { $in: employeeIds },
            status: { $ne: "void" },
            $or: exceptionDateConditions,
          }).lean()
          : [],
      ]);
      assertEmployeesBelongToGroup(employeeIds, workGroup);
      const groupName = String(workGroup?.name || "").trim().toUpperCase();
      const employeesById = new Map(employees.map((employee) => [employee._id.toString(), employee]));
      const currentByEmployee = new Map(
        currentAssignments.map((assignment) => [
          `${assignment.monthKey}|${assignment.employee?.toString?.() || ""}`,
          assignment,
        ]),
      );
      const holidayNamesByDate = new Map(holidays.map((holiday) => [holiday.dateKey, holiday.name]));
      const operations = [];
      const exceptionOperations = [];
      const autoExceptionCandidates = [];
      const exceptionCleanupKeys = new Set();
      const exceptionSnapshotsByEmployeeDate = buildExceptionSnapshotsByEmployeeDate(
        existingExceptions,
        employeeIds,
        submittedDateKeys,
      );
      const savedEmployeeIds = new Set();
      const savedAt = new Date();
      const vacationDateKeysByEmployee = buildVacationDateKeysByEmployee(vacations, submittedDateKeys);

      employeeDays.forEach((entry) => {
        const employeeId = String(entry?.employeeId || "").trim();
        const employee = employeesById.get(employeeId);

        if (!employee) {
          return;
        }

        const daysByMonth = new Map();

        (Array.isArray(entry?.days) ? entry.days : []).forEach((day) => {
          const dayDateKey = String(day?.dateKey || "").trim();
          const isVacationDate = vacationDateKeysByEmployee.get(employeeId)?.has(dayDateKey) || false;
          const normalized = normalizeOperationalDay(day, holidayNamesByDate, isVacationDate);

          if (normalized && isEmployeeActiveOnDate(employee, normalized.dateKey)) {
            const dayMonthKey = normalized.dateKey.slice(0, 7);
            const autoException = buildAutoExceptionPayload({ employee, day: normalized });
            const clearKey = `${employee._id.toString()}|${normalized.dateKey}`;
            const snapshotKey = buildExceptionSnapshotKey(employee._id.toString(), normalized.dateKey);
            const shouldReplaceScheduleDay = clearScheduleTargetKeys.has(`${employeeId}|${normalized.dateKey}`);
            const shouldClearScheduleDay = shouldReplaceScheduleDay
              && normalized.dayType === "off_day"
              && normalized.operationalJustification !== true;

            if (!daysByMonth.has(dayMonthKey)) daysByMonth.set(dayMonthKey, []);

            if (shouldReplaceScheduleDay) {
              exceptionCleanupKeys.add(clearKey);
            }

            if (autoException) {
              const preservedSnapshots = (exceptionSnapshotsByEmployeeDate.get(snapshotKey) || [])
                .filter((snapshot) => snapshot.registeredBy !== "IMPORTACION HORARIOS");

              exceptionSnapshotsByEmployeeDate.set(snapshotKey, preservedSnapshots);
              addExceptionSnapshot(exceptionSnapshotsByEmployeeDate, employeeId, normalized.dateKey, autoException);
              autoExceptionCandidates.push({ employeeId, dateKey: normalized.dateKey, payload: autoException });
            }

            daysByMonth.get(dayMonthKey).push({
              ...normalized,
              exceptionSnapshot: exceptionSnapshotsByEmployeeDate.get(snapshotKey) || [],
            });
          }
        });

        daysByMonth.forEach((monthDays, targetMonthKey) => {
          savedEmployeeIds.add(employeeId);
          const currentAssignment = currentByEmployee.get(`${targetMonthKey}|${employeeId}`);
          const primaryPlanningDay = monthDays.find((day) => day.areaCode || day.roleCode) || {};
          const existingDaysByDate = new Map(
            (currentAssignment?.generatedDays || []).map((day) => [day.dateKey, day]),
          );

          monthDays.forEach((day) => {
            if (
              clearScheduleTargetKeys.has(`${employeeId}|${day.dateKey}`)
              && day.dayType === "off_day"
              && day.operationalJustification !== true
            ) {
              existingDaysByDate.delete(day.dateKey);
              return;
            }

            existingDaysByDate.set(day.dateKey, day);
          });

          const generatedDays = [...existingDaysByDate.values()]
            .filter((day) => String(day.dateKey || "").startsWith(`${targetMonthKey}-`))
            .sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey)));
          const historyEntry = {
            groupId,
            groupName,
            weekStartKey,
            savedAt,
            savedBy,
            savedByUser,
            generatedDays,
          };

          operations.push({
            updateOne: {
              filter: { monthKey: targetMonthKey, employee: employee._id },
              update: {
                $set: {
                  monthKey: targetMonthKey,
                  employee: employee._id,
                  employeeName: employee.fullName || "",
                  employeeDni: employee.dni || "",
                  branchCode: employee.branchCode || "",
                  branchName: employee.branchName || employee.branch || "",
                  areaCode: primaryPlanningDay.areaCode || employee.areaCode || "",
                  areaName: primaryPlanningDay.areaName || employee.areaName || "",
                  roleCode: primaryPlanningDay.roleCode || employee.roleCode || "",
                  roleName: primaryPlanningDay.roleName || employee.roleName || "",
                  template: currentAssignment?.template || null,
                  templateName: "PROGRAMACION DE HORARIOS",
                  rotationGroup: "OPERATIVO_VARIABLE",
                  weeklyPlan: [],
                  notes: "Programacion de horarios armada sin plantillas por semana.",
                },
                $push: {
                  scheduleHistory: {
                    $each: [historyEntry],
                  },
                },
                $pull: {
                  planningApprovals: { weekStartKey, groupId },
                },
              },
              upsert: true,
            },
          });
        });
      });

      if (autoExceptionCandidates.length) {
        const importedExceptionDatesByEmployee = new Map();

        autoExceptionCandidates.forEach((candidate) => {
          if (!importedExceptionDatesByEmployee.has(candidate.employeeId)) {
            importedExceptionDatesByEmployee.set(candidate.employeeId, new Set());
          }

          importedExceptionDatesByEmployee.get(candidate.employeeId).add(candidate.dateKey);
        });

        importedExceptionDatesByEmployee.forEach((dateKeys, employeeIdForCleanup) => {
          const employee = employeesById.get(employeeIdForCleanup);

          if (!employee) return;

          const dateConditions = [...dateKeys].flatMap((dateKey) => [
            { dateKey },
            {
              dateKey: { $lte: dateKey },
              endDateKey: { $gte: dateKey },
            },
          ]);

          exceptionOperations.push({
            updateMany: {
              filter: {
                employee: employee._id,
                registeredBy: "IMPORTACION HORARIOS",
                status: { $ne: "void" },
                $or: dateConditions,
              },
              update: {
                $set: {
                  status: "void",
                  resolution: "no_action",
                  resolutionNotes: "Reemplazada por excepcion agrupada desde horarios.",
                },
              },
            },
          });
        });

        exceptionOperations.push(...buildGroupedAutoExceptionOperations(autoExceptionCandidates));
      }

      exceptionCleanupKeys.forEach((key) => {
        const [employeeIdForCleanup, dateKey] = key.split("|");
        const employee = employeesById.get(employeeIdForCleanup);

        if (!employee || !dateKey) return;

        exceptionOperations.unshift({
          updateMany: {
            filter: {
              employee: employee._id,
              status: { $ne: "void" },
              $or: [
                { dateKey },
                {
                  dateKey: { $lte: dateKey },
                  endDateKey: { $gte: dateKey },
                },
              ],
            },
            update: {
              $set: {
                status: "void",
                resolution: "no_action",
                resolutionNotes: "Anulada por limpieza de horarios semanal.",
              },
            },
          },
        });
      });

      if (operations.length) {
        await ScheduleAssignment.bulkWrite(operations);
      }

      // Los efectos derivados se conservan dentro de la versión pendiente; guardar no puede
      // crear excepciones ni limpiar registros operativos vigentes antes de su aprobación.

      const assignmentQuery = { monthKey: { $in: targetMonthKeys }, employee: { $in: employeeIds } };

      const assignments = await findScheduleAssignmentsForWeek(assignmentQuery, weekStartKey, groupId);

      await createAuditLog({
        actor: savedBy,
        action: "planningSchedule.version.create",
        entityType: "planningWorkGroup",
        entityId: groupId,
        entityLabel: `${groupName} ${weekStartKey}`,
        route: "/api/planner/planning/schedule-assignments",
        details: {
          weekStartKey,
          groupId,
          groupName,
          savedAt,
          savedByUser,
          employeeIds: [...savedEmployeeIds],
          status: "pending_approval",
        },
      });

      return NextResponse.json({
        message: `Programacion de horarios guardada para ${savedEmployeeIds.size} empleados.`,
        assignments: mergeAssignmentsByEmployee(assignments, monthKey)
          .map((assignment) => serializeScheduleAssignmentForWeek(assignment, weekStartKey, groupId)),
      });
    }

    if (action === "approve-week") {
      const weekStartKey = String(body?.weekStartKey || "").trim();
      const groupId = normalizeGroupId(body?.groupId);
      const employeeIds = (Array.isArray(body?.employeeIds) ? body.employeeIds : [])
        .map((employeeId) => String(employeeId || "").trim())
        .filter(Boolean);

      if (!groupId) {
        throw new Error("Debes seleccionar un grupo de trabajo para aprobar la planificacion.");
      }

      assertWorkGroupInPlannerScope(groupId, plannerScope);
      const approvalUser = await getAuthenticatedUser();

      if (!hasAccessPermission(approvalUser, "planner.updates.manage")) {
        return NextResponse.json(
          { error: "Solo el Administrador o el Encargado de nómina puede aprobar la planificación." },
          { status: 403 },
        );
      }

      if (!weekStartKey || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartKey)) {
        throw new Error("Debes indicar la semana a aprobar.");
      }

      if (!employeeIds.length) {
        throw new Error("No hay empleados para aprobar.");
      }

      assertEmployeesInPlannerScope(employeeIds, plannerScope);

      const employeeQuery = { _id: { $in: employeeIds } };

      applyPlannerScopeToEmployeeQuery(employeeQuery, plannerScope);

      const [employees, workGroup] = await Promise.all([
        Employee.find(employeeQuery).lean(),
        PlanningWorkGroup.findById(groupId).lean(),
      ]);
      const user = approvalUser;
      assertEmployeesBelongToGroup(employeeIds, workGroup);
      const groupName = String(workGroup?.name || "").trim().toUpperCase();
      const approvedBy = String(user?.employeeName || user?.username || user?.id || "SISTEMA").trim();
      const approvedByUser = String(user?.id || user?.username || "").trim();
      const approvedAt = new Date();
      const employeeObjectIds = employees.map((employee) => employee._id);
      const assignmentMonthKeys = getWeekMonthKeys(weekStartKey);
      const targetMonthKeys = assignmentMonthKeys.length
        ? assignmentMonthKeys
        : [getPreviousMonthKey(monthKey), monthKey, getNextMonthKey(monthKey)];
      const assignmentsForApproval = await ScheduleAssignment.find({
        monthKey: { $in: targetMonthKeys },
        employee: { $in: employeeObjectIds },
      }).lean();
      const requestedVersion = {
        groupId,
        weekStartKey,
        savedAt: body?.versionSavedAt || body?.savedAt,
        savedBy: body?.versionSavedBy || body?.savedBy,
        savedByUser: body?.versionSavedByUser || body?.savedByUser,
      };
      const targetVersion = requestedVersion.savedAt
        ? requestedVersion
        : getLatestHistoryVersion(assignmentsForApproval, weekStartKey, groupId);
      const historyMatch = buildHistoryMatchFromVersion(targetVersion, groupId);

      if (!historyMatch) {
        throw new Error("No hay una version guardada para aprobar.");
      }

      const approvedVersionSavedAt = new Date(targetVersion.savedAt || targetVersion.versionSavedAt);
      const approvedVersionSavedBy = String(targetVersion.savedBy || targetVersion.versionSavedBy || "").trim();
      const approvedVersionSavedByUser = String(targetVersion.savedByUser || targetVersion.versionSavedByUser || "").trim();
      const matchingVersionCount = assignmentsForApproval.filter((assignment) =>
        (assignment.scheduleHistory || []).some((entry) =>
          buildHistoryVersionKey(entry) === buildHistoryVersionKey({
            groupId,
            savedAt: approvedVersionSavedAt,
            savedBy: approvedVersionSavedBy,
            savedByUser: approvedVersionSavedByUser,
          }) && entry.weekStartKey === weekStartKey && normalizeGroupId(entry.groupId) === groupId,
        ),
      ).length;

      if (!matchingVersionCount) {
        throw new Error("La version seleccionada ya no existe en el historial.");
      }

      const approvedVersionKey = buildHistoryVersionKey({
        groupId,
        savedAt: approvedVersionSavedAt,
        savedBy: approvedVersionSavedBy,
        savedByUser: approvedVersionSavedByUser,
      });
      const assignmentsWithMatchingHistory = assignmentsForApproval.filter((assignment) =>
        (assignment.scheduleHistory || []).some((entry) =>
          entry.weekStartKey === weekStartKey
          && normalizeGroupId(entry.groupId) === groupId
          && buildHistoryVersionKey(entry) === approvedVersionKey,
        ),
      );
      const isAlreadyApproved = assignmentsWithMatchingHistory.length > 0
        && assignmentsWithMatchingHistory.every((assignment) =>
          (assignment.planningApprovals || []).some((approval) =>
            approval.weekStartKey === weekStartKey
            && normalizeGroupId(approval.groupId) === groupId
            && buildHistoryVersionKey({
              groupId: approval.groupId,
              savedAt: approval.versionSavedAt,
              savedBy: approval.versionSavedBy,
              savedByUser: approval.versionSavedByUser,
            }) === approvedVersionKey,
          ),
        );

      if (isAlreadyApproved) {
        return NextResponse.json(
          { error: "Esta version ya fue aprobada. Guarda una nueva version para volver a aprobar." },
          { status: 409 },
        );
      }

      await ScheduleAssignment.updateMany(
        { monthKey: { $in: targetMonthKeys }, employee: { $in: employeeObjectIds } },
        { $pull: { planningApprovals: { weekStartKey, groupId } } },
      );
      const weekDateKeys = getWeekDateKeySet(weekStartKey);
      const approvalOperations = assignmentsForApproval.flatMap((assignment) => {
        const matchingHistory = (assignment.scheduleHistory || []).find((entry) =>
          buildHistoryVersionKey(entry) === buildHistoryVersionKey({
            groupId,
            savedAt: approvedVersionSavedAt,
            savedBy: approvedVersionSavedBy,
            savedByUser: approvedVersionSavedByUser,
          }) && entry.weekStartKey === weekStartKey && normalizeGroupId(entry.groupId) === groupId,
        );

        if (!matchingHistory || !weekDateKeys) return [];

        const operationalDaysByDate = new Map(
          (assignment.generatedDays || [])
            .filter((day) => !weekDateKeys.has(day.dateKey))
            .map((day) => [day.dateKey, day]),
        );

        (matchingHistory.generatedDays || [])
          .filter((day) => weekDateKeys.has(day.dateKey))
          .forEach((day) => operationalDaysByDate.set(day.dateKey, day));

        return [{
          updateOne: {
            filter: { _id: assignment._id },
            update: {
              $set: {
                generatedDays: [...operationalDaysByDate.values()]
                  .sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey))),
              },
              $push: {
                planningApprovals: {
                  groupId,
                  groupName,
                  weekStartKey,
                  approvedAt,
                  approvedBy,
                  approvedByUser,
                  versionSavedAt: approvedVersionSavedAt,
                  versionSavedBy: approvedVersionSavedBy,
                  versionSavedByUser: approvedVersionSavedByUser,
                },
              },
            },
          },
        }];
      });

      if (approvalOperations.length) {
        await ScheduleAssignment.bulkWrite(approvalOperations);
      }

      await createAuditLog({
        actor: approvedBy,
        action: "planningSchedule.version.approve",
        entityType: "planningWorkGroup",
        entityId: groupId,
        entityLabel: `${groupName} ${weekStartKey}`,
        route: "/api/planner/planning/schedule-assignments",
        details: {
          weekStartKey,
          groupId,
          groupName,
          approvedAt,
          approvedByUser,
          versionSavedAt: approvedVersionSavedAt,
          versionSavedBy: approvedVersionSavedBy,
          versionSavedByUser: approvedVersionSavedByUser,
          employeeIds,
        },
      });

      const assignmentQuery = { monthKey: { $in: targetMonthKeys }, employee: { $in: employeeObjectIds } };

      const assignments = await ScheduleAssignment.find(assignmentQuery)
        .sort({ employeeName: 1 })
        .lean();

      return NextResponse.json({
        message: `Planificacion aprobada para ${employees.length} empleados.`,
        assignments: mergeAssignmentsByEmployee(assignments, monthKey)
          .map((assignment) => serializeScheduleAssignmentForWeek(assignment, weekStartKey, groupId)),
      });
    }

    if (action === "generate") {
      const branchCode = String(body?.branchCode || "").trim().toUpperCase();
      const areaCode = String(body?.areaCode || "").trim();
      const roleCode = String(body?.roleCode || "").trim();
      const monthStart = new Date(`${monthKey}-01T00:00:00.000Z`);
      const employeeQuery = buildEmployeeActiveInMonthQuery(monthStart);

      if (branchCode) {
        employeeQuery.branchCode = branchCode;
      }

      if (areaCode) {
        employeeQuery.areaCode = areaCode;
      }

      if (roleCode) {
        employeeQuery.roleCode = roleCode;
      }

      applyPlannerScopeToEmployeeQuery(employeeQuery, plannerScope);

      const [employees, roles, templates, holidays, previousAssignments, currentAssignments] = await Promise.all([
        Employee.find(employeeQuery).sort({ branchName: 1, areaName: 1, roleName: 1, fullName: 1 }).lean(),
        Role.find({}).lean(),
        BaseScheduleTemplate.find({ isActive: { $ne: false } }).lean(),
        Holiday.find({ dateKey: { $regex: `^${monthKey}-` } }).lean(),
        ScheduleAssignment.find({ monthKey: getPreviousMonthKey(monthKey) }).lean(),
        ScheduleAssignment.find({ monthKey }).select({ employee: 1 }).lean(),
      ]);
      const rolesByCode = new Map(
        roles.map((role) => [String(role.code || "").trim().toUpperCase(), role]),
      );
      const variableEmployees = employees.filter((employee) =>
        rolesByCode.get(String(employee.roleCode || "").trim().toUpperCase())?.scheduleMode !== "fixed",
      );
      const weekOptions = getMonthWeekOptions(monthKey);
      const previousByEmployee = new Map(
        previousAssignments.map((assignment) => [assignment.employee?.toString?.() || "", assignment]),
      );
      const currentEmployeeIds = new Set(currentAssignments.map((assignment) => assignment.employee?.toString?.() || ""));
      const templatesByRole = templates.reduce((map, template) => {
        const roleCodeForTemplate = String(template.roleCode || "").trim();
        const key = roleCodeForTemplate || "__GLOBAL__";

        if (!map.has(key)) {
          map.set(key, []);
        }

        map.get(key).push(template);
        return map;
      }, new Map());
      const employeesByBranchRole = variableEmployees.reduce((map, employee) => {
        const key = `${employee.branchCode || ""}|${employee.areaCode || ""}|${employee.roleCode || ""}`;

        if (!map.has(key)) {
          map.set(key, []);
        }

        map.get(key).push(employee);
        return map;
      }, new Map());
      const operations = [];
      const skipped = [];

      function hashText(value) {
        return [...String(value || "")].reduce((hash, char) => hash + char.charCodeAt(0), 0);
      }

      for (const [branchRoleKey, roleEmployees] of employeesByBranchRole.entries()) {
        const [, , roleCodeForGroup = ""] = branchRoleKey.split("|");
        const roleTemplates = sortTemplatesByVariant([
          ...(templatesByRole.get(roleCodeForGroup) || []),
          ...(templatesByRole.get("__GLOBAL__") || []),
        ]);

        if (!roleTemplates.length) {
          skipped.push(...roleEmployees.map((employee) => employee.fullName));
          continue;
        }

        roleEmployees.forEach((employee, employeeIndex) => {
          if (currentEmployeeIds.has(employee._id.toString())) {
            return;
          }

          const previousPlan = previousByEmployee.get(employee._id.toString())?.weeklyPlan || [];
          const previousLastTemplateId = previousPlan.at(-1)?.template?.toString?.() || "";
          const previousIndex = roleTemplates.findIndex(
            (template) => template._id.toString() === previousLastTemplateId,
          );
          const startOffset = previousIndex >= 0
            ? previousIndex + 1
            : hashText(`${monthKey}|${branchRoleKey}|${employee._id}`) + employeeIndex;
          const weeklyPlan = weekOptions.map((week, weekIndex) => ({
            ...week,
            templateDoc: roleTemplates[(startOffset + weekIndex) % roleTemplates.length],
          }));
          const payload = buildAssignmentPayload({
            employee,
            template: weeklyPlan[0]?.templateDoc,
            monthKey,
            holidays,
            weeklyPlan,
            notes: "Generado automaticamente por rotacion semanal.",
          });

          operations.push({
            updateOne: {
              filter: { monthKey, employee: employee._id },
              update: { $setOnInsert: payload },
              upsert: true,
            },
          });
        });
      }

      if (operations.length) {
        await ScheduleAssignment.bulkWrite(operations);
      }

      const assignmentQuery = { monthKey };

      if (branchCode) {
        assignmentQuery.branchCode = branchCode;
      }

      applyPlannerScopeToAssignmentQuery(assignmentQuery, plannerScope);

      const assignments = await ScheduleAssignment.find(assignmentQuery)
        .sort({ employeeName: 1 })
        .lean();

      return NextResponse.json({
        message: operations.length
          ? `Horarios generados para ${operations.length} empleados.${skipped.length ? ` ${skipped.length} sin plantilla.` : ""}`
          : `No habia empleados pendientes para generar.${skipped.length ? ` ${skipped.length} sin plantilla.` : ""}`,
        assignments: assignments.map(serializeScheduleAssignment),
        skipped,
      });
    }

    const employeeId = String(body?.employeeId || "").trim();
    const weeklyPlanInput = Array.isArray(body?.weeklyPlan) ? body.weeklyPlan : [];
    const templateId = String(body?.templateId || weeklyPlanInput[0]?.templateId || "").trim();

    if (!employeeId || !templateId) {
      throw new Error("Debes seleccionar empleado y plantilla.");
    }

    assertEmployeesInPlannerScope([employeeId], plannerScope);

    const weeklyTemplateIds = weeklyPlanInput
      .map((week) => String(week?.templateId || "").trim())
      .filter(Boolean);
    const [employee, template, holidays, weeklyTemplates] = await Promise.all([
      Employee.findById(employeeId).lean(),
      BaseScheduleTemplate.findById(templateId).lean(),
      Holiday.find({ dateKey: { $regex: `^${monthKey}-` } }).lean(),
      weeklyTemplateIds.length
        ? BaseScheduleTemplate.find({ _id: { $in: weeklyTemplateIds }, isActive: { $ne: false } }).lean()
        : [],
    ]);

    if (!employee) {
      throw new Error("El empleado seleccionado no existe.");
    }

    if (!template) {
      throw new Error("La plantilla seleccionada no existe.");
    }

    const templatesById = new Map(weeklyTemplates.map((item) => [item._id.toString(), item]));
    const weeklyPlan = weeklyPlanInput
      .map((week) => ({
        weekStartKey: String(week?.weekStartKey || "").trim(),
        label: String(week?.label || "").trim(),
        templateDoc: templatesById.get(String(week?.templateId || "").trim()),
      }))
      .filter((week) => week.weekStartKey && week.templateDoc);

    const rotationTemplates = template.rotationGroup
      ? await BaseScheduleTemplate.find({
          roleCode: template.roleCode,
          rotationGroup: template.rotationGroup,
          isActive: true,
        }).lean()
      : [template];

    const payload = buildAssignmentPayload({
      employee,
      template,
      monthKey,
      holidays,
      rotationTemplates,
      weeklyPlan,
      notes: body?.notes,
    });
    const assignment = await ScheduleAssignment.findOneAndUpdate(
      { monthKey, employee: employee._id },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();

    return NextResponse.json({
      message: "Horario asignado correctamente.",
      assignment: serializeScheduleAssignment(assignment),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo guardar la asignacion de horario." },
      { status: 400 },
    );
  }
}
