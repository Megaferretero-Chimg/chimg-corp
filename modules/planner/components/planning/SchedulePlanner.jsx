"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Download, Eye, LockKeyhole, LockOpen, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import AutocompleteSelect from "@/components/ui/AutocompleteSelect";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingModal from "@/components/ui/FloatingModal";
import FloatingNotice from "@/components/ui/FloatingNotice";
import SelectInput from "@/components/ui/SelectInput";
import TextInput from "@/components/ui/TextInput";
import { formatEcuadorDateTimeLabel, formatEcuadorMonthKey, formatTime24 } from "@/lib/datetime/ecuador";
import { dateKeyFromValue, employeeDismissalLabel, isEmployeeActiveOnDate, isEmployeeDismissedInMonth } from "@/modules/company/submodules/people/lib/employees";
import { planningModulePath } from "@/modules/planner/routes";
import { ECUADOR_DAILY_BASE_HOURS } from "@/modules/planner/lib/payroll/laborConstants";
import { calculatePayrollHourlyRate } from "@/modules/planner/lib/payroll/rates";
import { getMonthWeekOptions } from "@/modules/planner/lib/planning/scheduleAssignments";
import styles from "@/modules/planner/styles/components/planning/SchedulePlanner.module.scss";

const SUPPLEMENTARY_SURCHARGE_MULTIPLIER = 0.5;
const EXTRAORDINARY_SURCHARGE_MULTIPLIER = 1;

const OFF_SHIFT_OPTION = {
  key: "off",
  label: "Descanso",
  shortLabel: "Desc.",
  dayType: "off_day",
  startTime: "",
  endTime: "",
  lunchDurationMinutes: 0,
  authorizedExtraMinutes: 0,
};

function buildShiftKey(shift) {
  if (!shift || shift.dayType === "off_day" || shift.dayType === "holiday") {
    return OFF_SHIFT_OPTION.key;
  }

  return [
    "shift",
    "workday",
    shift.startTime || "",
    shift.lunchStartTime || "",
    shift.lunchEndTime || "",
    shift.endTime || "",
    Number(shift.lunchDurationMinutes) || 0,
  ].join("|");
}

function formatClockTime(value) {
  const formattedTime = formatTime24(value);

  return formattedTime ? formattedTime.replace(":", "H") : "";
}

function formatScheduleTextWithH(value) {
  return String(value || "").replace(/\b(\d{1,2}):(\d{2})\b/g, (match) => {
    const formattedTime = formatTime24(match);

    return formattedTime ? formattedTime.replace(":", "H") : match;
  });
}

function formatMinutesAsTime(totalMinutes) {
  const minutes = Math.max(0, Number(totalMinutes) || 0);

  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatHourRange(startTime, endTime) {
  const startLabel = formatClockTime(startTime);
  const endLabel = formatClockTime(endTime);

  if (!startLabel || !endLabel) {
    return "";
  }

  return `${startLabel} A ${endLabel}`;
}

function buildReadableShiftSchedule(shift) {
  if (!shift || shift.dayType === "off_day" || shift.dayType === "holiday") {
    return OFF_SHIFT_OPTION.label;
  }

  const start = parseTimeToMinutes(shift.startTime);
  const end = parseTimeToMinutes(shift.endTime);
  const lunchMinutes = Number(shift.lunchDurationMinutes) || 0;

  if (start === null || end === null || end <= start) {
    return OFF_SHIFT_OPTION.label;
  }

  if (shift.lunchStartTime && shift.lunchEndTime) {
    return `${formatHourRange(shift.startTime, shift.lunchStartTime)} ${formatHourRange(shift.lunchEndTime, shift.endTime)}`;
  }

  if (!lunchMinutes) {
    return formatHourRange(shift.startTime, shift.endTime);
  }

  const preferredLunchStart = parseTimeToMinutes("12:30");
  const lunchStart = Math.min(
    Math.max(preferredLunchStart ?? start, start),
    Math.max(start, end - lunchMinutes),
  );
  const lunchEnd = lunchStart + lunchMinutes;

  if (lunchEnd >= end) {
    return formatHourRange(shift.startTime, shift.endTime);
  }

  return `${formatHourRange(shift.startTime, formatMinutesAsTime(lunchStart))} ${formatHourRange(formatMinutesAsTime(lunchEnd), shift.endTime)}`;
}

function formatShiftLabel(shift) {
  if (!shift || shift.dayType === "off_day" || shift.dayType === "holiday") {
    return OFF_SHIFT_OPTION.label;
  }

  return buildReadableShiftSchedule(shift);
}

function buildShiftOption(shift) {
  const normalized = {
    dayType: shift?.dayType === "off_day" || shift?.dayType === "holiday" ? "off_day" : "workday",
    startTime: shift?.startTime || "",
    lunchStartTime: shift?.lunchStartTime || "",
    lunchEndTime: shift?.lunchEndTime || "",
    endTime: shift?.endTime || "",
    lunchDurationMinutes: Number(shift?.lunchDurationMinutes) || 0,
  };
  return {
    ...normalized,
    authorizedExtraMinutes: 0,
    key: buildShiftKey(normalized),
    label: formatShiftLabel(normalized),
    scheduleLabel: buildReadableShiftSchedule(normalized),
    shortLabel: normalized.startTime && normalized.endTime
      ? buildReadableShiftSchedule(normalized)
      : OFF_SHIFT_OPTION.shortLabel,
  };
}

function setShiftOption(optionsByKey, option) {
  const current = optionsByKey.get(option.key);

  if (!current) {
    optionsByKey.set(option.key, option);
  }
}

const FALLBACK_SHIFT_OPTIONS = [
  OFF_SHIFT_OPTION,
].map(buildShiftOption);

const FALLBACK_SHIFT_BY_KEY = new Map(FALLBACK_SHIFT_OPTIONS.map((shift) => [shift.key, shift]));
const DAY_LABELS = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
const REST_CELL_PATTERN = /^(descanso|desc\.?|off|feriado)$/i;
const RESERVED_SHIFT_KEYS = {
  vacation: "reserved|vacation",
  permission: "reserved|permission",
};
const EXTERNAL_WORK_LABEL = "Trabajo externo";
const HIDDEN_LEGACY_OPERATIONAL_NOTES = new Set(["SALCEDO", "TRABAJO EXTERNO"]);
const RESERVED_SHIFT_OPTIONS = [
  {
    key: RESERVED_SHIFT_KEYS.vacation,
    label: "Vacaciones",
    scheduleLabel: "Vacaciones",
    shortLabel: "Vac.",
    dayType: "vacation",
    startTime: "",
    endTime: "",
    lunchDurationMinutes: 0,
    authorizedExtraMinutes: 0,
  },
  {
    key: RESERVED_SHIFT_KEYS.permission,
    label: "Permiso",
    scheduleLabel: "Permiso",
    shortLabel: "Permiso",
    dayType: "off_day",
    startTime: "",
    endTime: "",
    lunchDurationMinutes: 0,
    authorizedExtraMinutes: 0,
  },
];

function currentMonthKey() {
  return formatEcuadorMonthKey();
}

function shiftMonthKey(monthKey, offset) {
  const [year, month] = String(monthKey || currentMonthKey()).split("-").map(Number);
  const date = new Date(year, (month || 1) - 1 + offset, 1, 12);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey || currentMonthKey()).split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, 1, 12);
  const label = new Intl.DateTimeFormat("es-EC", {
    month: "long",
    year: "numeric",
  }).format(date);

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getPlanningOverlayMonthKeys(monthKey, dateKeys = []) {
  const dateMonthKeys = dateKeys
    .map((dateKey) => String(dateKey || "").slice(0, 7))
    .filter((key) => /^\d{4}-\d{2}$/.test(key));

  if (dateMonthKeys.length) {
    return [...new Set(dateMonthKeys)];
  }

  return [...new Set([
    shiftMonthKey(monthKey, -1),
    monthKey,
    shiftMonthKey(monthKey, 1),
  ].filter((key) => /^\d{4}-\d{2}$/.test(String(key || ""))))];
}

function dedupeById(items) {
  const result = new Map();

  items.forEach((item) => {
    const id = item?.id || item?._id || JSON.stringify(item);

    if (id) {
      result.set(String(id), item);
    }
  });

  return [...result.values()];
}

async function fetchPlanningOverlays(monthKey, dateKeys = []) {
  const overlayPayloads = await Promise.all(getPlanningOverlayMonthKeys(monthKey, dateKeys).map(async (overlayMonthKey) => {
    const [exceptionsResponse, vacationsResponse, holidaysResponse] = await Promise.all([
      fetch(`/api/planner/planning/exceptions?month=${overlayMonthKey}&context=weekly`, { cache: "no-store" }),
      fetch(`/api/planner/planning/vacations?month=${overlayMonthKey}`),
      fetch(`/api/planner/planning/holidays?month=${overlayMonthKey}`),
    ]);
    const [exceptionsPayload, vacationsPayload, holidaysPayload] = await Promise.all([
      exceptionsResponse.json(),
      vacationsResponse.json(),
      holidaysResponse.json(),
    ]);

    if (!exceptionsResponse.ok) throw new Error(exceptionsPayload.error || "No se pudieron cargar las excepciones.");
    if (!vacationsResponse.ok) throw new Error(vacationsPayload.error || "No se pudieron cargar las vacaciones.");
    if (!holidaysResponse.ok) throw new Error(holidaysPayload.error || "No se pudieron cargar los feriados.");

    return {
      exceptions: exceptionsPayload.exceptions || [],
      vacations: vacationsPayload.vacations || [],
      holidays: holidaysPayload.holidays || [],
    };
  }));

  return {
    exceptions: dedupeById(overlayPayloads.flatMap((payload) => payload.exceptions)),
    vacations: dedupeById(overlayPayloads.flatMap((payload) => payload.vacations)),
    holidays: dedupeById(overlayPayloads.flatMap((payload) => payload.holidays)),
  };
}

function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDateDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);

  date.setDate(date.getDate() + days);

  return dateKeyFromDate(date);
}

function getDayOfWeek(dateKey) {
  return new Date(`${dateKey}T12:00:00`).getDay();
}

function getWeekStartKey(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff, 12);

  return dateKeyFromDate(monday);
}

function getWeekDateKeys(weekStartKey) {
  const start = new Date(`${weekStartKey}T12:00:00`);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12);

    return dateKeyFromDate(date);
  });
}

function getHistoryVersionKey(entry) {
  const savedAt = entry?.savedAt || entry?.versionSavedAt
    ? new Date(entry.savedAt || entry.versionSavedAt).toISOString()
    : "sin-fecha";
  const actor = entry?.savedByUser || entry?.versionSavedByUser || entry?.savedBy || entry?.versionSavedBy || "sistema";
  const entryGroupId = entry?.groupId || "";

  return `${entryGroupId}|${savedAt}|${actor}`;
}

function isActivePlanningApproval(approval) {
  return Boolean(approval) && !approval.unlockedAt;
}

function mergeHistoryDays(currentDays = [], nextDays = []) {
  return [...new Map(
    [...currentDays, ...nextDays]
      .filter((day) => day?.dateKey)
      .map((day) => [day.dateKey, day]),
  ).values()].sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey)));
}

function buildWeeklyApprovalState(assignments, employeeCount, weekStartKey) {
  const employeeAssignments = assignments.filter((assignment) =>
    (assignment.scheduleHistory || []).some((entry) => entry.weekStartKey === weekStartKey)
    || (assignment.planningApprovals || []).some((approval) => approval.weekStartKey === weekStartKey),
  );
  const approvedAssignments = employeeAssignments.filter((assignment) =>
    (assignment.planningApprovals || []).some((approval) =>
      approval.weekStartKey === weekStartKey && isActivePlanningApproval(approval),
    ),
  );
  const historyVersionsByKey = new Map();
  const approvalCountsByVersionKey = new Map();
  const historicalApprovalCountsByVersionKey = new Map();

  employeeAssignments.forEach((assignment) => {
    const approvedVersionKeysForEmployee = new Set();
    const historicalApprovalVersionKeysForEmployee = new Set();
    const historyVersionKeysForEmployee = new Set();
    const employeeId = assignment.employeeId || "";

    (assignment.planningApprovals || [])
      .filter((approval) => approval.weekStartKey === weekStartKey)
      .forEach((approval) => {
        const approvalVersionKey = approval.versionSavedAt
          ? getHistoryVersionKey({
            groupId: approval.groupId,
            savedAt: approval.versionSavedAt,
            savedBy: approval.versionSavedBy,
            savedByUser: approval.versionSavedByUser,
          })
          : "legacy";

        historicalApprovalVersionKeysForEmployee.add(approvalVersionKey);

        if (isActivePlanningApproval(approval)) {
          approvedVersionKeysForEmployee.add(approvalVersionKey);
        }
      });

    approvedVersionKeysForEmployee.forEach((approvalVersionKey) => {
      approvalCountsByVersionKey.set(approvalVersionKey, (approvalCountsByVersionKey.get(approvalVersionKey) || 0) + 1);
    });
    historicalApprovalVersionKeysForEmployee.forEach((approvalVersionKey) => {
      historicalApprovalCountsByVersionKey.set(
        approvalVersionKey,
        (historicalApprovalCountsByVersionKey.get(approvalVersionKey) || 0) + 1,
      );
    });

    (assignment.scheduleHistory || [])
      .filter((entry) => entry.weekStartKey === weekStartKey)
      .forEach((entry) => {
        const versionKey = getHistoryVersionKey(entry);
        const current = historyVersionsByKey.get(versionKey);

        if (historyVersionKeysForEmployee.has(versionKey)) {
          if (current) {
            current.daysCount += Number(entry.daysCount) || 0;
            current.employeeDays[employeeId] = mergeHistoryDays(
              current.employeeDays[employeeId],
              entry.generatedDays,
            );
          }
          return;
        }

        historyVersionKeysForEmployee.add(versionKey);

        if (current) {
          current.employeeCount += 1;
          current.daysCount += Number(entry.daysCount) || 0;
          current.employeeDays[employeeId] = mergeHistoryDays(
            current.employeeDays[employeeId],
            entry.generatedDays,
          );
          return;
        }

        historyVersionsByKey.set(versionKey, {
          ...entry,
          versionKey,
          employeeCount: 1,
          daysCount: Number(entry.daysCount) || 0,
          approvedCount: 0,
          isApproved: false,
          employeeDays: {
            [employeeId]: mergeHistoryDays([], entry.generatedDays),
          },
        });
      });
  });

  const historyEntries = [...historyVersionsByKey.values()]
    .map((entry) => {
      const approvedCount = approvalCountsByVersionKey.get(entry.versionKey) || 0;
      const historicalApprovalCount = historicalApprovalCountsByVersionKey.get(entry.versionKey) || 0;

      return {
        ...entry,
        approvedCount,
        isApproved: Boolean(entry.employeeCount) && approvedCount >= entry.employeeCount,
        wasApproved: Boolean(entry.employeeCount) && historicalApprovalCount >= entry.employeeCount,
      };
    })
    .sort((left, right) => new Date(right.savedAt || 0).getTime() - new Date(left.savedAt || 0).getTime())
    .map((entry, index, entries) => ({
      ...entry,
      versionNumber: entries.length - index,
    }));
  const latestHistory = historyEntries[0] || null;
  const approvedVersion = historyEntries.find((entry) => entry.isApproved) || null;

  return {
    isApproved: Boolean(approvedVersion) || (Boolean(employeeCount) && approvedAssignments.length === employeeCount && !historyEntries.length),
    approvedCount: approvedAssignments.length,
    totalCount: employeeCount,
    historyEntries,
    latestHistory,
    approvedVersion,
  };
}

function isEmployeeActiveForPlanningWeek(employee, weekDateKeys = []) {
  return weekDateKeys.some((dateKey) => isEmployeeActiveOnDate(employee, dateKey));
}

function getDateRangeKeys(startDateKey, endDateKey = startDateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDateKey || ""))) {
    return [];
  }

  const start = new Date(`${startDateKey}T12:00:00`);
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(endDateKey || ""))
    ? new Date(`${endDateKey}T12:00:00`)
    : start;
  const keys = [];

  for (
    let current = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12);
    current.getTime() <= end.getTime();
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1, 12)
  ) {
    keys.push(dateKeyFromDate(current));
  }

  return keys;
}

function formatPlannerDay(dateKey, monthKey) {
  if (dateKey.startsWith(`${monthKey}-`)) {
    return dateKey.slice(8);
  }

  const [, month, day] = dateKey.split("-");

  return `${day}/${month}`;
}

function usesVariableSchedule(employee) {
  return Boolean(
    employee?.branchCode &&
    employee?.areaCode &&
    employee?.roleCode &&
    employee?.roleScheduleMode !== "fixed",
  );
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

function findEmployeeForImport(name, employees) {
  const exactName = String(name || "").trim();

  if (!exactName) {
    return null;
  }

  return employees.find((employee) => String(employee.fullName || "").trim() === exactName) || null;
}

function normalizeTimePart(hours, minutes = "00") {
  return `${String(Number(hours)).padStart(2, "0")}:${String(Number(minutes || 0)).padStart(2, "0")}`;
}

function parseShiftCell(value) {
  const text = String(value || "").replace(/\u00a0/g, " ").trim();
  const normalizedText = normalizeText(text);

  if (!text) {
    return {
      shiftKey: OFF_SHIFT_OPTION.key,
      status: "empty",
      label: OFF_SHIFT_OPTION.label,
    };
  }

  if (normalizedText === "LIBRE" || REST_CELL_PATTERN.test(text)) {
    return {
      shiftKey: OFF_SHIFT_OPTION.key,
      status: "rest",
      label: OFF_SHIFT_OPTION.label,
    };
  }

  if (normalizedText === "VACACIONES") {
    return {
      shiftKey: RESERVED_SHIFT_KEYS.vacation,
      status: "vacation",
      label: "Vacaciones",
    };
  }

  if (normalizedText === "PERMISO") {
    return {
      shiftKey: RESERVED_SHIFT_KEYS.permission,
      status: "permission",
      label: "Permiso",
    };
  }

  const scheduleRangePattern = /(\d{1,2})\s*(?::|h|H)?\s*(\d{2})?\s*(?:-|–|—|a|A)\s*(\d{1,2})\s*(?::|h|H)?\s*(\d{2})?/g;
  const ranges = [...text.matchAll(scheduleRangePattern)];
  const match = ranges[0];

  if (!match) {
    return {
      shiftKey: OFF_SHIFT_OPTION.key,
      status: "note",
      label: text,
    };
  }

  const textWithoutRanges = text.replace(scheduleRangePattern, " ");

  if (normalizeText(textWithoutRanges)) {
    return {
      shiftKey: OFF_SHIFT_OPTION.key,
      status: "note",
      label: text,
    };
  }

  const startTime = normalizeTimePart(match[1], match[2] || "00");
  const firstEndTime = normalizeTimePart(match[3], match[4] || "00");
  const secondRange = ranges[1];
  const secondStartTime = secondRange ? normalizeTimePart(secondRange[1], secondRange[2] || "00") : "";
  const endTime = secondRange ? normalizeTimePart(secondRange[3], secondRange[4] || "00") : firstEndTime;
  const firstEndMinutes = parseTimeToMinutes(firstEndTime);
  const secondStartMinutes = parseTimeToMinutes(secondStartTime);
  const lunchDurationMinutes = firstEndMinutes !== null && secondStartMinutes !== null && secondStartMinutes > firstEndMinutes
    ? secondStartMinutes - firstEndMinutes
    : 0;
  const lunchStartTime = lunchDurationMinutes ? firstEndTime : "";
  const lunchEndTime = lunchDurationMinutes ? secondStartTime : "";

  return {
    shiftKey: buildShiftKey({
      dayType: "workday",
      startTime,
      lunchStartTime,
      lunchEndTime,
      endTime,
      lunchDurationMinutes,
    }),
    status: "shift",
    label: buildReadableShiftSchedule({
      dayType: "workday",
      startTime,
      lunchStartTime,
      lunchEndTime,
      endTime,
      lunchDurationMinutes,
    }),
  };
}

function parseClipboardRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let isQuoted = false;

  for (let index = 0; index < String(text || "").length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === "\"") {
      if (isQuoted && nextCharacter === "\"") {
        cell += "\"";
        index += 1;
      } else {
        isQuoted = !isQuoted;
      }
      continue;
    }

    if (character === "\t" && !isQuoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !isQuoted) {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";

      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      continue;
    }

    cell += character;
  }

  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows.filter((currentRow) => currentRow.some(Boolean));
}

function parseStrictScheduleCell(value, allowedShiftKeys = new Set()) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return {
      rawValue,
      shiftKey: OFF_SHIFT_OPTION.key,
      status: "rest",
      label: OFF_SHIFT_OPTION.label,
    };
  }

  const parsed = parseShiftCell(rawValue);

  if (parsed.status !== "shift" || !allowedShiftKeys.has(parsed.shiftKey)) {
    return {
      rawValue,
      shiftKey: OFF_SHIFT_OPTION.key,
      status: "rest",
      label: OFF_SHIFT_OPTION.label,
    };
  }

  return {
    rawValue,
    ...parsed,
  };
}

function buildClipboardSchedulePreview(text, employees, weekDateKeys, getShiftOptionsForEmployee = () => []) {
  const rows = parseClipboardRows(text);
  const errors = [];
  const warnings = [];
  const seenEmployees = new Set();

  if (!rows.length) {
    return {
      rows: [],
      errors: ["No encontre filas en la tabla pegada."],
      warnings: [],
      stats: { matched: 0, unmatched: 0, shifts: 0, rests: 0, invalid: 0 },
    };
  }

  const parsedRows = rows.map((row, rowIndex) => {
    const sourceName = row[0] || "";
    const employee = findEmployeeForImport(sourceName, employees);
    const allowedShiftKeys = new Set(
      employee ? getShiftOptionsForEmployee(employee).map((shift) => shift.key) : [],
    );

    if (row.length !== 8) {
      errors.push(`Fila ${rowIndex + 1}: debe tener nombre y 7 dias exactos.`);
    }

    if (!sourceName) {
      errors.push(`Fila ${rowIndex + 1}: falta el nombre del empleado.`);
    } else if (!employee) {
      warnings.push(`Fila ${rowIndex + 1}: nombre no idéntico o fuera del grupo (${sourceName}); no se aplicará.`);
    } else if (seenEmployees.has(employee.id)) {
      errors.push(`Fila ${rowIndex + 1}: empleado duplicado (${sourceName}).`);
    } else {
      seenEmployees.add(employee.id);
    }

    const cells = weekDateKeys.map((dateKey, index) => {
      const parsedCell = parseStrictScheduleCell(row[index + 1] || "", allowedShiftKeys);

      if (employee && !isEmployeeActiveOnDate(employee, dateKey) && parsedCell.status === "shift") {
        errors.push(`Fila ${rowIndex + 1}, ${DAY_LABELS[getDayOfWeek(dateKey)]}: no se puede planificar antes del ingreso del empleado.`);
      }

      return {
        dateKey,
        ...parsedCell,
      };
    });

    return {
      sourceName,
      employee,
      cells,
    };
  });
  const stats = parsedRows.reduce((result, row) => {
    if (row.employee) {
      result.matched += 1;
      row.cells.forEach((cell) => {
        if (cell.status === "shift") result.shifts += 1;
        if (cell.status === "rest") result.rests += 1;
        if (cell.status === "invalid") result.invalid += 1;
      });
    } else {
      result.unmatched += 1;
    }

    return result;
  }, { matched: 0, unmatched: 0, shifts: 0, rests: 0, invalid: 0 });

  return { rows: parsedRows, errors, warnings, stats };
}

function dayToShiftKey(day, shiftOptions = FALLBACK_SHIFT_OPTIONS) {
  const operationalNote = normalizeText(day?.operationalNote || "");

  if (operationalNote === "PERMISO") {
    return RESERVED_SHIFT_KEYS.permission;
  }

  if (day?.dayType === "vacation") {
    return RESERVED_SHIFT_KEYS.vacation;
  }

  if (!day || day.dayType === "off_day" || day.dayType === "holiday") {
    return "off";
  }

  const match = shiftOptions.find((shift) =>
    shift.startTime === day.startTime
    && shift.endTime === day.endTime
    && shift.lunchDurationMinutes === (Number(day.lunchDurationMinutes) || 0)
    && (shift.lunchStartTime || "") === (day.lunchStartTime || "")
    && (shift.lunchEndTime || "") === (day.lunchEndTime || "")
  );

  if (match) {
    return match.key;
  }

  return OFF_SHIFT_OPTION.key;
}

function buildDraftDays(assignments, shiftOptions) {
  return Object.fromEntries(
    assignments.map((assignment) => [
      assignment.employeeId,
      Object.fromEntries((assignment.generatedDays || []).map((day) => [day.dateKey, dayToShiftKey(day, shiftOptions)])),
    ]),
  );
}

function buildDraftWeekRoles(assignments, employees, weeks) {
  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));

  return Object.fromEntries(
    assignments.map((assignment) => {
      const employee = employeesById.get(assignment.employeeId);
      const rolesByWeek = {};

      weeks.forEach((week) => {
        const weekDay = (assignment.generatedDays || []).find(
          (day) => getWeekStartKey(day.dateKey) === week.weekStartKey && day.roleCode,
        );

        rolesByWeek[week.weekStartKey] = weekDay?.roleCode || assignment.roleCode || employee?.roleCode || "";
      });

      return [assignment.employeeId, rolesByWeek];
    }),
  );
}

function buildDraftDayRoles(assignments) {
  return Object.fromEntries(
    assignments.map((assignment) => [
      assignment.employeeId,
      Object.fromEntries(
        (assignment.generatedDays || [])
          .filter((day) => day.dateKey && day.roleCode)
          .map((day) => [day.dateKey, day.roleCode]),
      ),
    ]),
  );
}

function buildDraftDayNotes(assignments) {
  return Object.fromEntries(
    assignments.map((assignment) => [
      assignment.employeeId,
      Object.fromEntries(
        (assignment.generatedDays || [])
          .filter((day) => day.dateKey && day.operationalNote)
          .map((day) => [day.dateKey, day.operationalNote]),
      ),
    ]),
  );
}

const PLANNED_ADJUSTMENT_TYPES = [
  {
    value: "permission_partial",
    label: "Permiso por horas",
    type: "permission",
    scope: "partial_day",
    effect: "paid_partial_leave",
    attendanceMode: "ignore_attendance",
    payMode: "regular_only",
    resolution: "approved_work_time",
    requiresTimeRange: true,
    requiresSchedule: false,
  },
  {
    value: "permission_full_day",
    label: "Permiso jornada completa",
    type: "permission",
    scope: "full_day",
    effect: "paid_absence",
    attendanceMode: "ignore_attendance",
    payMode: "regular_only",
    resolution: "paid_leave",
    requiresTimeRange: false,
    requiresSchedule: false,
  },
  {
    value: "outside_work",
    label: "Trabajo externo",
    type: "outside_work",
    scope: "outside_work",
    effect: "external_work",
    attendanceMode: "use_authorized_schedule",
    payMode: "regular_and_extra",
    resolution: "approved_work_time",
    requiresTimeRange: false,
    requiresSchedule: true,
  },
];

const PLANNED_ADJUSTMENT_CATEGORY_OPTIONS = [
  {
    value: "permission",
    label: "Permiso",
  },
  {
    value: "outside_work",
    label: "Trabajo externo",
  },
];

const PERMISSION_DURATION_OPTIONS = [
  {
    value: "permission_partial",
    label: "Por horas",
  },
  {
    value: "permission_full_day",
    label: "Jornada completa",
  },
];

const DEFAULT_ADJUSTMENT_FORM = {
  kind: "permission_partial",
  scheduleTemplateId: "",
  useCustomSchedule: false,
  startTime: "",
  endTime: "",
  plannedStartTime: "",
  plannedLunchStartTime: "",
  plannedLunchEndTime: "",
  plannedEndTime: "",
  notes: "",
};

const DEFAULT_QUICK_TEMPLATE_FORM = {
  startTime: "08:00",
  hasLunch: false,
  lunchStartTime: "",
  lunchEndTime: "",
  endTime: "18:00",
  notes: "",
};

function buildQuickTemplateRow(form) {
  const hasLunch = Boolean(form.hasLunch && form.lunchStartTime && form.lunchEndTime);
  const lunchDurationMinutes = hasLunch
    ? Math.max(0, (parseTimeToMinutes(form.lunchEndTime) || 0) - (parseTimeToMinutes(form.lunchStartTime) || 0))
    : 0;

  return {
    dayOfWeek: 1,
    label: "Horario",
    dayType: "workday",
    startTime: String(form.startTime || "").trim(),
    lunchDurationMinutes,
    lunchStartTime: hasLunch ? String(form.lunchStartTime || "").trim() : "",
    lunchEndTime: hasLunch ? String(form.lunchEndTime || "").trim() : "",
    hasLunch: Boolean(hasLunch && lunchDurationMinutes),
    endTime: String(form.endTime || "").trim(),
    authorizedExtraMinutes: 0,
    graceMinutes: 10,
  };
}

function buildQuickTemplatePayload(form) {
  return {
    name: "",
    roleCode: "",
    roleName: "",
    rotationGroup: "",
    weeklyRows: [buildQuickTemplateRow(form)],
    notes: String(form.notes || "").trim(),
    isActive: true,
  };
}

function buildPlannerUrl(filters, basePath = "/schedules") {
  const params = new URLSearchParams();
  const weekIndex = Number(filters.weekIndex);

  if (filters.monthKey) params.set("month", filters.monthKey);
  if (filters.groupId) params.set("groupId", filters.groupId);
  if (Number.isInteger(weekIndex) && weekIndex > 0) params.set("week", String(weekIndex + 1));

  const query = params.toString();

  return `${planningModulePath(basePath)}${query ? `?${query}` : ""}`;
}

function parseWeekIndex(value) {
  const weekNumber = Number(value);

  if (!Number.isInteger(weekNumber) || weekNumber < 1) {
    return 0;
  }

  return weekNumber - 1;
}

function buildOperationalDay(dateKey, shiftKey, shiftOptionsByKey = FALLBACK_SHIFT_BY_KEY) {
  if (shiftKey === RESERVED_SHIFT_KEYS.vacation) {
    return {
      dateKey,
      dayType: "vacation",
      startTime: "",
      endTime: "",
      lunchDurationMinutes: 0,
      lunchStartTime: "",
      lunchEndTime: "",
      authorizedExtraMinutes: 0,
      operationalNote: "",
      operationalJustification: false,
    };
  }

  if (shiftKey === RESERVED_SHIFT_KEYS.permission) {
    return {
      dateKey,
      dayType: "off_day",
      startTime: "",
      endTime: "",
      lunchDurationMinutes: 0,
      lunchStartTime: "",
      lunchEndTime: "",
      authorizedExtraMinutes: 0,
      operationalNote: "PERMISO",
      operationalJustification: true,
    };
  }

  const shift = shiftOptionsByKey.get(shiftKey) || FALLBACK_SHIFT_BY_KEY.get(shiftKey) || OFF_SHIFT_OPTION;

  return {
    dateKey,
    dayType: shift.dayType,
    startTime: shift.startTime,
    endTime: shift.endTime,
    lunchDurationMinutes: shift.lunchDurationMinutes,
    lunchStartTime: shift.lunchStartTime || "",
    lunchEndTime: shift.lunchEndTime || "",
    authorizedExtraMinutes: 0,
    operationalNote: "",
    operationalJustification: false,
  };
}

function dayFromDraft(dateKey, shiftKey, shiftOptionsByKey = FALLBACK_SHIFT_BY_KEY) {
  return buildOperationalDay(dateKey, shiftKey, shiftOptionsByKey);
}

function buildPlannedScheduleDay(dateKey, schedule = {}) {
  const dayOfWeek = getDayOfWeek(dateKey);
  const startTime = String(schedule.startTime || "").trim();
  const endTime = String(schedule.endTime || "").trim();
  const lunchStartTime = String(schedule.lunchStartTime || "").trim();
  const lunchEndTime = String(schedule.lunchEndTime || "").trim();
  const lunchDurationMinutes = lunchStartTime && lunchEndTime
    ? Math.max(0, (parseTimeToMinutes(lunchEndTime) || 0) - (parseTimeToMinutes(lunchStartTime) || 0))
    : Math.max(0, Number(schedule.lunchDurationMinutes) || 0);

  return {
    dateKey,
    dayType: [0, 6].includes(dayOfWeek) ? "weekend_overtime" : "workday",
    startTime,
    endTime,
    lunchDurationMinutes,
    lunchStartTime,
    lunchEndTime,
    authorizedExtraMinutes: 0,
    operationalNote: "",
    operationalJustification: false,
  };
}

function hasPlannedScheduleFields(schedule = {}) {
  return Boolean(schedule.startTime && schedule.endTime);
}

function resolveTemplateScheduleForDate(template, dateKey) {
  if (!template) return null;

  const dayOfWeek = getDayOfWeek(dateKey);
  const rows = template.weeklyRows || [];
  const row = rows.find((candidate) =>
    candidate.dayOfWeek === dayOfWeek
    && candidate.startTime
    && candidate.endTime
    && !["off_day", "holiday"].includes(candidate.dayType),
  ) || rows.find((candidate) =>
    candidate.startTime
    && candidate.endTime
    && !["off_day", "holiday"].includes(candidate.dayType),
  );

  if (!row) return null;

  return buildPlannedScheduleDay(dateKey, row);
}

function parseTimeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) {
    return null;
  }

  const [hours, minutes] = String(value).split(":").map(Number);

  return hours * 60 + minutes;
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDuration(minutes) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;

  if (!hours) {
    return `${remainingMinutes}m`;
  }

  if (!remainingMinutes) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

function workedNetMinutes(day) {
  const start = parseTimeToMinutes(day?.startTime);
  const end = parseTimeToMinutes(day?.endTime);

  if (start === null || end === null || end <= start) {
    return 0;
  }

  return Math.max(0, end - start - (Number(day?.lunchDurationMinutes) || 0));
}

function estimateWeeklyPlanningCost({
  employee,
  weekDateKeys,
  draftDays,
  shiftOptionsByKey,
  holidayDateKeys = new Set(),
  dailyBaseHours = ECUADOR_DAILY_BASE_HOURS,
  regularWorkdayLimit = 5,
}) {
  const salary = Number(employee?.salary) || 0;
  const hourlyDivisor = Math.max(Number(dailyBaseHours) || ECUADOR_DAILY_BASE_HOURS, 1) * 30;
  const hourlyRate = salary > 0 ? calculatePayrollHourlyRate(salary, hourlyDivisor) : 0;
  const rows = [];
  let workedDays = 0;
  let laborableMinutes = 0;
  let supplementaryMinutes = 0;
  let extraordinaryMinutes = 0;
  let supplementaryAmount = 0;
  let extraordinaryAmount = 0;

  weekDateKeys.forEach((dateKey) => {
    const shiftKey = draftDays[employee.id]?.[dateKey] || "off";
    const shift = shiftOptionsByKey.get(shiftKey) || FALLBACK_SHIFT_BY_KEY.get(shiftKey) || OFF_SHIFT_OPTION;

    if (shift.dayType !== "workday") {
      return;
    }

    const netMinutes = workedNetMinutes(shift);
    const baseMinutes = Math.max((Number(dailyBaseHours) || ECUADOR_DAILY_BASE_HOURS) * 60, 0);

    if (holidayDateKeys.has(dateKey)) {
      const minutes = netMinutes;
      const amount = (minutes / 60) * hourlyRate * EXTRAORDINARY_SURCHARGE_MULTIPLIER;

      extraordinaryMinutes += minutes;
      extraordinaryAmount += amount;
      rows.push({
        dateKey,
        type: "extraordinary",
        minutes,
        amount,
      });
      return;
    }

    workedDays += 1;

    if (workedDays > regularWorkdayLimit) {
      const minutes = netMinutes;
      const amount = (minutes / 60) * hourlyRate * EXTRAORDINARY_SURCHARGE_MULTIPLIER;

      extraordinaryMinutes += minutes;
      extraordinaryAmount += amount;
      rows.push({
        dateKey,
        type: "extraordinary",
        minutes,
        amount,
      });
      return;
    }

    laborableMinutes += Math.min(netMinutes, baseMinutes);

    const minutes = Math.max(0, netMinutes - baseMinutes);

    if (minutes > 0) {
      const amount = (minutes / 60) * hourlyRate * SUPPLEMENTARY_SURCHARGE_MULTIPLIER;

      supplementaryMinutes += minutes;
      supplementaryAmount += amount;
      rows.push({
        dateKey,
        type: "supplementary",
        minutes,
        amount,
      });
    }
  });

  return {
    salary,
    hourlyRate,
    hasSalaryConfigured: salary > 0,
    laborableMinutes,
    supplementaryMinutes,
    extraordinaryMinutes,
    supplementaryAmount,
    extraordinaryAmount,
    totalAmount: supplementaryAmount + extraordinaryAmount,
    rows,
  };
}

function applyWeeklyExtraDays(days, regularWorkdayLimit = 5, dailyBaseMinutes = ECUADOR_DAILY_BASE_HOURS * 60) {
  let workedDays = 0;

  return days.map((day) => {
    if (day.dayType !== "workday") {
      return day;
    }

    workedDays += 1;

    if (workedDays <= regularWorkdayLimit) {
      return {
        ...day,
        authorizedExtraMinutes: Math.max(0, workedNetMinutes(day) - dailyBaseMinutes),
      };
    }

    return {
      ...day,
      dayType: "weekend_overtime",
      authorizedExtraMinutes: workedNetMinutes(day),
    };
  });
}

function isWorkShift(shiftKey) {
  return shiftKey && shiftKey !== "off";
}

function shouldShowDayNote(shiftKey, note) {
  const normalizedNote = normalizeText(note);

  if (!normalizedNote) return false;
  if (HIDDEN_LEGACY_OPERATIONAL_NOTES.has(normalizedNote)) return false;
  if (shiftKey === RESERVED_SHIFT_KEYS.permission && normalizedNote === "PERMISO") return false;

  return true;
}

function cleanImportedNote(note) {
  return String(note || "").replace(/^IMPORTADO DESDE HORARIO:\s*/i, "").trim();
}

function buildPlanningOverlayIndexes({ exceptions = [], vacations = [] }) {
  const byEmployeeDate = new Map();

  vacations.forEach((vacation) => {
    getDateRangeKeys(vacation.startDateKey, vacation.endDateKey).forEach((dateKey) => {
      byEmployeeDate.set(`${vacation.employeeId}|${dateKey}`, {
        id: vacation.id,
        kind: "vacation",
        priority: 2,
        dateKey,
        employeeId: vacation.employeeId,
        title: "Vacaciones",
        shortLabel: "Vacaciones",
        statusLabel: "Programadas",
        typeLabel: "Vacaciones",
        resolutionLabel: "",
        notes: vacation.notes || "",
        raw: vacation,
      });
    });
  });

  exceptions
    .filter((exception) => exception.resolution !== "no_action")
    .forEach((exception) => {
      getDateRangeKeys(exception.dateKey, exception.endDateKey || exception.dateKey).forEach((dateKey) => {
        const key = `${exception.employeeId}|${dateKey}`;
        const current = byEmployeeDate.get(key);

        if (current?.priority > 1) return;

        const importedLabel = cleanImportedNote(exception.notes);
        const isExternalWork = exception.type === "outside_work" || exception.effect === "external_work";
        const shortLabel = isExternalWork
          ? EXTERNAL_WORK_LABEL
          : exception.destination || exception.resolutionNotes || importedLabel || exception.typeLabel || "Excepcion";

        byEmployeeDate.set(key, {
          id: exception.id,
          kind: "exception",
          priority: 1,
          dateKey,
          employeeId: exception.employeeId,
          title: shortLabel,
          shortLabel,
          statusLabel: exception.status === "resolved" ? "Resuelta" : "Pendiente",
          typeLabel: exception.typeLabel || "Excepcion",
          resolutionLabel: exception.resolutionLabel || "",
          notes: exception.notes || "",
          raw: exception,
        });
      });
    });

  return byEmployeeDate;
}

function overlayBlocksScheduleInput(overlay) {
  if (!overlay) return false;
  if (overlay.kind === "vacation") return true;

  const raw = overlay.raw || {};
  const scope = String(raw.scope || "").trim();
  const effect = String(raw.effect || "").trim();
  const attendanceMode = String(raw.attendanceMode || "").trim();
  const payMode = String(raw.payMode || "").trim();

  if (!["full_day", "date_range"].includes(scope)) {
    return false;
  }

  if (["planning_change", "external_work", "manual_punch"].includes(effect)) {
    return false;
  }

  return (
    attendanceMode === "ignore_attendance" ||
    payMode === "discount" ||
    ["paid_absence", "unpaid_absence", "paid_partial_leave"].includes(effect)
  );
}

function overlayPlannedScheduleDay(overlay, dateKey) {
  const raw = overlay?.raw || {};

  if (!raw.plannedStartTime || !raw.plannedEndTime) {
    return null;
  }

  return buildPlannedScheduleDay(dateKey, {
    startTime: raw.plannedStartTime,
    lunchStartTime: raw.plannedLunchStartTime,
    lunchEndTime: raw.plannedLunchEndTime,
    endTime: raw.plannedEndTime,
  });
}

function applyPlanningOverlaysToDraftDays({ draftDays, employees, weekDateKeys, overlaysByEmployeeDate }) {
  const next = {};

  employees.forEach((employee) => {
    const employeeDays = { ...(draftDays[employee.id] || {}) };

    weekDateKeys.forEach((dateKey) => {
      const overlay = overlaysByEmployeeDate.get(`${employee.id}|${dateKey}`);

      if (!isEmployeeActiveOnDate(employee, dateKey)) {
        employeeDays[dateKey] = OFF_SHIFT_OPTION.key;
        return;
      }

      if (!overlay) return;

      if (overlay.kind === "vacation") {
        employeeDays[dateKey] = RESERVED_SHIFT_KEYS.vacation;
        return;
      }

      const plannedDay = overlayPlannedScheduleDay(overlay, dateKey);

      if (plannedDay) {
        employeeDays[dateKey] = buildShiftOption(plannedDay).key;
        return;
      }

      if (overlayBlocksScheduleInput(overlay)) {
        employeeDays[dateKey] = OFF_SHIFT_OPTION.key;
      }
    });

    next[employee.id] = employeeDays;
  });

  return next;
}

function ShiftPicker({ value, options, onChange, disabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const pickerRef = useRef(null);
  const searchInputRef = useRef(null);
  const selectedShift = options.find((shift) => shift.key === value) || options[0] || OFF_SHIFT_OPTION;
  const closePicker = useCallback(() => {
    setIsOpen(false);
    setSearchTerm("");
  }, []);
  const filteredOptions = useMemo(() => {
    const query = normalizeText(searchTerm);

    if (!query) return options;

    return options.filter((shift) =>
      normalizeText(`${shift.scheduleLabel || shift.label || ""} ${shift.shortLabel || ""}`).includes(query),
    );
  }, [options, searchTerm]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function closeOnOutside(event) {
      if (!pickerRef.current?.contains(event.target)) {
        closePicker();
      }
    }

    document.addEventListener("pointerdown", closeOnOutside);

    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [closePicker, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [isOpen]);

  return (
    <div className={styles.shiftPicker} ref={pickerRef}>
      <button
        type="button"
        className={`${styles.shiftPickerButton} ${disabled ? styles.shiftPickerButtonDisabled : ""}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        title={selectedShift.scheduleLabel || selectedShift.label}
        onClick={() => {
          if (disabled) return;

          if (isOpen) {
            closePicker();
            return;
          }

          setIsOpen(true);
        }}
      >
        <span className={styles.shiftPickerValue}>{selectedShift.scheduleLabel || selectedShift.label}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className={styles.shiftPickerMenu} role="listbox">
          <input
            ref={searchInputRef}
            type="search"
            className={styles.shiftPickerSearch}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar horario"
            aria-label="Buscar horario"
          />
          {filteredOptions.map((shift) => (
            <button
              key={shift.key}
              type="button"
              className={`${styles.shiftPickerOption} ${shift.key === selectedShift.key ? styles.shiftPickerOptionActive : ""}`}
              role="option"
              aria-selected={shift.key === selectedShift.key}
              onClick={() => {
                onChange(shift.key);
                closePicker();
              }}
            >
              <span>
                <strong>{shift.scheduleLabel || shift.label}</strong>
              </span>
              {shift.key === selectedShift.key ? <Check size={15} aria-hidden="true" /> : null}
            </button>
          ))}
          {!filteredOptions.length ? (
            <span className={styles.shiftPickerEmpty}>Sin horarios</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatVersionScheduleDay(day) {
  if (!day || day.dayType === "off_day") return "Descanso";
  if (day.dayType === "holiday") return "Feriado";
  if (day.dayType === "vacation") return "Vacaciones";

  return buildReadableShiftSchedule(day) || "Sin horario";
}

function VersionSchedulePreview({ version, employees, weekDateKeys, monthKey, overlaysByEmployeeDate }) {
  const versionEmployeeIds = new Set(Object.keys(version.employeeDays || {}));
  const versionEmployees = employees.filter((employee) => versionEmployeeIds.has(employee.id));

  return (
    <div className={styles.versionCalendarViewer}>
      <div className={styles.versionCalendarMeta}>
        <div>
          <strong>v{version.versionNumber}</strong>
          <span>{formatEcuadorDateTimeLabel(version.savedAt)}</span>
        </div>
        <div>
          <small>Creada por</small>
          <strong>{version.savedBy || "Sistema"}</strong>
        </div>
        {version.isApproved ? <em className={styles.approvedVersionBadge}>Aprobada</em> : null}
        {!version.isApproved && version.wasApproved ? (
          <em className={styles.previouslyApprovedVersionBadge}>Aprobada anteriormente</em>
        ) : null}
      </div>

      <div className={styles.versionCalendarWrap}>
        <table className={styles.versionCalendarTable}>
          <thead>
            <tr>
              <th>Empleado</th>
              {weekDateKeys.map((dateKey) => (
                <th key={dateKey} className={dateKey.startsWith(`${monthKey}-`) ? "" : styles.adjacentMonthDay}>
                  <span>{DAY_LABELS[getDayOfWeek(dateKey)]}</span>
                  <small>{formatPlannerDay(dateKey, monthKey)}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {versionEmployees.map((employee) => {
              const daysByDate = new Map(
                (version.employeeDays?.[employee.id] || []).map((day) => [day.dateKey, day]),
              );

              return (
                <tr key={employee.id}>
                  <td>
                    <strong>{employee.fullName}</strong>
                  </td>
                  {weekDateKeys.map((dateKey) => {
                    const day = daysByDate.get(dateKey);
                    const overlay = overlaysByEmployeeDate.get(`${employee.id}|${dateKey}`);
                    const exception = overlay?.kind === "exception" ? overlay : null;

                    return (
                      <td key={dateKey} className={dateKey.startsWith(`${monthKey}-`) ? "" : styles.adjacentMonthCell}>
                        <div className={styles.versionScheduleCell}>
                          <strong title={formatVersionScheduleDay(day)}>{formatVersionScheduleDay(day)}</strong>
                          {exception ? (
                            <span className={styles.versionExceptionIndicator}>
                              <button
                                type="button"
                                aria-label={`Ver excepcion: ${exception.typeLabel || exception.title || "Excepcion"}`}
                              >
                                <AlertTriangle size={14} aria-hidden="true" />
                              </button>
                              <span className={styles.versionExceptionPopover} role="tooltip">
                                <strong>{exception.typeLabel || exception.title || "Excepcion"}</strong>
                                <span>{exception.statusLabel || "Registrada"}</span>
                                {exception.resolutionLabel ? <span>{exception.resolutionLabel}</span> : null}
                                {exception.notes ? <small>{exception.notes}</small> : null}
                              </span>
                            </span>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!versionEmployees.length ? (
              <tr>
                <td colSpan={weekDateKeys.length + 1} className={styles.versionCalendarEmpty}>
                  No hay empleados registrados en esta version.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlannerLoadingScene({ showFilters = false, title, description }) {
  return (
    <section
      className={`${styles.loadingScene} ${showFilters ? styles.loadingSceneInitial : ""}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={[title, description].filter(Boolean).join(". ")}
    >
      <div className={styles.loadingStage} aria-hidden="true">
        {showFilters ? (
          <div className={styles.loadingStageFilters}>
            {Array.from({ length: 2 }, (_, index) => <span key={index} />)}
          </div>
        ) : null}
        <div className={styles.loadingStageWeeks}>
          {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
        </div>
        <div className={styles.loadingStageActions}>
          {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
        </div>
        <div className={styles.loadingStageMetrics}>
          {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
        </div>
        <div className={styles.loadingStageTable}>
          <div className={styles.loadingStageTableHeader}>
            {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
          </div>
          {Array.from({ length: 4 }, (_, rowIndex) => (
            <div key={rowIndex} className={styles.loadingStageTableRow}>
              {Array.from({ length: 8 }, (_, cellIndex) => <span key={cellIndex} />)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function SchedulePlanner({ initialFilters = {}, basePath = "/schedules", capabilities = {} }) {
  const router = useRouter();
  const [monthKey, setMonthKey] = useState(initialFilters.month || currentMonthKey());
  const [groupId, setGroupId] = useState(initialFilters.groupId || "");
  const [branchCode, setBranchCode] = useState(initialFilters.branchCode || "");
  const [employees, setEmployees] = useState([]);
  const [roles, setRoles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [workGroups, setWorkGroups] = useState([]);
  const [isWorkGroupLocked, setIsWorkGroupLocked] = useState(false);
  const [assignments, setAssignments] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [vacations, setVacations] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [draftDays, setDraftDays] = useState({});
  const [customShiftOptions, setCustomShiftOptions] = useState([]);
  const [draftWeekRoles, setDraftWeekRoles] = useState({});
  const [draftDayRoles, setDraftDayRoles] = useState({});
  const [draftDayNotes, setDraftDayNotes] = useState({});
  const [savedDraftDays, setSavedDraftDays] = useState({});
  const [isManualPasteOpen, setIsManualPasteOpen] = useState(false);
  const [manualClipboardText, setManualClipboardText] = useState("");
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(() => parseWeekIndex(initialFilters.week));
  const [isCostModalOpen, setIsCostModalOpen] = useState(false);
  const [isApprovalConfirmOpen, setIsApprovalConfirmOpen] = useState(false);
  const [isUnlockConfirmOpen, setIsUnlockConfirmOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const [unlockRequest, setUnlockRequest] = useState(null);
  const [viewedVersionKey, setViewedVersionKey] = useState("");
  const [selectedOverlay, setSelectedOverlay] = useState(null);
  const [exceptionToDelete, setExceptionToDelete] = useState(null);
  const [adjustmentTarget, setAdjustmentTarget] = useState(null);
  const [adjustmentForm, setAdjustmentForm] = useState(DEFAULT_ADJUSTMENT_FORM);
  const [isAdjustmentSaving, setIsAdjustmentSaving] = useState(false);
  const adjustmentSaveInFlightRef = useRef(false);
  const [isQuickTemplateModalOpen, setIsQuickTemplateModalOpen] = useState(false);
  const [quickTemplateForm, setQuickTemplateForm] = useState(DEFAULT_QUICK_TEMPLATE_FORM);
  const [isQuickTemplateSaving, setIsQuickTemplateSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAssignmentsLoading, setIsAssignmentsLoading] = useState(false);
  const [isExportingSchedule, setIsExportingSchedule] = useState(false);
  const [loadedAssignmentsKey, setLoadedAssignmentsKey] = useState("");
  const [isPending, startTransition] = useTransition();
  const draftRevisionRef = useRef(0);
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);

  const weekOptions = useMemo(() => getMonthWeekOptions(monthKey), [monthKey]);
  const monthLabel = useMemo(() => formatMonthLabel(monthKey), [monthKey]);
  const maxWeekIndex = Math.max(weekOptions.length - 1, 0);
  const resolvedSelectedWeekIndex = Math.min(Math.max(selectedWeekIndex, 0), maxWeekIndex);
  const selectedWeek = weekOptions[resolvedSelectedWeekIndex] || weekOptions[0];
  const weekDateKeys = useMemo(
    () => (selectedWeek ? getWeekDateKeys(selectedWeek.weekStartKey) : []),
    [selectedWeek],
  );
  const dailyBaseHours = ECUADOR_DAILY_BASE_HOURS;
  const canManageSchedules = capabilities.canManageSchedules === true;
  const canRequestPlanningUnlock = capabilities.canRequestPlanningUnlock === true;
  const canPasteSchedules = capabilities.canPasteSchedules === true;
  const canApprovePlanning = capabilities.canApprovePlanning === true;
  const canExportSchedule = capabilities.canExportSchedule === true;
  const canCreateQuickTemplates = capabilities.canCreateQuickTemplates === true;
  const canCreateAdjustments = capabilities.canCreateAdjustments === true;
  const canDeleteAnyPendingExceptions = capabilities.canDeleteAnyPendingExceptions === true;
  const canOpenMonthlyDetail = capabilities.canOpenMonthlyDetail === true;
  const showSummaries = capabilities.showSummaries === true;
  const showHours = capabilities.showHours === true;
  const showFinancials = capabilities.showFinancials === true;

  const baseShiftOptions = useMemo(() => {
    const optionsByKey = new Map([
      [OFF_SHIFT_OPTION.key, OFF_SHIFT_OPTION],
    ]);

    templates.forEach((template) => {
      (template.weeklyRows || []).forEach((row) => {
        if (!row?.startTime || !row?.endTime || row.dayType === "off_day" || row.dayType === "holiday") return;

        const option = buildShiftOption(row);
        setShiftOption(optionsByKey, option);
      });
    });

    return [...optionsByKey.values()];
  }, [templates]);

  const assignmentShiftOptions = useMemo(() => {
    const optionsByKey = new Map();

    assignments.forEach((assignment) => {
      const assignmentDays = [
        ...(assignment.generatedDays || []),
        ...(assignment.scheduleHistory || []).flatMap((entry) => entry.generatedDays || []),
      ];

      assignmentDays.forEach((day) => {
        if (!day?.startTime || !day?.endTime || day.dayType === "off_day" || day.dayType === "holiday") return;

        const option = buildShiftOption(day);
        setShiftOption(optionsByKey, option);
      });
    });

    return [...optionsByKey.values()];
  }, [assignments]);

  const shiftOptions = useMemo(() => {
    const optionsByKey = new Map();

    [...baseShiftOptions, ...assignmentShiftOptions, ...customShiftOptions].forEach((option) => {
      setShiftOption(optionsByKey, option);
    });

    return [...optionsByKey.values()].sort((left, right) => {
      if (left.key === "off") return -1;
      if (right.key === "off") return 1;
      return `${left.startTime}${left.endTime}${left.lunchDurationMinutes}`.localeCompare(
        `${right.startTime}${right.endTime}${right.lunchDurationMinutes}`,
      );
    });
  }, [assignmentShiftOptions, baseShiftOptions, customShiftOptions]);

  const shiftOptionsByKey = useMemo(
    () => new Map(shiftOptions.map((shift) => [shift.key, shift])),
    [shiftOptions],
  );

  const scheduleTemplateOptions = useMemo(() =>
    templates
      .filter((template) => template.isActive !== false)
      .map((template) => ({
        value: template.id,
        label: formatScheduleTextWithH(template.name) || "Plantilla sin nombre",
        searchText: [
          template.name,
          formatScheduleTextWithH(template.name),
          template.rotationGroup,
          template.notes,
          ...(template.weeklyRows || []).map(buildReadableShiftSchedule),
        ].filter(Boolean).join(" "),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "es")),
  [templates]);

  const templatesById = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates],
  );
  const selectedWorkGroup = useMemo(
    () => workGroups.find((group) => group.id === groupId) || null,
    [groupId, workGroups],
  );
  const selectedWorkGroupEmployeeIds = useMemo(
    () => new Set((selectedWorkGroup?.members || []).map((member) => member.employeeId).filter(Boolean)),
    [selectedWorkGroup],
  );
  const workGroupOptions = useMemo(() =>
    workGroups
      .filter((group) => group.isActive !== false)
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "es")),
  [workGroups]);

  const rolesByCode = useMemo(
    () => new Map(roles.map((role) => [role.code, role])),
    [roles],
  );

  const hasPlanningScope = Boolean(selectedWorkGroup);
  const assignmentsScopeKey = `${monthKey}|${groupId}|${selectedWeek?.weekStartKey || ""}`;
  const hasLoadedCurrentAssignments = loadedAssignmentsKey === assignmentsScopeKey;
  const shouldShowScopedLoading = hasPlanningScope && (isAssignmentsLoading || !hasLoadedCurrentAssignments);

  const filteredEmployees = useMemo(
    () =>
      employees.filter((employee) => {
        if (!hasPlanningScope) return false;
        if (!usesVariableSchedule(employee)) return false;
        if (!isEmployeeActiveForPlanningWeek(employee, weekDateKeys)) return false;
        return selectedWorkGroupEmployeeIds.has(employee.id);
      }),
    [employees, hasPlanningScope, selectedWorkGroupEmployeeIds, weekDateKeys],
  );
  const hasDraftChanges = useMemo(() => filteredEmployees.some((employee) =>
    weekDateKeys.some((dateKey) =>
      (draftDays[employee.id]?.[dateKey] || OFF_SHIFT_OPTION.key)
      !== (savedDraftDays[employee.id]?.[dateKey] || OFF_SHIFT_OPTION.key),
    )),
  [draftDays, filteredEmployees, savedDraftDays, weekDateKeys]);
  const selectedWorkGroupEmployeeIdsParam = useMemo(() => {
    if (!selectedWorkGroup) return "";

    return filteredEmployees
      .map((employee) => employee.id)
      .filter(Boolean)
      .sort()
      .join(",");
  }, [filteredEmployees, selectedWorkGroup]);
  const weeklyApprovalState = useMemo(
    () => buildWeeklyApprovalState(
      assignments,
      filteredEmployees.length,
      selectedWeek?.weekStartKey || "",
    ),
    [assignments, filteredEmployees.length, selectedWeek],
  );
  const viewedHistoryVersion = useMemo(() =>
    weeklyApprovalState.historyEntries.find((entry) => entry.versionKey === viewedVersionKey)
    || null,
  [viewedVersionKey, weeklyApprovalState]);
  const approvedHistoryVersion = weeklyApprovalState.approvedVersion || null;
  const isScheduleReadOnly = weeklyApprovalState.isApproved;
  const currentUnlockRequest =
    unlockRequest?.groupId === groupId
    && unlockRequest?.weekStartKey === selectedWeek?.weekStartKey
      ? unlockRequest
      : null;

  const coverageRolesForEmployee = useCallback((employee) => {
    const assignments = Array.isArray(employee?.roleAssignments) ? employee.roleAssignments : [];
    const optionsByCode = new Map();

    assignments.forEach((assignment) => {
      const code = assignment.code || "";
      const role = rolesByCode.get(code);
      const optionAreaCode = role?.areaCode || assignment.areaCode || "";

      if (!code) return;

      optionsByCode.set(code, {
        code,
        name: role?.name || assignment.name || code,
        areaCode: optionAreaCode,
        areaName: role?.areaName || assignment.areaName || "",
      });
    });

    if (optionsByCode.size) {
      return [...optionsByCode.values()].sort((left, right) => left.name.localeCompare(right.name, "es"));
    }

    if (employee?.roleCode) {
      const role = rolesByCode.get(employee.roleCode);
      const optionAreaCode = role?.areaCode || employee.areaCode || "";

      optionsByCode.set(employee.roleCode, {
        code: employee.roleCode,
        name: role?.name || employee.roleName || employee.roleCode,
        areaCode: optionAreaCode,
        areaName: role?.areaName || employee.areaName || "",
      });
    }

    return [...optionsByCode.values()].sort((left, right) => left.name.localeCompare(right.name, "es"));
  }, [rolesByCode]);

  const getShiftOptionsForEmployee = useCallback((employee) => {
    const optionsByKey = new Map([
      [OFF_SHIFT_OPTION.key, OFF_SHIFT_OPTION],
    ]);
    const roleCodes = new Set(
      coverageRolesForEmployee(employee)
        .map((role) => role.code)
        .filter(Boolean),
    );

    if (employee?.roleCode) {
      roleCodes.add(employee.roleCode);
    }

    templates.forEach((template) => {
      if (template.roleCode && roleCodes.size && !roleCodes.has(template.roleCode)) return;

      (template.weeklyRows || []).forEach((row) => {
        if (!row?.startTime || !row?.endTime || row.dayType === "off_day" || row.dayType === "holiday") return;

        const option = buildShiftOption(row);
        setShiftOption(optionsByKey, option);
      });
    });

    return [...optionsByKey.values()].sort((left, right) => {
      if (left.key === "off") return -1;
      if (right.key === "off") return 1;
      return `${left.startTime}${left.endTime}${left.lunchDurationMinutes}`.localeCompare(
        `${right.startTime}${right.endTime}${right.lunchDurationMinutes}`,
      );
    });
  }, [coverageRolesForEmployee, templates]);

  const overlaysByEmployeeDate = useMemo(() =>
    buildPlanningOverlayIndexes({ exceptions, vacations }),
  [exceptions, vacations]);

  const holidaysByDate = useMemo(
    () => new Map(holidays.map((holiday) => [holiday.dateKey, holiday])),
    [holidays],
  );
  const holidayDateKeys = useMemo(
    () => new Set(holidaysByDate.keys()),
    [holidaysByDate],
  );

  const displayedDraftDays = useMemo(() => {
    if (!approvedHistoryVersion) return draftDays;

    return Object.fromEntries(filteredEmployees.map((employee) => [
      employee.id,
      Object.fromEntries(
        (approvedHistoryVersion.employeeDays?.[employee.id] || [])
          .map((day) => [day.dateKey, dayToShiftKey(day, shiftOptions)]),
      ),
    ]));
  }, [approvedHistoryVersion, draftDays, filteredEmployees, shiftOptions]);

  const displayedDayNotes = useMemo(() => {
    if (!approvedHistoryVersion) return draftDayNotes;

    return Object.fromEntries(filteredEmployees.map((employee) => [
      employee.id,
      Object.fromEntries(
        (approvedHistoryVersion.employeeDays?.[employee.id] || [])
          .filter((day) => day.dateKey && day.operationalNote)
          .map((day) => [day.dateKey, day.operationalNote]),
      ),
    ]));
  }, [approvedHistoryVersion, draftDayNotes, filteredEmployees]);

  const effectiveDraftDays = useMemo(() =>
    applyPlanningOverlaysToDraftDays({
      draftDays: displayedDraftDays,
      employees: filteredEmployees,
      weekDateKeys,
      overlaysByEmployeeDate,
    }),
  [displayedDraftDays, filteredEmployees, overlaysByEmployeeDate, weekDateKeys]);

  const weekRoleForEmployee = useCallback((employee, weekStartKey) => {
    const roleCodeForWeek = draftWeekRoles[employee.id]?.[weekStartKey] || employee.roleCode || "";
    const employeeRoles = coverageRolesForEmployee(employee);
    const role = employeeRoles.find((option) => option.code === roleCodeForWeek) || employeeRoles[0];

    return {
      code: role?.code || roleCodeForWeek,
      name: role?.name || employee.roleName || roleCodeForWeek,
      areaCode: role?.areaCode || employee.areaCode || "",
      areaName: role?.areaName || employee.areaName || "",
    };
  }, [coverageRolesForEmployee, draftWeekRoles]);

  const roleForEmployeeOnDate = useCallback((employee, dateKey) => {
    const dayRoleCode = draftDayRoles[employee.id]?.[dateKey] || "";

    if (!dayRoleCode) {
      return weekRoleForEmployee(employee, getWeekStartKey(dateKey));
    }

    const employeeRoles = coverageRolesForEmployee(employee);
    const role = employeeRoles.find((option) => option.code === dayRoleCode);

    if (!role) {
      return weekRoleForEmployee(employee, getWeekStartKey(dateKey));
    }

    return {
      code: role.code,
      name: role.name || role.code,
      areaCode: role.areaCode || employee.areaCode || "",
      areaName: role.areaName || employee.areaName || "",
    };
  }, [coverageRolesForEmployee, draftDayRoles, weekRoleForEmployee]);

  const activeEmployeesByDay = useMemo(() =>
    new Map(weekDateKeys.map((dateKey) => [
      dateKey,
      filteredEmployees.filter((employee) =>
        isEmployeeActiveOnDate(employee, dateKey) &&
        isWorkShift(effectiveDraftDays[employee.id]?.[dateKey] || "off"),
      ).length,
    ])),
  [effectiveDraftDays, filteredEmployees, weekDateKeys]);

  const planningCostByEmployee = useMemo(() => {
    if (!showHours && !showFinancials && !showSummaries) return new Map();

    return new Map(filteredEmployees.map((employee) => [
      employee.id,
      estimateWeeklyPlanningCost({
        employee,
        weekDateKeys,
        draftDays: effectiveDraftDays,
        shiftOptionsByKey,
        holidayDateKeys,
        dailyBaseHours,
        regularWorkdayLimit: 5,
      }),
    ]));
  }, [dailyBaseHours, effectiveDraftDays, filteredEmployees, holidayDateKeys, shiftOptionsByKey, showFinancials, showHours, showSummaries, weekDateKeys]);

  const summary = useMemo(() => {
    let extraDayIndicators = 0;
    let laborableMinutes = 0;
    let supplementaryMinutes = 0;
    let extraordinaryMinutes = 0;
    let supplementaryAmount = 0;
    let extraordinaryAmount = 0;

    filteredEmployees.forEach((employee) => {
      const employeeCost = planningCostByEmployee.get(employee.id);

      laborableMinutes += employeeCost?.laborableMinutes || 0;
      supplementaryMinutes += employeeCost?.supplementaryMinutes || 0;
      extraordinaryMinutes += employeeCost?.extraordinaryMinutes || 0;
      supplementaryAmount += employeeCost?.supplementaryAmount || 0;
      extraordinaryAmount += employeeCost?.extraordinaryAmount || 0;
      extraDayIndicators += (employeeCost?.rows || []).filter((row) => row.type === "extraordinary").length;
    });

    return {
      extraDayIndicators,
      laborableMinutes,
      supplementaryMinutes,
      extraordinaryMinutes,
      supplementaryAmount,
      extraordinaryAmount,
      extraCostAmount: supplementaryAmount + extraordinaryAmount,
    };
  }, [filteredEmployees, planningCostByEmployee]);

  const variableCostDetails = useMemo(() => {
    const details = [];

    filteredEmployees.forEach((employee) => {
      const employeeCost = planningCostByEmployee.get(employee.id);
      const extraordinaryRows = (employeeCost?.rows || []).filter((row) => row.type === "extraordinary");
      const supplementaryRows = (employeeCost?.rows || []).filter((row) => row.type === "supplementary");

      if (extraordinaryRows.length || supplementaryRows.length) {
        details.push({
          key: employee.id,
          employeeName: employee.fullName,
          extraDaysCount: extraordinaryRows.length,
          supplementaryMinutes: supplementaryRows.reduce((total, row) => total + row.minutes, 0),
          extraordinaryAmountLabel: formatMoney(extraordinaryRows.reduce((total, row) => total + row.amount, 0)),
          extraordinaryHoursLabel: formatDuration(extraordinaryRows.reduce((total, row) => total + row.minutes, 0)),
          supplementaryAmountLabel: formatMoney(supplementaryRows.reduce((total, row) => total + row.amount, 0)),
          supplementaryHoursLabel: formatDuration(supplementaryRows.reduce((total, row) => total + row.minutes, 0)),
        });
      }
    });

    return details;
  }, [filteredEmployees, planningCostByEmployee]);

  const clearNoticeTimers = useCallback(() => {
    if (noticeExitTimeoutRef.current) window.clearTimeout(noticeExitTimeoutRef.current);
    if (noticeRemoveTimeoutRef.current) window.clearTimeout(noticeRemoveTimeoutRef.current);
    noticeExitTimeoutRef.current = null;
    noticeRemoveTimeoutRef.current = null;
  }, []);

  const markDraftEdited = useCallback(() => {
    draftRevisionRef.current += 1;
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
    noticeExitTimeoutRef.current = window.setTimeout(dismissNotice, 4000);
  }, [clearNoticeTimers, dismissNotice]);

  const replaceFilters = useCallback((nextFilters) => {
    router.replace(buildPlannerUrl({
      monthKey,
      groupId,
      weekIndex: resolvedSelectedWeekIndex,
      ...nextFilters,
    }, basePath), { scroll: false });
  }, [basePath, groupId, monthKey, resolvedSelectedWeekIndex, router]);

  const selectWeekIndex = useCallback((nextWeekIndex) => {
    const boundedWeekIndex = Math.min(Math.max(Number(nextWeekIndex) || 0, 0), maxWeekIndex);

    setViewedVersionKey("");
    setSelectedWeekIndex(boundedWeekIndex);
    replaceFilters({ weekIndex: boundedWeekIndex });
  }, [maxWeekIndex, replaceFilters]);

  const navigateMonth = useCallback((offset) => {
    const nextMonthKey = shiftMonthKey(monthKey, offset);

    setViewedVersionKey("");
    setMonthKey(nextMonthKey);
    setSelectedWeekIndex(0);
    replaceFilters({ monthKey: nextMonthKey, weekIndex: 0 });
  }, [monthKey, replaceFilters]);

  useEffect(() => {
    if (!weekOptions.length || selectedWeekIndex === resolvedSelectedWeekIndex) {
      return;
    }

    replaceFilters({ weekIndex: resolvedSelectedWeekIndex });
  }, [replaceFilters, resolvedSelectedWeekIndex, selectedWeekIndex, weekOptions.length]);

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      try {
        const response = await fetch("/api/planner/planning/operational-setup?resource=weekly-bootstrap");
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.error || "No se pudo cargar la configuración semanal.");

        if (!isCancelled) {
          setEmployees(payload.employees || []);
          setRoles(payload.roles || []);
          setTemplates(payload.templates || []);
          const nextWorkGroups = payload.groups || [];
          const nextIsWorkGroupLocked = Boolean(payload.isWorkGroupLocked);

          setWorkGroups(nextWorkGroups);
          setIsWorkGroupLocked(nextIsWorkGroupLocked);

          if (nextIsWorkGroupLocked && nextWorkGroups.length) {
            const assignedGroup = nextWorkGroups[0];
            setGroupId(assignedGroup.id);
            setBranchCode(assignedGroup.branchCode || "");
          }
        }
      } catch (error) {
        if (!isCancelled) showNotice("error", error.message);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    loadData();

    return () => {
      isCancelled = true;
      clearNoticeTimers();
    };
  }, [clearNoticeTimers, showNotice]);

  useEffect(() => {
    if (isLoading) return;

    let isCancelled = false;

    async function loadAssignments() {
      if (!hasPlanningScope) {
        await Promise.resolve();

        if (!isCancelled) {
          setIsAssignmentsLoading(false);
          setLoadedAssignmentsKey("");
          setUnlockRequest(null);
        }
        return;
      }

      const requestDraftRevision = draftRevisionRef.current;

      try {
        setIsAssignmentsLoading(true);
        const params = new URLSearchParams({ month: monthKey });
        const queryBranchCode = selectedWorkGroup?.branchCode || branchCode;

        if (queryBranchCode) params.set("branchCode", queryBranchCode);
        if (selectedWorkGroup) {
          if (!selectedWorkGroupEmployeeIdsParam) {
            const nextAssignments = [];

            setAssignments(nextAssignments);
            setExceptions([]);
            setVacations([]);
            setHolidays([]);
            setUnlockRequest(null);
            const nextDraftDays = buildDraftDays(nextAssignments, baseShiftOptions);

            setSavedDraftDays(nextDraftDays);
            setDraftDays(nextDraftDays);
            setDraftWeekRoles(buildDraftWeekRoles(nextAssignments, employees, weekOptions));
            setDraftDayRoles(buildDraftDayRoles(nextAssignments));
            setDraftDayNotes(buildDraftDayNotes(nextAssignments));
            setLoadedAssignmentsKey(assignmentsScopeKey);
            setIsAssignmentsLoading(false);
            return;
          }

          params.set("employeeIds", selectedWorkGroupEmployeeIdsParam);
          params.set("groupId", selectedWorkGroup.id);
        }
        if (selectedWeek?.weekStartKey) params.set("weekStartKey", selectedWeek.weekStartKey);
        params.set("includeOverlays", "true");

        const response = await fetch(`/api/planner/planning/schedule-assignments?${params.toString()}`);
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.error || "No se pudieron cargar las asignaciones.");

        if (!isCancelled && requestDraftRevision === draftRevisionRef.current) {
          const nextAssignments = payload.assignments || [];
          const overlaysPayload = payload.overlays || {};

          setAssignments(nextAssignments);
          setUnlockRequest(payload.unlockRequest || null);
          setExceptions(overlaysPayload.exceptions || []);
          setVacations(overlaysPayload.vacations || []);
          setHolidays(overlaysPayload.holidays || []);
          const nextDraftDays = buildDraftDays(nextAssignments, baseShiftOptions);

          setSavedDraftDays(nextDraftDays);
          setDraftDays(nextDraftDays);
          setDraftWeekRoles(buildDraftWeekRoles(nextAssignments, employees, weekOptions));
          setDraftDayRoles(buildDraftDayRoles(nextAssignments));
          setDraftDayNotes(buildDraftDayNotes(nextAssignments));
          setLoadedAssignmentsKey(assignmentsScopeKey);
          setIsAssignmentsLoading(false);

        }
      } catch (error) {
        if (!isCancelled) showNotice("error", error.message);
      } finally {
        if (!isCancelled) setIsAssignmentsLoading(false);
      }
    }

    loadAssignments();

    return () => {
      isCancelled = true;
    };
  }, [assignmentsScopeKey, baseShiftOptions, branchCode, employees, hasPlanningScope, isLoading, monthKey, selectedWeek, selectedWorkGroup, selectedWorkGroupEmployeeIdsParam, showNotice, weekDateKeys, weekOptions]);

  function setCell(employeeId, dateKey, shiftKey) {
    if (isScheduleReadOnly) return;
    const currentShiftKey = draftDays[employeeId]?.[dateKey] || OFF_SHIFT_OPTION.key;

    if (currentShiftKey === shiftKey) return;

    markDraftEdited();

    setDraftDays((current) => ({
      ...current,
      [employeeId]: {
        ...(current[employeeId] || {}),
        [dateKey]: shiftKey,
      },
    }));
    setDraftDayNotes((current) => {
      const employeeNotes = { ...(current[employeeId] || {}) };

      delete employeeNotes[dateKey];

      return {
        ...current,
        [employeeId]: employeeNotes,
      };
    });
  }

  function openAdjustmentModal(employee, dateKey) {
    if (isScheduleReadOnly) return;

    const shiftKey = draftDays[employee.id]?.[dateKey] || "off";
    const day = dayFromDraft(dateKey, shiftKey, shiftOptionsByKey);

    setAdjustmentTarget({
      employee,
      dateKey,
      day,
      requestKey: globalThis.crypto?.randomUUID?.() || `${employee.id}-${dateKey}-${Date.now()}`,
    });
    setAdjustmentForm({
      ...DEFAULT_ADJUSTMENT_FORM,
      startTime: day.startTime || "",
      endTime: day.endTime || "",
      plannedStartTime: day.startTime || "",
      plannedLunchStartTime: day.lunchStartTime || "",
      plannedLunchEndTime: day.lunchEndTime || "",
      plannedEndTime: day.endTime || "",
    });
  }

  function updateAdjustmentField(field, value) {
    if (field === "kind") {
      const selectedType = PLANNED_ADJUSTMENT_TYPES.find((option) => option.value === value) || PLANNED_ADJUSTMENT_TYPES[0];

      setAdjustmentForm((current) => ({
        ...current,
        kind: selectedType.value,
        startTime: selectedType.requiresTimeRange ? current.startTime : "",
        endTime: selectedType.requiresTimeRange ? current.endTime : "",
        scheduleTemplateId: "",
        useCustomSchedule: false,
      }));
      return;
    }

    if (field === "useCustomSchedule") {
      const useCustomSchedule = Boolean(value);

      setAdjustmentForm((current) => ({
        ...current,
        useCustomSchedule,
        scheduleTemplateId: "",
        ...(!useCustomSchedule ? {
          plannedStartTime: "",
          plannedLunchStartTime: "",
          plannedLunchEndTime: "",
          plannedEndTime: "",
        } : {}),
      }));
      return;
    }

    if (field === "scheduleTemplateId") {
      const template = templatesById.get(value);
      const templateDay = adjustmentTarget ? resolveTemplateScheduleForDate(template, adjustmentTarget.dateKey) : null;

      setAdjustmentForm((current) => ({
        ...current,
        scheduleTemplateId: value,
        ...(templateDay ? {
          plannedStartTime: templateDay.startTime || "",
          plannedLunchStartTime: templateDay.lunchStartTime || "",
          plannedLunchEndTime: templateDay.lunchEndTime || "",
          plannedEndTime: templateDay.endTime || "",
        } : {}),
      }));
      return;
    }

    setAdjustmentForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function openQuickTemplateModal() {
    const hasLunch = Boolean(adjustmentForm.plannedLunchStartTime && adjustmentForm.plannedLunchEndTime);

    setQuickTemplateForm({
      ...DEFAULT_QUICK_TEMPLATE_FORM,
      startTime: adjustmentForm.plannedStartTime || DEFAULT_QUICK_TEMPLATE_FORM.startTime,
      hasLunch,
      lunchStartTime: hasLunch ? adjustmentForm.plannedLunchStartTime : "",
      lunchEndTime: hasLunch ? adjustmentForm.plannedLunchEndTime : "",
      endTime: adjustmentForm.plannedEndTime || DEFAULT_QUICK_TEMPLATE_FORM.endTime,
    });
    setIsQuickTemplateModalOpen(true);
  }

  function openBlankQuickTemplateModal() {
    setQuickTemplateForm(DEFAULT_QUICK_TEMPLATE_FORM);
    setIsQuickTemplateModalOpen(true);
  }

  function closeQuickTemplateModal() {
    if (isQuickTemplateSaving) return;

    setIsQuickTemplateModalOpen(false);
    setQuickTemplateForm(DEFAULT_QUICK_TEMPLATE_FORM);
  }

  function updateQuickTemplateField(field, value) {
    setQuickTemplateForm((current) => {
      const next = { ...current, [field]: value };

      if (field === "hasLunch" && value) {
        next.lunchStartTime = next.lunchStartTime || "12:30";
        next.lunchEndTime = next.lunchEndTime || "14:00";
      }

      if (field === "hasLunch" && !value) {
        next.lunchStartTime = "";
        next.lunchEndTime = "";
      }

      return next;
    });
  }

  async function saveQuickTemplate() {
    if (isQuickTemplateSaving) return;

    const row = buildQuickTemplateRow(quickTemplateForm);
    const startMinutes = parseTimeToMinutes(row.startTime);
    const endMinutes = parseTimeToMinutes(row.endTime);
    const lunchStartMinutes = parseTimeToMinutes(row.lunchStartTime);
    const lunchEndMinutes = parseTimeToMinutes(row.lunchEndTime);

    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
      showNotice("error", "La plantilla debe tener entrada y salida validas.");
      return;
    }

    if (quickTemplateForm.hasLunch && (lunchStartMinutes === null || lunchEndMinutes === null || lunchStartMinutes <= startMinutes || lunchEndMinutes >= endMinutes)) {
      showNotice("error", "El almuerzo debe quedar dentro de la jornada.");
      return;
    }

    setIsQuickTemplateSaving(true);

    try {
      const response = await fetch("/api/planner/planning/base-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQuickTemplatePayload(quickTemplateForm)),
      });
      const payload = await response.json();

      if (!response.ok) throw new Error(payload.error || "No se pudo crear la plantilla.");

      const savedTemplate = payload.template;
      const templateDay = adjustmentTarget
        ? resolveTemplateScheduleForDate(savedTemplate, adjustmentTarget.dateKey)
        : null;

      setTemplates((current) => {
        const exists = current.some((template) => template.id === savedTemplate.id);
        const nextTemplates = exists
          ? current.map((template) => (template.id === savedTemplate.id ? savedTemplate : template))
          : [...current, savedTemplate];

        return nextTemplates.sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "es"));
      });
      if (adjustmentTarget) {
        setAdjustmentForm((current) => ({
          ...current,
          scheduleTemplateId: savedTemplate.id,
          ...(templateDay ? {
            plannedStartTime: templateDay.startTime || "",
            plannedLunchStartTime: templateDay.lunchStartTime || "",
            plannedLunchEndTime: templateDay.lunchEndTime || "",
            plannedEndTime: templateDay.endTime || "",
          } : {}),
        }));
      }
      setIsQuickTemplateModalOpen(false);
      setQuickTemplateForm(DEFAULT_QUICK_TEMPLATE_FORM);
      showNotice("success", "Plantilla creada correctamente.");
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setIsQuickTemplateSaving(false);
    }
  }

  function closeAdjustmentModal() {
    setAdjustmentTarget(null);
    setAdjustmentForm(DEFAULT_ADJUSTMENT_FORM);
    setIsQuickTemplateModalOpen(false);
    setQuickTemplateForm(DEFAULT_QUICK_TEMPLATE_FORM);
  }

  async function saveAdjustment() {
    if (!adjustmentTarget || adjustmentSaveInFlightRef.current) return;

    const selectedType = PLANNED_ADJUSTMENT_TYPES.find((option) => option.value === adjustmentForm.kind) || PLANNED_ADJUSTMENT_TYPES[0];
    const { employee, dateKey, day } = adjustmentTarget;
    const requiresSchedule = selectedType.requiresSchedule;
    const usesTimeRange = selectedType.requiresTimeRange;
    const usesExistingPlannedSchedule = selectedType.value === "permission_full_day";
    const supportsCustomSchedule = selectedType.value === "outside_work";
    const requiresTemplateSelection =
      supportsCustomSchedule
      && !adjustmentForm.useCustomSchedule;
    const plannedDay = requiresSchedule
      ? buildPlannedScheduleDay(dateKey, {
        startTime: adjustmentForm.plannedStartTime,
        lunchStartTime: adjustmentForm.plannedLunchStartTime,
        lunchEndTime: adjustmentForm.plannedLunchEndTime,
        endTime: adjustmentForm.plannedEndTime,
      })
      : day;
    const plannedStartTime = requiresSchedule ? plannedDay.startTime : day.startTime || "";
    const plannedLunchStartTime = requiresSchedule ? plannedDay.lunchStartTime : day.lunchStartTime || "";
    const plannedLunchEndTime = requiresSchedule ? plannedDay.lunchEndTime : day.lunchEndTime || "";
    const plannedEndTime = requiresSchedule ? plannedDay.endTime : day.endTime || "";

    if (requiresTemplateSelection && !adjustmentForm.scheduleTemplateId) {
      showNotice("error", "Selecciona una plantilla o activa el horario personalizado.");
      return;
    }

    if (requiresSchedule && !hasPlannedScheduleFields(plannedDay)) {
      showNotice("error", "Selecciona una plantilla o indica entrada y salida para el horario planificado.");
      return;
    }

    if (usesExistingPlannedSchedule && !hasPlannedScheduleFields(day)) {
      showNotice("error", "El permiso de jornada completa requiere un horario planificado en este día.");
      return;
    }

    if (usesTimeRange && (!adjustmentForm.startTime || !adjustmentForm.endTime)) {
      showNotice("error", "Indica desde y hasta para el permiso por horas.");
      return;
    }

    adjustmentSaveInFlightRef.current = true;
    setIsAdjustmentSaving(true);

    try {
      const response = await fetch("/api/planner/planning/exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planningSource: "schedule_planner",
          requestKey: adjustmentTarget.requestKey,
          autoResolve: !["permission_partial", "permission_full_day"].includes(selectedType.value),
          employeeId: employee.id,
          dateKey,
          type: selectedType.type,
          scope: selectedType.scope,
          effect: selectedType.effect,
          attendanceMode: selectedType.attendanceMode,
          payMode: selectedType.payMode,
          resolution: selectedType.resolution,
          startTime: usesTimeRange ? adjustmentForm.startTime : (selectedType.value === "outside_work" ? plannedStartTime : ""),
          endTime: usesTimeRange ? adjustmentForm.endTime : (selectedType.value === "outside_work" ? plannedEndTime : ""),
          plannedStartTime,
          plannedLunchStartTime,
          plannedLunchEndTime,
          plannedEndTime,
          destination: "",
          countsAsWorkedTime: ["outside_work", "permission_full_day"].includes(selectedType.value),
          allowSupplementaryTime: selectedType.value === "outside_work",
          notes: adjustmentForm.notes || `Ajuste planificado desde horario semanal: ${selectedType.label}`,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo crear el ajuste.");
      }

      const overlaysPayload = await fetchPlanningOverlays(monthKey, weekDateKeys);

      setExceptions(overlaysPayload.exceptions || []);
      setVacations(overlaysPayload.vacations || []);
      setHolidays(overlaysPayload.holidays || []);
      closeAdjustmentModal();
      showNotice("success", "Ajuste creado para el dia seleccionado.");
    } catch (error) {
      showNotice("error", error.message || "No se pudo crear el ajuste.");
    } finally {
      adjustmentSaveInFlightRef.current = false;
      setIsAdjustmentSaving(false);
    }
  }

  function applyClipboardScheduleText(text) {
    if (isScheduleReadOnly) return;

    const nextPreview = buildClipboardSchedulePreview(
      text,
      filteredEmployees,
      weekDateKeys,
      getShiftOptionsForEmployee,
    );

    if (!String(text || "").trim() || !nextPreview.rows.length) {
      throw new Error("No encontre una tabla valida en el portapapeles.");
    }

    if (nextPreview.errors.length) {
      throw new Error(nextPreview.errors.slice(0, 3).join(" "));
    }

    const rowsToApply = nextPreview.rows.filter((row) => row.employee);

    if (!rowsToApply.length) {
      throw new Error("Pega una tabla con empleados que existan en el alcance actual.");
    }

    const scheduleChanges = [];

    rowsToApply.forEach((row) => {
      row.cells.forEach((cell) => {
        const overlay = overlaysByEmployeeDate.get(`${row.employee.id}|${cell.dateKey}`);

        if (overlay?.kind === "vacation" || holidayDateKeys.has(cell.dateKey)) {
          return;
        }

        const nextShiftKey = cell.status === "shift" ? cell.shiftKey : OFF_SHIFT_OPTION.key;
        const currentShiftKey = draftDays[row.employee.id]?.[cell.dateKey] || OFF_SHIFT_OPTION.key;

        if (currentShiftKey !== nextShiftKey) {
          scheduleChanges.push({
            employeeId: row.employee.id,
            dateKey: cell.dateKey,
            shiftKey: nextShiftKey,
          });
        }
      });
    });

    if (!scheduleChanges.length) {
      showNotice("success", "La tabla coincide con la planificación actual. No hay cambios para guardar.");
      return;
    }

    markDraftEdited();
    setDraftDays((current) => {
      const next = { ...current };

      scheduleChanges.forEach(({ employeeId, dateKey, shiftKey }) => {
        next[employeeId] = {
          ...(next[employeeId] || {}),
          [dateKey]: shiftKey,
        };
      });

      return next;
    });

    const skippedLabel = nextPreview.stats.unmatched
      ? ` ${nextPreview.stats.unmatched} fila(s) no coinciden exactamente y se omitirán.`
      : "";

    showNotice("success", `Tabla aplicada: ${rowsToApply.length} empleados, ${nextPreview.stats.shifts} turnos.${skippedLabel}`);
  }

  function openManualPaste() {
    setManualClipboardText("");
    setIsManualPasteOpen(true);
  }

  async function pasteClipboardSchedule() {
    if (!navigator.clipboard?.readText) {
      openManualPaste();
      return;
    }

    let text = "";

    try {
      text = await navigator.clipboard.readText();
    } catch (error) {
      openManualPaste();
      showNotice(
        "error",
        error?.name === "NotAllowedError"
          ? "El navegador bloqueo el acceso directo. Pega la tabla manualmente en la ventana abierta."
          : error.message || "No se pudo leer el portapapeles. Pega la tabla manualmente.",
      );
      return;
    }

    try {
      applyClipboardScheduleText(text);
    } catch (error) {
      showNotice("error", error.message || "No se pudo aplicar la tabla pegada.");
    }
  }

  function processManualClipboardSchedule() {
    try {
      applyClipboardScheduleText(manualClipboardText);
      setIsManualPasteOpen(false);
      setManualClipboardText("");
    } catch (error) {
      showNotice("error", error.message || "No se pudo procesar la tabla pegada.");
    }
  }

  const buildOperationalEmployeeDaysForSave = useCallback((scheduleOverrides = new Map()) => {
    const dailyBaseMinutes = dailyBaseHours * 60;

    return filteredEmployees.map((employee) => ({
      employeeId: employee.id,
      days: applyWeeklyExtraDays(weekDateKeys.filter((dateKey) =>
        isEmployeeActiveOnDate(employee, dateKey),
      ).map((dateKey) => {
        const dayRole = roleForEmployeeOnDate(employee, dateKey);
        const overlay = overlaysByEmployeeDate.get(`${employee.id}|${dateKey}`);
        const scheduleOverride = scheduleOverrides.get(`${employee.id}|${dateKey}`);
        const shiftKey = overlay?.kind === "vacation"
          ? RESERVED_SHIFT_KEYS.vacation
          : draftDays[employee.id]?.[dateKey] || "off";
        const baseDay = scheduleOverride
          || buildOperationalDay(dateKey, shiftKey, shiftOptionsByKey);
        const operationalNote = overlay ? "" : draftDayNotes[employee.id]?.[dateKey] || baseDay.operationalNote || "";

        return {
          ...baseDay,
          areaCode: dayRole.areaCode,
          areaName: dayRole.areaName,
          roleCode: dayRole.code,
          roleName: dayRole.name,
          operationalNote,
          operationalJustification: Boolean(operationalNote),
        };
      }), 5, dailyBaseMinutes),
    }));
  }, [
    dailyBaseHours,
    draftDayNotes,
    draftDays,
    filteredEmployees,
    overlaysByEmployeeDate,
    roleForEmployeeOnDate,
    shiftOptionsByKey,
    weekDateKeys,
  ]);

  function saveWeek() {
    if (isScheduleReadOnly) {
      showNotice("error", "Esta version esta disponible unicamente en modo de consulta.");
      return;
    }

    const employeeDays = buildOperationalEmployeeDaysForSave();
    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/planning/schedule-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "operational-save",
            monthKey,
            groupId,
            weekStartKey: selectedWeek?.weekStartKey || "",
            employeeDays,
          }),
        });
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.error || "No se pudo guardar la programacion.");

        const nextAssignments = payload.assignments || [];

        setAssignments(nextAssignments);
        const nextDraftDays = buildDraftDays(nextAssignments, shiftOptions);

        setSavedDraftDays(nextDraftDays);
        setDraftDays(nextDraftDays);
        setDraftWeekRoles(buildDraftWeekRoles(nextAssignments, employees, weekOptions));
        setDraftDayRoles(buildDraftDayRoles(nextAssignments));
        setDraftDayNotes(buildDraftDayNotes(nextAssignments));
        showNotice("success", payload.message || "Programacion guardada correctamente.");

        fetchPlanningOverlays(monthKey, weekDateKeys)
          .then((overlaysPayload) => {
            setExceptions(overlaysPayload.exceptions || []);
            setVacations(overlaysPayload.vacations || []);
            setHolidays(overlaysPayload.holidays || []);
          })
          .catch((overlayError) => {
            showNotice("error", overlayError.message || "No se pudieron refrescar las novedades.");
          });
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  function approveWeek() {
    if (hasDraftChanges) {
      showNotice("error", "Guarda los cambios antes de aprobar la planificacion.");
      return;
    }

    if (!weeklyApprovalState.latestHistory) {
      showNotice("error", "Guarda una version antes de aprobar la planificacion.");
      return;
    }

    const versionToApprove = weeklyApprovalState.latestHistory;

    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/planning/schedule-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "approve-week",
            monthKey,
            groupId,
            weekStartKey: selectedWeek?.weekStartKey || "",
            employeeIds: filteredEmployees.map((employee) => employee.id),
            versionSavedAt: versionToApprove.savedAt,
            versionSavedBy: versionToApprove.savedBy || "",
            versionSavedByUser: versionToApprove.savedByUser || "",
          }),
        });
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.error || "No se pudo aprobar la planificacion.");

        setAssignments(payload.assignments || []);
        setIsApprovalConfirmOpen(false);
        showNotice("success", payload.message || "Planificacion aprobada.");
      } catch (error) {
        showNotice("error", error.message || "No se pudo aprobar la planificacion.");
      }
    });
  }

  function unlockWeek() {
    const normalizedReason = unlockReason.trim();

    if (normalizedReason.length < 10) {
      showNotice("error", "Describe el motivo del desbloqueo con al menos 10 caracteres.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/planning/schedule-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "unlock-week",
            monthKey,
            groupId,
            weekStartKey: selectedWeek?.weekStartKey || "",
            employeeIds: filteredEmployees.map((employee) => employee.id),
            reason: normalizedReason,
          }),
        });
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.error || "No se pudo desbloquear la planificación.");

        setAssignments(payload.assignments || []);
        setUnlockRequest(null);
        setIsUnlockConfirmOpen(false);
        setUnlockReason("");
        showNotice("success", payload.message || "Planificación desbloqueada correctamente.");
      } catch (error) {
        showNotice("error", error.message || "No se pudo desbloquear la planificación.");
      }
    });
  }

  function requestWeekUnlock() {
    const normalizedReason = unlockReason.trim();

    if (normalizedReason.length < 10) {
      showNotice("error", "Describe el motivo del desbloqueo con al menos 10 caracteres.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/planning/schedule-unlock-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            monthKey,
            groupId,
            weekStartKey: selectedWeek?.weekStartKey || "",
            reason: normalizedReason,
          }),
        });
        const payload = await response.json();

        if (!response.ok) {
          if (payload.request) setUnlockRequest(payload.request);
          throw new Error(payload.error || "No se pudo solicitar el desbloqueo.");
        }

        setUnlockRequest(payload.request || null);
        setIsUnlockConfirmOpen(false);
        setUnlockReason("");
        showNotice("success", payload.message || "Solicitud de desbloqueo enviada.");
      } catch (error) {
        showNotice("error", error.message || "No se pudo solicitar el desbloqueo.");
      }
    });
  }

  function deletePendingException() {
    if (!exceptionToDelete?.id) return;

    if (exceptionToDelete.raw?.resolution !== "pending" || exceptionToDelete.raw?.status === "void") {
      setExceptionToDelete(null);
      showNotice("error", "Las excepciones aprobadas o resueltas no se pueden eliminar.");
      return;
    }

    const exceptionId = exceptionToDelete.id;

    startTransition(async () => {
      try {
        const response = await fetch(`/api/planner/planning/exceptions/${exceptionId}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo eliminar la excepción.");
        }

        setExceptions((current) => current.filter((exception) => exception.id !== exceptionId));
        setSelectedOverlay(null);
        setExceptionToDelete(null);
        showNotice("success", "Excepción eliminada correctamente.");
      } catch (error) {
        showNotice("error", error.message || "No se pudo eliminar la excepción.");
      }
    });
  }

  async function downloadScheduleExcel() {
    if (isExportingSchedule || shouldShowScopedLoading || !filteredEmployees.length) return;

    try {
      setIsExportingSchedule(true);

      const params = new URLSearchParams({ month: monthKey });
      const exportBranchCode = selectedWorkGroup?.branchCode || branchCode;

      if (exportBranchCode) params.set("branchCode", exportBranchCode);
      if (groupId) params.set("groupId", groupId);
      params.set("employeeIds", filteredEmployees.map((employee) => employee.id).join(","));

      const response = await fetch(`/api/planner/planning/schedule-assignments/export?${params.toString()}`);

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "No se pudo descargar el horario.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const scopeSuffix = selectedWorkGroup
        ? selectedWorkGroup.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
        : "grupo";

      link.href = url;
      link.download = `horarios-semanales-${monthKey}${scopeSuffix ? `-${scopeSuffix}` : ""}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showNotice("success", "Excel de horarios descargado.");
    } catch (error) {
      showNotice("error", error.message || "No se pudo descargar el horario.");
    } finally {
      setIsExportingSchedule(false);
    }
  }

  function openEmployeeDetail(event, employeeId) {
    if (!canOpenMonthlyDetail) return;
    if (event.target.closest("select, button, a")) return;

    const params = new URLSearchParams({ month: monthKey });

    if (groupId) params.set("groupId", groupId);

    router.push(`${planningModulePath(`/planning/monthly/${employeeId}`)}?${params.toString()}`);
  }

  if (isLoading) {
    return (
      <PlannerLoadingScene
        showFilters
        title="Preparando planificación semanal"
        description="Cargando grupos, empleados y plantillas de horario"
      />
    );
  }

  const selectedAdjustmentType = PLANNED_ADJUSTMENT_TYPES.find((option) => option.value === adjustmentForm.kind) || PLANNED_ADJUSTMENT_TYPES[0];
  const isPermissionAdjustment = selectedAdjustmentType.type === "permission";
  const isExternalWorkAdjustment = selectedAdjustmentType.value === "outside_work";
  const supportsCustomSchedule = isExternalWorkAdjustment;
  const adjustmentCategoryValue = isPermissionAdjustment ? "permission" : selectedAdjustmentType.value;
  const selectedOverlayRaw = selectedOverlay?.raw || {};
  const isSelectedPermission = selectedOverlay?.kind === "exception" && selectedOverlayRaw.type === "permission";
  const isSelectedPartialPermission = isSelectedPermission && selectedOverlayRaw.scope === "partial_day";
  const isSelectedFullDayPermission = isSelectedPermission && selectedOverlayRaw.scope === "full_day";
  const selectedPermissionRange = isSelectedPartialPermission
    ? formatHourRange(selectedOverlayRaw.startTime, selectedOverlayRaw.endTime)
    : "";
  const selectedOverlayHasPlannedSchedule = Boolean(
    selectedOverlayRaw.plannedStartTime
    || selectedOverlayRaw.plannedEndTime,
  );
  const showsCustomScheduleFields =
    selectedAdjustmentType.requiresSchedule
    && (!supportsCustomSchedule || adjustmentForm.useCustomSchedule);

  return (
    <div className={styles.layout}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />
      {showFinancials ? <FloatingModal
        isOpen={isCostModalOpen}
        eyebrow={selectedWeek?.rangeLabel || "Semana"}
        title="Costo variable estimado"
        onClose={() => setIsCostModalOpen(false)}
      >
        <div className={styles.costModal}>
          <section>
            <div className={styles.costSectionTitle}>
              <CalendarDays size={16} />
              <strong>Costo variable por empleado</strong>
              <span>{variableCostDetails.length}</span>
            </div>
            {variableCostDetails.length ? (
              <div className={styles.costList}>
                {variableCostDetails.map((detail) => (
                  <article key={detail.key}>
                    <strong>{detail.employeeName}</strong>
                    {detail.extraDaysCount ? (
                      <span>
                        {detail.extraDaysCount} dia{detail.extraDaysCount === 1 ? "" : "s"} extra · {detail.extraordinaryHoursLabel} · {detail.extraordinaryAmountLabel} aprox.
                      </span>
                    ) : null}
                    {detail.supplementaryMinutes ? (
                      <span>
                        Horas suplementarias · {detail.supplementaryHoursLabel} · {detail.supplementaryAmountLabel} aprox.
                      </span>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.costEmpty}>No hay costo variable estimado para esta semana.</p>
            )}
          </section>
        </div>
      </FloatingModal> : null}
      <ConfirmDialog
        isOpen={Boolean(exceptionToDelete)}
        title="Eliminar excepción pendiente"
        message={exceptionToDelete
          ? `Se eliminará la excepción de ${exceptionToDelete.employeeName || "este empleado"} para el ${exceptionToDelete.dateKey}. Esta acción no modifica la versión de la planificación.`
          : "La excepción pendiente será eliminada."}
        confirmLabel="Eliminar"
        cancelLabel="Conservar"
        tone="danger"
        isPending={isPending}
        onCancel={() => setExceptionToDelete(null)}
        onConfirm={deletePendingException}
      />
      <FloatingModal
        isOpen={Boolean(selectedOverlay)}
        eyebrow={selectedOverlay?.dateKey || "Novedad"}
        title={selectedOverlay?.title || "Detalle de novedad"}
        onClose={() => setSelectedOverlay(null)}
      >
        {selectedOverlay ? (
          <div className={styles.overlayModal}>
            <div className={styles.overlayStatus}>
              <span>{selectedOverlay.kind === "vacation" ? "Vacaciones" : "Excepcion"}</span>
              <strong>{selectedOverlay.statusLabel}</strong>
            </div>
            <dl>
              <div>
                <dt>Empleado</dt>
                <dd>{selectedOverlay.employeeName}</dd>
              </div>
              <div>
                <dt>Fecha</dt>
                <dd>{selectedOverlay.dateKey}</dd>
              </div>
              <div>
                <dt>Tipo</dt>
                <dd>{selectedOverlay.typeLabel}</dd>
              </div>
              {selectedOverlay.resolutionLabel ? (
                <div>
                  <dt>Resolucion</dt>
                  <dd>{selectedOverlay.resolutionLabel}</dd>
                </div>
              ) : null}
              {isSelectedPartialPermission && selectedPermissionRange ? (
                <div>
                  <dt>Rango del permiso</dt>
                  <dd>{selectedPermissionRange}</dd>
                </div>
              ) : null}
              {isSelectedFullDayPermission ? (
                <div>
                  <dt>Horario afectado</dt>
                  <dd>{formatShiftLabel(selectedOverlay.indicatedDay)}</dd>
                </div>
              ) : null}
              {selectedOverlay.kind === "exception" && !isSelectedPermission ? (
                <div>
                  <dt>Horario indicado</dt>
                  <dd>{formatShiftLabel(selectedOverlay.indicatedDay)}</dd>
                </div>
              ) : null}
              {selectedOverlayHasPlannedSchedule && !isSelectedPermission ? (
                <div>
                  <dt>Horario planificado</dt>
                  <dd>
                    {buildReadableShiftSchedule({
                      dayType: "workday",
                      startTime: selectedOverlayRaw.plannedStartTime || "",
                      lunchStartTime: selectedOverlayRaw.plannedLunchStartTime || "",
                      lunchEndTime: selectedOverlayRaw.plannedLunchEndTime || "",
                      endTime: selectedOverlayRaw.plannedEndTime || "",
                      lunchDurationMinutes: Number(selectedOverlayRaw.plannedLunchDurationMinutes) || 0,
                    })}
                  </dd>
                </div>
              ) : null}
              {selectedOverlay.notes ? (
                <div>
                  <dt>Notas</dt>
                  <dd>{selectedOverlay.notes}</dd>
                </div>
              ) : null}
            </dl>
            {selectedOverlay.kind === "exception"
              && (
                selectedOverlay.raw?.canDelete === true
                || canDeleteAnyPendingExceptions
              )
              && (
                selectedOverlay.raw?.resolution === "pending"
                || selectedOverlay.raw?.status === "open"
              ) ? (
                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.overlayDeleteButton}
                    onClick={() => setExceptionToDelete(selectedOverlay)}
                    disabled={isPending}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    Eliminar
                  </button>
                </div>
              ) : null}
          </div>
        ) : null}
      </FloatingModal>
      <FloatingModal
        isOpen={Boolean(adjustmentTarget)}
        eyebrow={adjustmentTarget?.dateKey || "Dia"}
        title="Crear ajuste planificado"
        isPending={isAdjustmentSaving}
        onClose={closeAdjustmentModal}
      >
        {adjustmentTarget ? (
          <div className={styles.adjustmentModal}>
            <div className={styles.adjustmentContext}>
              <span className={styles.adjustmentEmployee}>{adjustmentTarget.employee.fullName}</span>
              <span>{formatShiftLabel(adjustmentTarget.day)}</span>
            </div>
            <AutocompleteSelect
              label="Tipo de ajuste"
              className={styles.adjustmentSelect}
              value={adjustmentCategoryValue}
              onChange={(nextKind) => updateAdjustmentField(
                "kind",
                nextKind === "permission" ? "permission_partial" : nextKind || PLANNED_ADJUSTMENT_TYPES[0].value,
              )}
              options={PLANNED_ADJUSTMENT_CATEGORY_OPTIONS}
              placeholder="Seleccionar ajuste"
              searchPlaceholder="Buscar ajuste"
              emptyText="No hay ajustes con ese criterio"
            />
            {isPermissionAdjustment ? (
              <AutocompleteSelect
                label="Duración del permiso"
                className={styles.adjustmentSelect}
                value={adjustmentForm.kind}
                onChange={(permissionKind) => updateAdjustmentField("kind", permissionKind || "permission_partial")}
                options={PERMISSION_DURATION_OPTIONS}
                placeholder="Seleccionar duración"
                searchPlaceholder="Buscar duración"
                emptyText="No hay duraciones con ese criterio"
              />
            ) : null}
            {selectedAdjustmentType?.requiresTimeRange ? (
              <div className={styles.adjustmentGrid}>
                <TextInput className={styles.adjustmentTimeField} label="Desde" type="time" separator="H" value={adjustmentForm.startTime} onChange={(event) => updateAdjustmentField("startTime", event.target.value)} />
                <TextInput className={styles.adjustmentTimeField} label="Hasta" type="time" separator="H" value={adjustmentForm.endTime} onChange={(event) => updateAdjustmentField("endTime", event.target.value)} />
              </div>
            ) : null}
            {supportsCustomSchedule ? (
              <label className={styles.customScheduleToggle}>
                <input
                  type="checkbox"
                  checked={adjustmentForm.useCustomSchedule}
                  onChange={(event) => updateAdjustmentField("useCustomSchedule", event.target.checked)}
                  disabled={isAdjustmentSaving}
                />
                <span>Usar horario personalizado</span>
              </label>
            ) : null}
            {selectedAdjustmentType?.requiresSchedule ? (
              <div className={styles.templateSelectRow}>
                <AutocompleteSelect
                  label="Plantilla de horario"
                  className={styles.templateScheduleSelect}
                  value={adjustmentForm.scheduleTemplateId}
                  onChange={(templateId) => updateAdjustmentField("scheduleTemplateId", templateId)}
                  options={scheduleTemplateOptions}
                  placeholder="Seleccionar plantilla"
                  searchPlaceholder="Buscar plantilla"
                  emptyText="No hay plantillas con ese criterio"
                  disabled={isAdjustmentSaving || (supportsCustomSchedule && adjustmentForm.useCustomSchedule)}
                />
                <button
                  type="button"
                  className={styles.templateCreateButton}
                  onClick={openQuickTemplateModal}
                  aria-label="Crear plantilla de horario"
                  title="Crear plantilla"
                  disabled={isAdjustmentSaving || (supportsCustomSchedule && adjustmentForm.useCustomSchedule)}
                >
                  <Plus size={18} />
                </button>
              </div>
            ) : null}
            {showsCustomScheduleFields ? (
              <div className={styles.adjustmentGrid}>
                <TextInput className={styles.adjustmentTimeField} label="Entrada planificada" type="time" separator="H" value={adjustmentForm.plannedStartTime} onChange={(event) => updateAdjustmentField("plannedStartTime", event.target.value)} />
                <TextInput className={styles.adjustmentTimeField} label="Fin manana" type="time" separator="H" value={adjustmentForm.plannedLunchStartTime} onChange={(event) => updateAdjustmentField("plannedLunchStartTime", event.target.value)} />
                <TextInput className={styles.adjustmentTimeField} label="Inicio tarde" type="time" separator="H" value={adjustmentForm.plannedLunchEndTime} onChange={(event) => updateAdjustmentField("plannedLunchEndTime", event.target.value)} />
                <TextInput className={styles.adjustmentTimeField} label="Salida planificada" type="time" separator="H" value={adjustmentForm.plannedEndTime} onChange={(event) => updateAdjustmentField("plannedEndTime", event.target.value)} />
              </div>
            ) : null}
            <label className={styles.adjustmentTextareaField}>
              <span className={styles.adjustmentTextareaLabel}>Nota</span>
              <textarea value={adjustmentForm.notes} onChange={(event) => updateAdjustmentField("notes", event.target.value)} />
            </label>
            <div className={styles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={closeAdjustmentModal} disabled={isAdjustmentSaving}>Cancelar</button>
              <button type="button" className={styles.primaryButton} onClick={saveAdjustment} disabled={isAdjustmentSaving}>
                <Save size={16} />
                {isAdjustmentSaving ? "Creando..." : "Crear ajuste"}
              </button>
            </div>
          </div>
        ) : null}
      </FloatingModal>
      <FloatingModal
        isOpen={isQuickTemplateModalOpen}
        eyebrow="Plantilla"
        title="Crear plantilla de horario"
        isPending={isQuickTemplateSaving}
        onClose={closeQuickTemplateModal}
      >
        <div className={styles.quickTemplateModal}>
          <div className={styles.adjustmentGrid}>
            <TextInput className={styles.adjustmentTimeField} label="Entrada" type="time" separator="H" value={quickTemplateForm.startTime} onChange={(event) => updateQuickTemplateField("startTime", event.target.value)} />
            <TextInput className={styles.adjustmentTimeField} label="Salida" type="time" separator="H" value={quickTemplateForm.endTime} onChange={(event) => updateQuickTemplateField("endTime", event.target.value)} />
          </div>
          <label className={styles.quickTemplateToggle}>
            <input
              type="checkbox"
              checked={quickTemplateForm.hasLunch}
              onChange={(event) => updateQuickTemplateField("hasLunch", event.target.checked)}
            />
            <span>Incluye almuerzo</span>
          </label>
          {quickTemplateForm.hasLunch ? (
            <div className={styles.adjustmentGrid}>
              <TextInput className={styles.adjustmentTimeField} label="Fin manana" type="time" separator="H" value={quickTemplateForm.lunchStartTime} onChange={(event) => updateQuickTemplateField("lunchStartTime", event.target.value)} />
              <TextInput className={styles.adjustmentTimeField} label="Inicio tarde" type="time" separator="H" value={quickTemplateForm.lunchEndTime} onChange={(event) => updateQuickTemplateField("lunchEndTime", event.target.value)} />
            </div>
          ) : null}
          <label className={styles.adjustmentTextareaField}>
            <span className={styles.adjustmentTextareaLabel}>Nota</span>
            <textarea value={quickTemplateForm.notes} onChange={(event) => updateQuickTemplateField("notes", event.target.value)} />
          </label>
          <div className={styles.modalActions}>
            <button type="button" className={styles.secondaryButton} onClick={closeQuickTemplateModal} disabled={isQuickTemplateSaving}>Cancelar</button>
            <button type="button" className={styles.primaryButton} onClick={saveQuickTemplate} disabled={isQuickTemplateSaving}>
              <Save size={16} />
              Guardar plantilla
            </button>
          </div>
        </div>
      </FloatingModal>

      <section className={`${styles.toolbar} ${styles.plannerEntrance}`}>
        <div className={styles.monthSliderField}>
          <span className={styles.monthSliderLabel}>Mes</span>
          <div className={styles.monthSlider}>
            <button
              type="button"
              disabled={isPending}
              aria-label={`Ir al mes anterior desde ${monthLabel}`}
              title="Mes anterior"
              onClick={() => navigateMonth(-1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <output aria-live="polite" aria-label={`Mes seleccionado: ${monthLabel}`}>
              {monthLabel}
            </output>
            <button
              type="button"
              disabled={isPending}
              aria-label={`Ir al mes siguiente desde ${monthLabel}`}
              title="Mes siguiente"
              onClick={() => navigateMonth(1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <SelectInput
          label="Grupo"
          className={styles.groupSelect}
          labelClassName={styles.toolbarSelectLabel}
          controlClassName={styles.toolbarSelectControl}
          selectClassName={styles.toolbarSelectButton}
          value={groupId}
          disabled={isPending || isWorkGroupLocked}
          onChange={(event) => {
            const nextGroupId = event.target.value;
            const nextGroup = workGroups.find((group) => group.id === nextGroupId);

            setViewedVersionKey("");
            setGroupId(nextGroupId);
            setBranchCode(nextGroup?.branchCode || "");
            replaceFilters({
              groupId: nextGroupId,
            });
          }}
        >
          {!isWorkGroupLocked ? <option value="">Seleccionar grupo</option> : null}
          {workGroupOptions.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} ({group.memberCount})
            </option>
          ))}
        </SelectInput>
      </section>

      {!hasPlanningScope ? (
        <section className={`${styles.scopeEmptyState} ${styles.plannerEntrance}`}>
          <strong>Selecciona un grupo para empezar</strong>
          <span>
            Los grupos definen quien planifica a quien y mantienen el historial semanal separado por equipo.
          </span>
        </section>
      ) : null}

      {shouldShowScopedLoading ? (
        <PlannerLoadingScene
          title="Actualizando la semana"
          description="Organizando horarios y novedades del grupo seleccionado"
        />
      ) : null}

      {hasPlanningScope && !shouldShowScopedLoading ? (
        <>
      <section className={`${styles.weekToolbar} ${styles.plannerEntrance}`}>
        <div className={styles.weekTabs}>
          {weekOptions.map((week, index) => (
            <button
              key={week.weekStartKey}
              type="button"
              className={index === resolvedSelectedWeekIndex ? styles.activeWeek : ""}
              onClick={() => selectWeekIndex(index)}
            >
              <strong>{week.label}</strong>
              <span>{week.rangeLabel}</span>
            </button>
          ))}
        </div>
      </section>

      {canPasteSchedules || canManageSchedules || canExportSchedule || canCreateQuickTemplates ? <section className={`${styles.importPanel} ${styles.plannerEntrance}`}>
        <div className={styles.importActions}>
          <div className={styles.importActionGroup}>
            {canCreateQuickTemplates ? (
              <button
                type="button"
                onClick={openBlankQuickTemplateModal}
                disabled={isQuickTemplateSaving}
              >
                <Plus size={16} />
                Crear plantilla
              </button>
            ) : null}
            {canExportSchedule ? (
              <button
                type="button"
                onClick={downloadScheduleExcel}
                disabled={isExportingSchedule || isPending || !filteredEmployees.length}
              >
                {isExportingSchedule ? <RefreshCw size={16} /> : <Download size={16} />}
                {isExportingSchedule ? "Descargando..." : "Exportar"}
              </button>
            ) : null}
            {canPasteSchedules ? (
              <button type="button" onClick={pasteClipboardSchedule} disabled={isScheduleReadOnly}>
                <ClipboardPaste size={16} />
                Pegar tabla
              </button>
            ) : null}
          </div>
        </div>
      </section> : null}

      <FloatingModal
        isOpen={isManualPasteOpen}
        eyebrow="Importar horarios"
        title="Pegar tabla desde Excel"
        onClose={() => setIsManualPasteOpen(false)}
      >
        <div className={styles.adjustmentModal}>
          <label className={styles.adjustmentTextareaField}>
            <span className={styles.adjustmentTextareaLabel}>Contenido de la tabla</span>
            <textarea
              autoFocus
              rows={10}
              value={manualClipboardText}
              onChange={(event) => setManualClipboardText(event.target.value)}
              placeholder="Copia las filas en Excel y pégalas aquí con Ctrl+V o Cmd+V."
            />
          </label>
          <div className={styles.modalActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => setIsManualPasteOpen(false)}>
              Cancelar
            </button>
            <button type="button" className={styles.primaryButton} onClick={processManualClipboardSchedule} disabled={!manualClipboardText.trim()}>
              <ClipboardPaste size={16} />
              Aplicar tabla
            </button>
          </div>
        </div>
      </FloatingModal>

      {showSummaries ? <section className={`${styles.summaryGrid} ${styles.plannerEntrance}`}>
        <article>
          <span>Suplementarias aprox.</span>
          <strong>{formatDuration(summary.supplementaryMinutes)}</strong>
          <small>{formatMoney(summary.supplementaryAmount)} suplemento</small>
        </article>
        <article>
          <span>Horas extra aprox.</span>
          <strong>{formatDuration(summary.extraordinaryMinutes)}</strong>
          <small>{formatMoney(summary.extraordinaryAmount)} extraordinarias</small>
        </article>
        <button
          type="button"
          className={summary.extraCostAmount ? styles.summaryInfoCardActive : ""}
          onClick={() => setIsCostModalOpen(true)}
          disabled={!variableCostDetails.length}
        >
          <span>Costo variable aprox.</span>
          <strong>{formatMoney(summary.extraCostAmount)}</strong>
          <small>{summary.extraDayIndicators ? `${summary.extraDayIndicators} dia extra` : "Sin dias extra"}</small>
        </button>
      </section> : null}

      {weeklyApprovalState.isApproved ? (
        <div className={`${styles.versionPreviewBar} ${styles.versionPreviewApproved}`}>
          <div>
            <LockKeyhole size={16} aria-hidden="true" />
            <span>
              <strong>{approvedHistoryVersion ? `Planificacion aprobada · v${approvedHistoryVersion.versionNumber}` : "Planificacion aprobada"}</strong>
              <small>La tabla principal esta disponible en modo de consulta</small>
            </span>
          </div>
          {canApprovePlanning ? (
            <button
              type="button"
              className={styles.unlockPlanningButton}
              onClick={() => setIsUnlockConfirmOpen(true)}
              disabled={isPending}
            >
              <LockOpen size={15} aria-hidden="true" />
              Desbloquear
            </button>
          ) : canRequestPlanningUnlock ? (
            <button
              type="button"
              className={styles.unlockPlanningButton}
              onClick={() => setIsUnlockConfirmOpen(true)}
              disabled={isPending || Boolean(currentUnlockRequest)}
              title={currentUnlockRequest ? "La solicitud está pendiente de revisión" : "Solicitar desbloqueo"}
            >
              {currentUnlockRequest ? <RefreshCw size={15} aria-hidden="true" /> : <LockOpen size={15} aria-hidden="true" />}
              {currentUnlockRequest ? "Solicitud pendiente" : "Solicitar desbloqueo"}
            </button>
          ) : null}
        </div>
      ) : null}

      <section className={`${styles.tablePanel} ${styles.plannerEntrance}`}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Empleado</th>
                {weekDateKeys.map((dateKey) => {
                  const holiday = holidaysByDate.get(dateKey);

                  return (
                    <th
                      key={dateKey}
                      className={`${styles.dayColumn} ${dateKey.startsWith(`${monthKey}-`) ? "" : styles.adjacentMonthDay} ${holiday ? styles.holidayDay : ""}`}
                      title={holiday ? holiday.name || "Feriado" : undefined}
                    >
                      <span>{DAY_LABELS[getDayOfWeek(dateKey)]}</span>
                      <small>{formatPlannerDay(dateKey, monthKey)}</small>
                      {holiday ? <em>Feriado</em> : null}
                    </th>
                  );
                })}
                <th>Trabajados</th>
                {showFinancials ? <th>Impacto aprox.</th> : null}
                {showHours ? <><th>HL</th><th>HS</th><th>HE</th></> : null}
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => {
                const workedCount = weekDateKeys.filter((dateKey) =>
                  isEmployeeActiveOnDate(employee, dateKey) &&
                  isWorkShift(effectiveDraftDays[employee.id]?.[dateKey] || "off"),
                ).length;
                const weekRole = weekRoleForEmployee(employee, selectedWeek.weekStartKey);
                const employeeShiftOptions = getShiftOptionsForEmployee(employee);
                const employeeCost = planningCostByEmployee.get(employee.id);
                const isDismissed = isEmployeeDismissedInMonth(employee, monthKey);
                const dismissalTitle = isDismissed ? employeeDismissalLabel(employee) : undefined;

                return (
                  <tr
                    key={employee.id}
                    className={`${canOpenMonthlyDetail ? styles.clickableRow : ""} ${isDismissed ? styles.dismissedRow : ""}`}
                    title={dismissalTitle || (canOpenMonthlyDetail ? "Doble click para abrir el detalle" : undefined)}
                    onDoubleClick={canOpenMonthlyDetail ? (event) => openEmployeeDetail(event, employee.id) : undefined}
                  >
                    <td data-label="Empleado">
                      <strong>{employee.fullName}</strong>
                      <small className={styles.employeeMeta}>
                        {weekRole.name || employee.roleName || "Sin cargo"}
                      </small>
                    </td>
                    {weekDateKeys.map((dateKey) => {
                      const isActiveForDate = isEmployeeActiveOnDate(employee, dateKey);
                      const overlay = overlaysByEmployeeDate.get(`${employee.id}|${dateKey}`);
                      const shiftKey = draftDays[employee.id]?.[dateKey] || "off";
                      const blocksScheduleInput = overlayBlocksScheduleInput(overlay);
                      const isException = overlay?.kind === "exception";
                      const showSchedulePicker = isActiveForDate && (
                        isException || (!blocksScheduleInput && (!overlay || shiftKey !== "off"))
                      );
                      const overlayLabel = overlay?.shortLabel || overlay?.typeLabel || "Ajuste";
                      const startDateKey = dateKeyFromValue(employee.employmentStartDate);

                      return (
                        <td
                          key={dateKey}
                          className={`${dateKey.startsWith(`${monthKey}-`) ? "" : styles.adjacentMonthCell} ${isActiveForDate ? "" : styles.unavailableCell}`}
                          data-label={`${DAY_LABELS[getDayOfWeek(dateKey)]} ${formatPlannerDay(dateKey, monthKey)}`}
                        >
                          {!isActiveForDate ? (
                            <span className={styles.unavailablePill}>
                              {startDateKey && startDateKey > dateKey ? `Ingreso ${startDateKey.slice(8)}/${startDateKey.slice(5, 7)}` : "No activo"}
                            </span>
                          ) : (
                          <div className={`${styles.cellScheduleRow} ${showSchedulePicker ? "" : styles.cellScheduleRowIconOnly}`}>
                            {showSchedulePicker ? (
                              <ShiftPicker
                                value={shiftKey}
                                options={employeeShiftOptions}
                                onChange={(nextShiftKey) => setCell(employee.id, dateKey, nextShiftKey)}
                                disabled={isScheduleReadOnly || !canManageSchedules}
                              />
                            ) : null}
                            {!overlay && canCreateAdjustments && !isScheduleReadOnly ? (
                              <button
                                type="button"
                                className={styles.cellAdjustButton}
                                onClick={() => openAdjustmentModal(employee, dateKey)}
                                title="Crear ajuste o novedad para este dia"
                                aria-label="Crear ajuste o novedad"
                              >
                                <Plus size={14} />
                              </button>
                            ) : null}
                            {overlay ? (
                              <button
                                type="button"
                                className={`${styles.overlayIndicatorButton} ${overlay.kind === "vacation" ? styles.overlayVacation : styles.overlayException}`}
                                onClick={() => setSelectedOverlay({
                                  ...overlay,
                                  employeeName: employee.fullName,
                                  indicatedDay: dayFromDraft(dateKey, shiftKey, shiftOptionsByKey),
                                })}
                                title={overlay.title || overlayLabel || "Ver ajuste"}
                                aria-label={overlay.title || overlayLabel || "Ver ajuste"}
                              >
                                {overlay.kind === "vacation" ? <CalendarDays size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
                                {overlay.kind === "vacation" ? <span>{overlayLabel}</span> : null}
                              </button>
                            ) : null}
                          </div>
                          )}
                          {!overlay && isActiveForDate && shouldShowDayNote(
                            shiftKey,
                            displayedDayNotes[employee.id]?.[dateKey],
                          ) ? (
                            <small className={styles.dayNote}>{displayedDayNotes[employee.id][dateKey]}</small>
                          ) : null}
                        </td>
                      );
                    })}
                    <td data-label="Trabajados">
                      <span className={workedCount <= 5 ? styles.okPill : styles.warnPill}>
                        {workedCount} dias
                      </span>
                    </td>
                    {showFinancials ? <td data-label="Impacto aprox.">
                      <div className={styles.costCell}>
                        <strong>{formatMoney(employeeCost?.totalAmount || 0)}</strong>
                      </div>
                    </td> : null}
                    {showHours ? <><td data-label="HL">
                      <div className={styles.hoursCell}>
                        <strong>{formatDuration(employeeCost?.laborableMinutes || 0)}</strong>
                      </div>
                    </td>
                    <td data-label="HS">
                      <div className={styles.hoursCell}>
                        <strong>{formatDuration(employeeCost?.supplementaryMinutes || 0)}</strong>
                      </div>
                    </td>
                    <td data-label="HE">
                      <div className={styles.hoursCell}>
                        <strong>{formatDuration(employeeCost?.extraordinaryMinutes || 0)}</strong>
                      </div>
                    </td></> : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className={styles.dailyTotalsRow}>
                <td data-label="Resumen">
                  <strong>Personal activo por dia</strong>
                  <span>Total de empleados con horario asignado</span>
                </td>
                {weekDateKeys.map((dateKey) => (
                  <td
                    key={dateKey}
                    className={dateKey.startsWith(`${monthKey}-`) ? "" : styles.adjacentMonthCell}
                    data-label={`${DAY_LABELS[getDayOfWeek(dateKey)]} ${formatPlannerDay(dateKey, monthKey)}`}
                  >
                    <strong>{activeEmployeesByDay.get(dateKey) || 0}</strong>
                    <span>empleados</span>
                  </td>
                ))}
                <td data-label="Trabajados">
                  <strong>{[...activeEmployeesByDay.values()].reduce((total, count) => total + count, 0)}</strong>
                  <span>turnos</span>
                </td>
                {showFinancials ? <td data-label="Impacto aprox.">
                  <div className={styles.costCell}>
                    <strong>{formatMoney(summary.extraCostAmount)}</strong>
                  </div>
                </td> : null}
                {showHours ? <><td data-label="HL">
                  <div className={styles.hoursCell}>
                    <strong>{formatDuration(summary.laborableMinutes)}</strong>
                  </div>
                </td>
                <td data-label="HS">
                  <div className={styles.hoursCell}>
                    <strong>{formatDuration(summary.supplementaryMinutes)}</strong>
                  </div>
                </td>
                <td data-label="HE">
                  <div className={styles.hoursCell}>
                    <strong>{formatDuration(summary.extraordinaryMinutes)}</strong>
                  </div>
                </td></> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className={`${styles.bottomActions} ${styles.plannerEntrance}`}>
        {canManageSchedules && !isScheduleReadOnly ? <button type="button" onClick={saveWeek} disabled={isPending || !hasDraftChanges || !filteredEmployees.length}>
          {isPending ? <RefreshCw size={16} /> : <Save size={16} />}
          {isPending ? "Guardando..." : "Guardar"}
        </button> : null}
        {canApprovePlanning && !isScheduleReadOnly && !weeklyApprovalState.latestHistory?.isApproved ? (
          <button
            type="button"
            onClick={() => setIsApprovalConfirmOpen(true)}
            disabled={isPending || hasDraftChanges || !filteredEmployees.length || !weeklyApprovalState.latestHistory}
            title={hasDraftChanges ? "Guarda los cambios antes de aprobar" : "Aprobar planificacion semanal"}
          >
            {isPending ? <RefreshCw size={16} /> : <Check size={16} />}
            Aprobar
          </button>
        ) : null}
      </section>

      <ConfirmDialog
        isOpen={isApprovalConfirmOpen}
        title="Aprobar planificación semanal"
        message="Si apruebas esta planificación, ya no se podrá modificar. Verifica los horarios antes de continuar."
        confirmLabel="Sí, aprobar"
        cancelLabel="Volver a revisar"
        tone="warning"
        isPending={isPending}
        onCancel={() => setIsApprovalConfirmOpen(false)}
        onConfirm={approveWeek}
      />

      <ConfirmDialog
        isOpen={isUnlockConfirmOpen}
        title={canApprovePlanning ? "Desbloquear planificación" : "Solicitar desbloqueo"}
        message={canApprovePlanning
          ? "La aprobación actual quedará como antecedente y la semana volverá a estar disponible para edición. Después deberás guardar una nueva versión y aprobarla nuevamente."
          : "La planificación continuará bloqueada hasta que un usuario autorizado revise y apruebe esta solicitud."}
        confirmLabel={canApprovePlanning ? "Desbloquear" : "Enviar solicitud"}
        cancelLabel="Cancelar"
        tone="warning"
        layout="form"
        isPending={isPending}
        confirmDisabled={unlockReason.trim().length < 10}
        onCancel={() => {
          setIsUnlockConfirmOpen(false);
          setUnlockReason("");
        }}
        onConfirm={canApprovePlanning ? unlockWeek : requestWeekUnlock}
      >
        <label className={styles.unlockReasonField}>
          <span className={styles.unlockReasonHeader}>
            <strong>Motivo del desbloqueo</strong>
            <small>{unlockReason.trim().length}/500</small>
          </span>
          <textarea
            value={unlockReason}
            onChange={(event) => setUnlockReason(event.target.value)}
            placeholder="Explica por qué es necesario modificar la planificación aprobada"
            rows={4}
            maxLength={500}
            autoFocus
            disabled={isPending}
          />
          <small className={styles.unlockReasonHint}>Escribe al menos 10 caracteres.</small>
        </label>
      </ConfirmDialog>

      <FloatingModal
        isOpen={Boolean(viewedHistoryVersion)}
        eyebrow="Historial de planificacion · Solo vista"
        title={viewedHistoryVersion ? `Calendario de la v${viewedHistoryVersion.versionNumber}` : "Calendario de version"}
        isFullscreen
        onClose={() => setViewedVersionKey("")}
      >
        {viewedHistoryVersion ? (
          <VersionSchedulePreview
            version={viewedHistoryVersion}
            employees={filteredEmployees}
            weekDateKeys={weekDateKeys}
            monthKey={monthKey}
            overlaysByEmployeeDate={overlaysByEmployeeDate}
          />
        ) : null}
      </FloatingModal>

      {weeklyApprovalState.historyEntries.length ? (
        <section className={`${styles.versionHistory} ${styles.plannerEntrance}`}>
          <div className={styles.versionHistoryHeader}>
            <span>Historial de versiones</span>
            <strong>{weeklyApprovalState.historyEntries.length} guardado{weeklyApprovalState.historyEntries.length === 1 ? "" : "s"}</strong>
          </div>
          <div className={styles.versionList}>
            {weeklyApprovalState.historyEntries.slice(0, 8).map((entry, index) => {
              const isLatestVersion = index === 0;

              return (
                <article
                  key={entry.versionKey || `${entry.savedAt || "sin-fecha"}-${entry.savedBy || "sistema"}-${index}`}
                  className={`${entry.isApproved ? styles.approvedVersionRow : ""} ${entry.wasApproved && !entry.isApproved ? styles.previouslyApprovedVersionRow : ""} ${viewedHistoryVersion?.versionKey === entry.versionKey ? styles.activeVersionRow : ""}`}
                >
                  <button
                    type="button"
                    className={styles.versionViewButton}
                    disabled={isLatestVersion}
                    aria-pressed={viewedHistoryVersion?.versionKey === entry.versionKey}
                    onClick={() => setViewedVersionKey(entry.versionKey)}
                  >
                  <span className={styles.versionMainLine}>
                    <strong>v{entry.versionNumber}</strong>
                    <time dateTime={entry.savedAt ? String(entry.savedAt) : undefined}>
                      {formatEcuadorDateTimeLabel(entry.savedAt)}
                    </time>
                  </span>
                  <span className={styles.versionAuthor}>
                    <small>Creada por</small>
                    <strong>{entry.savedBy || "Sistema"}</strong>
                  </span>
                  <span className={styles.versionRowStatus}>
                    {entry.isApproved ? <em className={styles.approvedVersionBadge}>Aprobada</em> : null}
                    {!entry.isApproved && entry.wasApproved ? (
                      <em className={styles.previouslyApprovedVersionBadge}>Aprobada anteriormente</em>
                    ) : null}
                    {!isLatestVersion ? (
                      <>
                        <Eye size={16} aria-hidden="true" />
                        <small>Ver</small>
                      </>
                    ) : null}
                  </span>
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
        </>
      ) : null}
    </div>
  );
}
