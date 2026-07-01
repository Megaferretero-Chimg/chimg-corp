"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Download, Info, RefreshCw, RotateCcw, Save, X } from "lucide-react";

import FloatingModal from "@/components/ui/FloatingModal";
import FloatingNotice from "@/components/ui/FloatingNotice";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { employeeDismissalLabel, isEmployeeActiveInMonth, isEmployeeDismissedInMonth } from "@/lib/employees";
import { planningModulePath } from "@/lib/modules/planning/routes";
import { getMonthWeekOptions } from "@/lib/planning/scheduleAssignments";
import styles from "./SchedulePlanner.module.scss";

const VARIABLE_SCHEDULE_AREA_CODES = new Set(["ALM", "BOD"]);
const DEFAULT_DAILY_BASE_HOURS = 8;
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
  const minutes = parseTimeToMinutes(value);

  if (minutes === null) {
    return "";
  }

  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}H${String(minutes % 60).padStart(2, "0")}`;
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
const IMPORT_SUMMARY_ROW_PATTERN = /^TOTAL\s+PERSONAL\b/i;
const TIME_RANGE_PATTERN = /\d{1,2}\s*(?::|h|H)?\s*\d{2}?\s*(?:-|–|—|a|A)\s*\d{1,2}/;
const RESERVED_SHIFT_KEYS = {
  vacation: "reserved|vacation",
  permission: "reserved|permission",
  salcedo: "reserved|salcedo",
};
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
  {
    key: RESERVED_SHIFT_KEYS.salcedo,
    label: "Salcedo",
    scheduleLabel: "Salcedo",
    shortLabel: "Salcedo",
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

function getPlanningOverlayMonthKeys(monthKey) {
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

async function fetchPlanningOverlays(monthKey) {
  const overlayPayloads = await Promise.all(getPlanningOverlayMonthKeys(monthKey).map(async (overlayMonthKey) => {
    const [exceptionsResponse, vacationsResponse] = await Promise.all([
      fetch(`/api/planning/exceptions?month=${overlayMonthKey}`),
      fetch(`/api/planning/vacations?month=${overlayMonthKey}`),
    ]);
    const [exceptionsPayload, vacationsPayload] = await Promise.all([
      exceptionsResponse.json(),
      vacationsResponse.json(),
    ]);

    if (!exceptionsResponse.ok) throw new Error(exceptionsPayload.error || "No se pudieron cargar las excepciones.");
    if (!vacationsResponse.ok) throw new Error(vacationsPayload.error || "No se pudieron cargar las vacaciones.");

    return {
      exceptions: exceptionsPayload.exceptions || [],
      vacations: vacationsPayload.vacations || [],
    };
  }));

  return {
    exceptions: dedupeById(overlayPayloads.flatMap((payload) => payload.exceptions)),
    vacations: dedupeById(overlayPayloads.flatMap((payload) => payload.vacations)),
  };
}

function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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
  return VARIABLE_SCHEDULE_AREA_CODES.has(String(employee?.areaCode || "").trim().toUpperCase());
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
  const normalizedName = normalizeText(name);

  if (!normalizedName) {
    return null;
  }

  return employees.find((employee) => normalizeText(employee.fullName) === normalizedName) || null;
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

  if (normalizedText === "SALCEDO") {
    return {
      shiftKey: RESERVED_SHIFT_KEYS.salcedo,
      status: "outside_work",
      label: "Salcedo",
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

function parseImportedDayHeader(header, monthKey) {
  const dayMatch = String(header || "").match(/\b(\d{1,2})\b/);

  if (!dayMatch) {
    return "";
  }

  return `${monthKey}-${String(Number(dayMatch[1])).padStart(2, "0")}`;
}

function isImportedDateHeaderRow(row) {
  const cells = Array.isArray(row) ? row.slice(1) : [];

  return Boolean(cells.length)
    && !String(row?.[0] || "").trim()
    && cells.every((cell) => {
      const value = String(cell || "").trim();

      return !value || /^(?:[1-9]|[12]\d|3[01])$/.test(value);
    });
}

function resolveImportedDateKey(cell, index, weekDateKeys, monthKey) {
  const visibleWeekDateKey = weekDateKeys[index] || "";
  const dayMatch = String(cell || "").match(/\b(\d{1,2})\b/);

  if (dayMatch && visibleWeekDateKey) {
    const importedDay = String(Number(dayMatch[1])).padStart(2, "0");

    if (visibleWeekDateKey.endsWith(`-${importedDay}`)) {
      return visibleWeekDateKey;
    }
  }

  const parsedDateKey = parseImportedDayHeader(cell, monthKey);

  return weekDateKeys.includes(parsedDateKey) ? parsedDateKey : visibleWeekDateKey;
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

function looksLikeImportedScheduleCell(value) {
  const normalizedValue = normalizeText(value);

  return Boolean(normalizedValue)
    && (
      TIME_RANGE_PATTERN.test(String(value || ""))
      || normalizedValue === "LIBRE"
      || normalizedValue === "VACACIONES"
      || normalizedValue === "PERMISO"
      || normalizedValue === "SALCEDO"
      || REST_CELL_PATTERN.test(String(value || ""))
    );
}

function looksLikeImportedEmployeeName(value) {
  const normalizedName = normalizeText(value);

  return /^[A-Z0-9 ]+$/.test(normalizedName)
    && normalizedName.split(" ").length >= 2
    && !TIME_RANGE_PATTERN.test(String(value || ""));
}

function repairMultilineScheduleRows(rows, employees) {
  const repairedRows = [];

  rows.forEach((row) => {
    const firstCell = row[0] || "";
    const startsEmployeeRow = Boolean(findEmployeeForImport(firstCell, employees));
    const startsUnmatchedEmployeeRow = !startsEmployeeRow
      && row.length > 1
      && looksLikeImportedEmployeeName(firstCell)
      && row.slice(1).some(looksLikeImportedScheduleCell);
    const startsSummaryRow = IMPORT_SUMMARY_ROW_PATTERN.test(firstCell);
    const startsHeaderRow = !repairedRows.length;

    if (startsHeaderRow || startsEmployeeRow || startsUnmatchedEmployeeRow || startsSummaryRow) {
      repairedRows.push([...row]);
      return;
    }

    const previousRow = repairedRows[repairedRows.length - 1];

    if (!previousRow) {
      repairedRows.push([...row]);
      return;
    }

    row.forEach((cell, index) => {
      if (!cell) return;

      const targetIndex = 1 + index;
      previousRow[targetIndex] = previousRow[targetIndex]
        ? `${previousRow[targetIndex]}\n${cell}`
        : cell;
    });
  });

  return repairedRows;
}

function buildClipboardSchedulePreview(text, employees, weekDateKeys, monthKey) {
  const rows = repairMultilineScheduleRows(
    parseClipboardRows(text),
    employees,
  );

  if (!rows.length) {
    return {
      rows: [],
      stats: { matched: 0, unmatched: 0, shifts: 0, rests: 0, notes: 0 },
    };
  }

  const firstRowHasEmployee = Boolean(findEmployeeForImport(rows[0]?.[0] || "", employees));
  const hasHeader = !firstRowHasEmployee;
  const hasDateHeaderRow = hasHeader && isImportedDateHeaderRow(rows[1]);
  const headerRowsCount = hasHeader ? (hasDateHeaderRow ? 2 : 1) : 0;
  const dateHeaderRow = hasDateHeaderRow ? rows[1] : rows[0];
  const dataRows = rows.slice(headerRowsCount).filter((row) =>
    !IMPORT_SUMMARY_ROW_PATTERN.test(row[0] || ""),
  );
  const dateKeys = hasHeader
    ? dateHeaderRow.slice(1).map((cell, index) => resolveImportedDateKey(cell, index, weekDateKeys, monthKey))
    // Tables without headers are pasted in Monday-to-Sunday order for the selected visible week.
    : weekDateKeys;
  const parsedRows = dataRows.map((row) => {
    const sourceName = row[0] || "";
    const employee = findEmployeeForImport(sourceName, employees);
    const cells = dateKeys
      .map((dateKey, index) => ({
        dateKey,
        rawValue: row[index + 1] || "",
        ...parseShiftCell(row[index + 1] || ""),
      }))
      .filter((cell) => Boolean(cell.dateKey));

    return {
      sourceName,
      employee,
      cells,
    };
  });
  const stats = parsedRows.reduce((result, row) => {
    if (row.employee) {
      result.matched += 1;
    } else {
      result.unmatched += 1;
    }

    row.cells.forEach((cell) => {
      if (cell.status === "shift") result.shifts += 1;
      if (cell.status === "rest" || cell.status === "empty") result.rests += 1;
      if (["note", "permission", "outside_work"].includes(cell.status)) result.notes += 1;
    });

    return result;
  }, { matched: 0, unmatched: 0, shifts: 0, rests: 0, notes: 0 });

  return { rows: parsedRows, stats };
}

function dayToShiftKey(day, shiftOptions = FALLBACK_SHIFT_OPTIONS) {
  const operationalNote = normalizeText(day?.operationalNote || "");

  if (operationalNote === "SALCEDO") {
    return RESERVED_SHIFT_KEYS.salcedo;
  }

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

function buildPlannerUrl(filters) {
  const params = new URLSearchParams();
  const weekIndex = Number(filters.weekIndex);

  if (filters.monthKey) params.set("month", filters.monthKey);
  if (filters.branchCode) params.set("branchCode", filters.branchCode);
  if (filters.areaCode) params.set("areaCode", filters.areaCode);
  if (filters.roleCode) params.set("roleCode", filters.roleCode);
  if (Number.isInteger(weekIndex) && weekIndex > 0) params.set("week", String(weekIndex + 1));

  const query = params.toString();

  return `${planningModulePath("/planning/monthly")}${query ? `?${query}` : ""}`;
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

  if (shiftKey === RESERVED_SHIFT_KEYS.permission || shiftKey === RESERVED_SHIFT_KEYS.salcedo) {
    const note = shiftKey === RESERVED_SHIFT_KEYS.salcedo ? "SALCEDO" : "PERMISO";

    return {
      dateKey,
      dayType: "off_day",
      startTime: "",
      endTime: "",
      lunchDurationMinutes: 0,
      lunchStartTime: "",
      lunchEndTime: "",
      authorizedExtraMinutes: 0,
      operationalNote: note,
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
  dailyBaseHours = DEFAULT_DAILY_BASE_HOURS,
  regularWorkdayLimit = 5,
}) {
  const salary = Number(employee?.salary) || 0;
  const hourlyDivisor = Math.max(Number(dailyBaseHours) || DEFAULT_DAILY_BASE_HOURS, 1) * 30;
  const hourlyRate = salary > 0 ? salary / hourlyDivisor : 0;
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

    workedDays += 1;

    const netMinutes = workedNetMinutes(shift);
    const baseMinutes = Math.max((Number(dailyBaseHours) || DEFAULT_DAILY_BASE_HOURS) * 60, 0);

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

function applyWeeklyExtraDays(days, regularWorkdayLimit = 5, dailyBaseMinutes = DEFAULT_DAILY_BASE_HOURS * 60) {
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

function getReservedOperationalNote(shiftKey) {
  if (shiftKey === RESERVED_SHIFT_KEYS.salcedo) return "SALCEDO";
  if (shiftKey === RESERVED_SHIFT_KEYS.permission) return "PERMISO";

  return "";
}

function shouldShowDayNote(shiftKey, note) {
  const normalizedNote = normalizeText(note);

  if (!normalizedNote) return false;
  if (shiftKey === RESERVED_SHIFT_KEYS.salcedo && normalizedNote === "SALCEDO") return false;
  if (shiftKey === RESERVED_SHIFT_KEYS.permission && normalizedNote === "PERMISO") return false;

  return true;
}

function cleanImportedNote(note) {
  return String(note || "").replace(/^IMPORTADO DESDE HORARIO:\s*/i, "").trim();
}

function isSalcedoOverlay(overlay) {
  return [
    overlay?.raw?.destination,
    cleanImportedNote(overlay?.raw?.notes),
    overlay?.shortLabel,
    overlay?.title,
  ].some((value) => normalizeText(value) === "SALCEDO");
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

  exceptions.forEach((exception) => {
    getDateRangeKeys(exception.dateKey, exception.endDateKey || exception.dateKey).forEach((dateKey) => {
      const key = `${exception.employeeId}|${dateKey}`;
      const current = byEmployeeDate.get(key);

      if (current?.priority > 1) return;

      const importedLabel = cleanImportedNote(exception.notes);
      const shortLabel = exception.destination || exception.resolutionNotes || importedLabel || exception.typeLabel || "Excepcion";

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

function applyPlanningOverlaysToDraftDays({ draftDays, employees, weekDateKeys, overlaysByEmployeeDate }) {
  const next = {};

  employees.forEach((employee) => {
    const employeeDays = { ...(draftDays[employee.id] || {}) };

    weekDateKeys.forEach((dateKey) => {
      const overlay = overlaysByEmployeeDate.get(`${employee.id}|${dateKey}`);

      if (!overlay) return;

      if (overlay.kind === "vacation") {
        employeeDays[dateKey] = RESERVED_SHIFT_KEYS.vacation;
        return;
      }

      employeeDays[dateKey] = isSalcedoOverlay(overlay)
        ? RESERVED_SHIFT_KEYS.salcedo
        : OFF_SHIFT_OPTION.key;
    });

    next[employee.id] = employeeDays;
  });

  return next;
}

function isManagementRole(role) {
  const text = `${role?.code || ""} ${role?.name || ""}`.toUpperCase();

  return text.includes("JEF");
}

function ShiftPicker({ value, options, onChange }) {
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
        className={styles.shiftPickerButton}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={selectedShift.scheduleLabel || selectedShift.label}
        onClick={() => {
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

export default function SchedulePlanner({ initialFilters = {} }) {
  const router = useRouter();
  const [monthKey, setMonthKey] = useState(initialFilters.month || currentMonthKey());
  const [branchCode, setBranchCode] = useState(initialFilters.branchCode || "");
  const [areaCode, setAreaCode] = useState(initialFilters.areaCode || "");
  const [roleCode, setRoleCode] = useState(initialFilters.roleCode || "");
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [roles, setRoles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [laborRules, setLaborRules] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [vacations, setVacations] = useState([]);
  const [draftDays, setDraftDays] = useState({});
  const [draftWeekRoles, setDraftWeekRoles] = useState({});
  const [draftDayRoles, setDraftDayRoles] = useState({});
  const [draftDayNotes, setDraftDayNotes] = useState({});
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  const [clearScheduleTargets, setClearScheduleTargets] = useState([]);
  const [clipboardScheduleText, setClipboardScheduleText] = useState("");
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(() => parseWeekIndex(initialFilters.week));
  const [isCostModalOpen, setIsCostModalOpen] = useState(false);
  const [selectedOverlay, setSelectedOverlay] = useState(null);
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
  const maxWeekIndex = Math.max(weekOptions.length - 1, 0);
  const resolvedSelectedWeekIndex = Math.min(Math.max(selectedWeekIndex, 0), maxWeekIndex);
  const selectedWeek = weekOptions[resolvedSelectedWeekIndex] || weekOptions[0];
  const weekDateKeys = useMemo(
    () => (selectedWeek ? getWeekDateKeys(selectedWeek.weekStartKey) : []),
    [selectedWeek],
  );
  const dailyBaseHours = useMemo(
    () => Math.max(Number(laborRules?.dailyBaseHours) || DEFAULT_DAILY_BASE_HOURS, 1),
    [laborRules],
  );

  const baseShiftOptions = useMemo(() => {
    const optionsByKey = new Map([
      [OFF_SHIFT_OPTION.key, OFF_SHIFT_OPTION],
      ...RESERVED_SHIFT_OPTIONS.map((shift) => [shift.key, shift]),
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

  const shiftOptions = useMemo(() => {
    return [...baseShiftOptions].sort((left, right) => {
      if (left.key === "off") return -1;
      if (right.key === "off") return 1;
      return `${left.startTime}${left.endTime}${left.lunchDurationMinutes}`.localeCompare(
        `${right.startTime}${right.endTime}${right.lunchDurationMinutes}`,
      );
    });
  }, [baseShiftOptions]);

  const shiftOptionsByKey = useMemo(
    () => new Map(shiftOptions.map((shift) => [shift.key, shift])),
    [shiftOptions],
  );

  const areaOptions = useMemo(() => {
    const options = new Map();

    employees.forEach((employee) => {
      if (!isEmployeeActiveInMonth(employee, monthKey) || !usesVariableSchedule(employee)) return;
      if (branchCode && employee.branchCode !== branchCode) return;
      if (employee.areaCode) options.set(employee.areaCode, employee.areaName || employee.areaCode);
    });

    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1], "es"));
  }, [branchCode, employees, monthKey]);

  const roleOptions = useMemo(() => {
    const options = new Map();

    employees.forEach((employee) => {
      if (!isEmployeeActiveInMonth(employee, monthKey) || !usesVariableSchedule(employee)) return;
      if (branchCode && employee.branchCode !== branchCode) return;
      if (areaCode && employee.areaCode !== areaCode) return;
      if (employee.roleCode) options.set(employee.roleCode, employee.roleName || employee.roleCode);
    });

    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1], "es"));
  }, [areaCode, branchCode, employees, monthKey]);

  const rolesByCode = useMemo(
    () => new Map(roles.map((role) => [role.code, role])),
    [roles],
  );

  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.code === branchCode) || null,
    [branchCode, branches],
  );
  const selectedAreaName = useMemo(
    () => areaOptions.find(([code]) => code === areaCode)?.[1] || "",
    [areaCode, areaOptions],
  );
  const hasPlanningScope = Boolean(branchCode && areaCode);
  const assignmentsScopeKey = `${monthKey}|${branchCode}|${areaCode}|${roleCode}`;
  const hasLoadedCurrentAssignments = loadedAssignmentsKey === assignmentsScopeKey;
  const shouldShowScopedLoading = hasPlanningScope && (isAssignmentsLoading || !hasLoadedCurrentAssignments);

  const filteredEmployees = useMemo(
    () =>
      employees.filter((employee) => {
        if (!hasPlanningScope) return false;
        if (!isEmployeeActiveInMonth(employee, monthKey) || !usesVariableSchedule(employee)) return false;
        if (employee.branchCode !== branchCode) return false;
        if (employee.areaCode !== areaCode) return false;
        return !roleCode || employee.roleCode === roleCode;
      }),
    [areaCode, branchCode, employees, hasPlanningScope, monthKey, roleCode],
  );

  const coverageRolesForEmployee = useCallback((employee) => {
    const assignments = Array.isArray(employee?.roleAssignments) ? employee.roleAssignments : [];
    const optionsByCode = new Map();

    assignments.forEach((assignment) => {
      const code = assignment.code || "";
      const role = rolesByCode.get(code);
      const optionAreaCode = role?.areaCode || assignment.areaCode || "";

      if (!code || (areaCode && optionAreaCode !== areaCode)) return;

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

      if (!areaCode || optionAreaCode === areaCode) {
        optionsByCode.set(employee.roleCode, {
          code: employee.roleCode,
          name: role?.name || employee.roleName || employee.roleCode,
          areaCode: optionAreaCode,
          areaName: role?.areaName || employee.areaName || "",
        });
      }
    }

    return [...optionsByCode.values()].sort((left, right) => left.name.localeCompare(right.name, "es"));
  }, [areaCode, rolesByCode]);

  const getShiftOptionsForEmployee = useCallback((employee) => {
    const optionsByKey = new Map([
      [OFF_SHIFT_OPTION.key, OFF_SHIFT_OPTION],
      ...RESERVED_SHIFT_OPTIONS.map((shift) => [shift.key, shift]),
    ]);
    const employeeAreaCode = employee?.areaCode || "";
    const roleCodes = new Set(
      coverageRolesForEmployee(employee)
        .map((role) => role.code)
        .filter(Boolean),
    );

    if (employee?.roleCode) {
      roleCodes.add(employee.roleCode);
    }

    templates.forEach((template) => {
      if (employeeAreaCode && template.areaCode !== employeeAreaCode) return;
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

  const clipboardPreview = useMemo(
    () => buildClipboardSchedulePreview(clipboardScheduleText, filteredEmployees, weekDateKeys, monthKey),
    [clipboardScheduleText, filteredEmployees, monthKey, weekDateKeys],
  );
  const hasClipboardSchedule = clipboardScheduleText.trim().length > 0;

  const overlaysByEmployeeDate = useMemo(() =>
    buildPlanningOverlayIndexes({ exceptions, vacations }),
  [exceptions, vacations]);

  const effectiveDraftDays = useMemo(() =>
    applyPlanningOverlaysToDraftDays({
      draftDays,
      employees: filteredEmployees,
      weekDateKeys,
      overlaysByEmployeeDate,
    }),
  [draftDays, filteredEmployees, overlaysByEmployeeDate, weekDateKeys]);

  const getWorkShiftKeysForEmployee = useCallback((employee) => {
    return getShiftOptionsForEmployee(employee)
      .filter((shift) => shift.dayType === "workday")
      .map((shift) => shift.key);
  }, [getShiftOptionsForEmployee]);

  const availableCoverageRoles = useMemo(() => {
    const optionsByCode = new Map();

    filteredEmployees.forEach((employee) => {
      coverageRolesForEmployee(employee).forEach((role) => {
        optionsByCode.set(role.code, role);
      });
    });

    return [...optionsByCode.values()].sort((left, right) => left.name.localeCompare(right.name, "es"));
  }, [coverageRolesForEmployee, filteredEmployees]);

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

  const managementRoleForEmployee = useCallback((employee) =>
    coverageRolesForEmployee(employee).find(isManagementRole) || null,
  [coverageRolesForEmployee]);

  const isPrimaryManagementEmployee = useCallback((employee) =>
    isManagementRole({ code: employee?.roleCode, name: employee?.roleName }),
  []);

  const coverageByDay = useMemo(() => {
    const result = new Map();

    weekDateKeys.forEach((dateKey) => {
      const roles = new Map();

      filteredEmployees.forEach((employee) => {
        const shiftKey = effectiveDraftDays[employee.id]?.[dateKey] || "off";

        if (!isWorkShift(shiftKey)) return;

        const dayRole = roleForEmployeeOnDate(employee, dateKey);
        const key = dayRole.code || "SIN_ROL";
        const current = roles.get(key) || {
          roleName: dayRole.name || key,
          count: 0,
        };

        roles.set(key, { ...current, count: current.count + 1 });
      });

      result.set(dateKey, roles);
    });

    return result;
  }, [effectiveDraftDays, filteredEmployees, roleForEmployeeOnDate, weekDateKeys]);

  const activeEmployeesByDay = useMemo(() =>
    new Map(weekDateKeys.map((dateKey) => [
      dateKey,
      filteredEmployees.filter((employee) =>
        isWorkShift(effectiveDraftDays[employee.id]?.[dateKey] || "off"),
      ).length,
    ])),
  [effectiveDraftDays, filteredEmployees, weekDateKeys]);

  const planningCostByEmployee = useMemo(() =>
    new Map(filteredEmployees.map((employee) => [
      employee.id,
      estimateWeeklyPlanningCost({
        employee,
        weekDateKeys,
        draftDays: effectiveDraftDays,
        shiftOptionsByKey,
        dailyBaseHours,
        regularWorkdayLimit: 5,
      }),
    ])),
  [dailyBaseHours, effectiveDraftDays, filteredEmployees, shiftOptionsByKey, weekDateKeys]);

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
    setHasDraftChanges(true);
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
      branchCode,
      areaCode,
      roleCode,
      weekIndex: resolvedSelectedWeekIndex,
      ...nextFilters,
    }), { scroll: false });
  }, [areaCode, branchCode, monthKey, resolvedSelectedWeekIndex, roleCode, router]);

  const selectWeekIndex = useCallback((nextWeekIndex) => {
    const boundedWeekIndex = Math.min(Math.max(Number(nextWeekIndex) || 0, 0), maxWeekIndex);

    setSelectedWeekIndex(boundedWeekIndex);
    replaceFilters({ weekIndex: boundedWeekIndex });
  }, [maxWeekIndex, replaceFilters]);

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
        const [employeesResponse, branchesResponse, rolesResponse, templatesResponse, laborRulesResponse] = await Promise.all([
          fetch("/api/employees"),
          fetch("/api/branches"),
          fetch("/api/roles"),
          fetch("/api/planning/base-schedules"),
          fetch("/api/planning/labor-rules"),
        ]);
        const [employeesPayload, branchesPayload, rolesPayload, templatesPayload, laborRulesPayload] = await Promise.all([
          employeesResponse.json(),
          branchesResponse.json(),
          rolesResponse.json(),
          templatesResponse.json(),
          laborRulesResponse.json(),
        ]);

        if (!employeesResponse.ok) throw new Error(employeesPayload.error || "No se pudieron cargar los empleados.");
        if (!branchesResponse.ok) throw new Error(branchesPayload.error || "No se pudieron cargar las sucursales.");
        if (!rolesResponse.ok) throw new Error(rolesPayload.error || "No se pudieron cargar los roles.");
        if (!templatesResponse.ok) throw new Error(templatesPayload.error || "No se pudieron cargar las plantillas.");
        if (!laborRulesResponse.ok) throw new Error(laborRulesPayload.error || "No se pudieron cargar las reglas laborales.");

        if (!isCancelled) {
          setEmployees(employeesPayload.employees || []);
          setBranches(branchesPayload.branches || []);
          setRoles(rolesPayload.roles || []);
          setTemplates(templatesPayload.templates || []);
          setLaborRules(laborRulesPayload.rules || null);
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

    if (!branchCode) {
      return;
    }

    let isCancelled = false;

    async function loadAssignments() {
      const requestDraftRevision = draftRevisionRef.current;

      try {
        setIsAssignmentsLoading(true);
        const params = new URLSearchParams({ month: monthKey });

        if (branchCode) params.set("branchCode", branchCode);
        if (areaCode) params.set("areaCode", areaCode);
        if (roleCode) params.set("roleCode", roleCode);

        const [response, overlaysPayload] = await Promise.all([
          fetch(`/api/planning/schedule-assignments?${params.toString()}`),
          fetchPlanningOverlays(monthKey),
        ]);
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.error || "No se pudieron cargar las asignaciones.");

        if (!isCancelled && requestDraftRevision === draftRevisionRef.current) {
          const nextAssignments = payload.assignments || [];

          setAssignments(nextAssignments);
          setExceptions(overlaysPayload.exceptions || []);
          setVacations(overlaysPayload.vacations || []);
          setDraftDays(buildDraftDays(nextAssignments, baseShiftOptions));
          setDraftWeekRoles(buildDraftWeekRoles(nextAssignments, employees, weekOptions));
          setDraftDayRoles(buildDraftDayRoles(nextAssignments));
          setDraftDayNotes(buildDraftDayNotes(nextAssignments));
          setClearScheduleTargets([]);
          setHasDraftChanges(false);
          setLoadedAssignmentsKey(assignmentsScopeKey);
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
  }, [areaCode, assignmentsScopeKey, baseShiftOptions, branchCode, employees, isLoading, monthKey, roleCode, showNotice, weekOptions]);

  function setCell(employeeId, dateKey, shiftKey) {
    markDraftEdited();

    setDraftDays((current) => ({
      ...current,
      [employeeId]: {
        ...(current[employeeId] || {}),
        [dateKey]: shiftKey,
      },
    }));
    setDraftDayNotes((current) => {
      const nextNote = getReservedOperationalNote(shiftKey);
      const employeeNotes = { ...(current[employeeId] || {}) };

      if (nextNote) {
        employeeNotes[dateKey] = nextNote;
      } else {
        delete employeeNotes[dateKey];
      }

      return {
        ...current,
        [employeeId]: employeeNotes,
      };
    });
  }

  function setWeekRole(employeeId, weekStartKey, nextRoleCode) {
    markDraftEdited();

    setDraftWeekRoles((current) => ({
      ...current,
      [employeeId]: {
        ...(current[employeeId] || {}),
        [weekStartKey]: nextRoleCode,
      },
    }));
    setDraftDayRoles((current) => {
      const employeeRoles = { ...(current[employeeId] || {}) };

      weekDateKeys.forEach((dateKey) => {
        if (getWeekStartKey(dateKey) === weekStartKey) {
          delete employeeRoles[dateKey];
        }
      });

      return {
        ...current,
        [employeeId]: employeeRoles,
      };
    });
  }

  function goToPreviousWeek() {
    if (resolvedSelectedWeekIndex > 0) {
      selectWeekIndex(resolvedSelectedWeekIndex - 1);
      return;
    }

    const previousMonthKey = shiftMonthKey(monthKey, -1);
    const previousWeekIndex = Math.max(0, getMonthWeekOptions(previousMonthKey).length - 1);

    setMonthKey(previousMonthKey);
    setSelectedWeekIndex(previousWeekIndex);
    replaceFilters({ monthKey: previousMonthKey, weekIndex: previousWeekIndex });
  }

  function goToNextWeek() {
    if (resolvedSelectedWeekIndex < weekOptions.length - 1) {
      selectWeekIndex(resolvedSelectedWeekIndex + 1);
      return;
    }

    const nextMonthKey = shiftMonthKey(monthKey, 1);

    setMonthKey(nextMonthKey);
    setSelectedWeekIndex(0);
    replaceFilters({ monthKey: nextMonthKey, weekIndex: 0 });
  }

  function generateWeek() {
    markDraftEdited();

    const sundayKey = weekDateKeys.find((dateKey) => getDayOfWeek(dateKey) === 0);
    const managementBackup = sundayKey
      ? filteredEmployees.find((employee) => !isPrimaryManagementEmployee(employee) && managementRoleForEmployee(employee))
      : null;
    const managementBackupRole = managementBackup ? managementRoleForEmployee(managementBackup) : null;

    setDraftDays((current) => {
      const next = { ...current };
      const employeesByRole = filteredEmployees.reduce((map, employee) => {
        const key = employee.roleCode || "SIN_ROL";

        if (!map.has(key)) map.set(key, []);
        map.get(key).push(employee);
        return map;
      }, new Map());

      for (const [, roleEmployees] of employeesByRole.entries()) {
        roleEmployees.forEach((employee, employeeIndex) => {
          const employeeDays = { ...(next[employee.id] || {}) };
          const workShiftKeys = getWorkShiftKeysForEmployee(employee);

          if (isPrimaryManagementEmployee(employee)) {
            weekDateKeys.forEach((dateKey, dayIndex) => {
              if (getDayOfWeek(dateKey) === 0) {
                employeeDays[dateKey] = "off";
                return;
              }

              employeeDays[dateKey] = workShiftKeys[(employeeIndex + dayIndex) % workShiftKeys.length] || "off";
            });

            next[employee.id] = employeeDays;
            return;
          }

          const firstRestIndex = roleEmployees.length > 1 ? (employeeIndex * 2) % Math.max(weekDateKeys.length, 1) : 5;
          const restIndexes = new Set([
            firstRestIndex,
            (firstRestIndex + 1) % Math.max(weekDateKeys.length, 1),
          ]);

          weekDateKeys.forEach((dateKey, dayIndex) => {
            if (restIndexes.has(dayIndex)) {
              employeeDays[dateKey] = "off";
              return;
            }

            employeeDays[dateKey] = workShiftKeys[(employeeIndex + dayIndex) % workShiftKeys.length] || "off";
          });

          next[employee.id] = employeeDays;
        });
      }

      if (managementBackup && sundayKey) {
        const employeeDays = { ...(next[managementBackup.id] || {}) };
        const workShiftKeys = getWorkShiftKeysForEmployee(managementBackup);

        employeeDays[sundayKey] = workShiftKeys[0] || "off";
        next[managementBackup.id] = employeeDays;
      }

      return next;
    });
    setDraftDayRoles((current) => {
      if (!sundayKey) {
        return current;
      }

      const next = { ...current };

      filteredEmployees.forEach((employee) => {
        const employeeRoles = { ...(next[employee.id] || {}) };
        const role = coverageRolesForEmployee(employee).find((option) => option.code === employeeRoles[sundayKey]);

        if (role && isManagementRole(role)) {
          delete employeeRoles[sundayKey];
        }

        next[employee.id] = employeeRoles;
      });

      if (managementBackup && managementBackupRole) {
        next[managementBackup.id] = {
          ...(next[managementBackup.id] || {}),
          [sundayKey]: managementBackupRole.code,
        };
      }

      return next;
    });
    showNotice("success", "Semana generada. Revisa cobertura y descansos antes de guardar.");
  }

  function resetWeek() {
    markDraftEdited();
    setClearScheduleTargets(filteredEmployees.flatMap((employee) =>
      weekDateKeys.map((dateKey) => ({ employeeId: employee.id, dateKey })),
    ));

    setDraftDays((current) => {
      const next = { ...current };

      filteredEmployees.forEach((employee) => {
        const employeeDays = { ...(next[employee.id] || {}) };

        weekDateKeys.forEach((dateKey) => {
          employeeDays[dateKey] = "off";
        });

        next[employee.id] = employeeDays;
      });

      return next;
    });
    setDraftDayRoles((current) => {
      const next = { ...current };

      filteredEmployees.forEach((employee) => {
        const employeeRoles = { ...(next[employee.id] || {}) };

        weekDateKeys.forEach((dateKey) => {
          delete employeeRoles[dateKey];
        });

        next[employee.id] = employeeRoles;
      });

      return next;
    });
    setDraftDayNotes((current) => {
      const next = { ...current };

      filteredEmployees.forEach((employee) => {
        const employeeNotes = { ...(next[employee.id] || {}) };

        weekDateKeys.forEach((dateKey) => {
          delete employeeNotes[dateKey];
        });

        next[employee.id] = employeeNotes;
      });

      return next;
    });
    showNotice("success", "Horarios de la semana limpiados. Guarda la semana para aplicar el cambio.");
  }

  async function pasteClipboardSchedule() {
    try {
      if (!navigator?.clipboard?.readText) {
        throw new Error("Tu navegador no permitio leer el portapapeles. Copia la tabla desde Excel e intenta de nuevo.");
      }

      const text = await navigator.clipboard.readText();
      const nextPreview = buildClipboardSchedulePreview(text, filteredEmployees, weekDateKeys, monthKey);

      if (!String(text || "").trim() || !nextPreview.rows.length) {
        throw new Error("No encontre una tabla valida en el portapapeles.");
      }

      setClipboardScheduleText(text);
      showNotice("success", `Tabla detectada: ${nextPreview.stats.matched} empleados, ${nextPreview.stats.shifts} turnos.`);
    } catch (error) {
      showNotice("error", error.message || "No se pudo leer el portapapeles.");
    }
  }

  function clearClipboardSchedule() {
    setClipboardScheduleText("");
    showNotice("success", "Carga pegada borrada.");
  }

  function applyClipboardSchedule() {
    const rowsToApply = clipboardPreview.rows.filter((row) => row.employee);

    if (!rowsToApply.length) {
      showNotice("error", "Pega una tabla con empleados que existan en el alcance actual.");
      return;
    }

    const invalidShiftCells = [];

    rowsToApply.forEach((row) => {
      const employeeShiftOptions = getShiftOptionsForEmployee(row.employee);
      const allowedShiftKeys = new Set(employeeShiftOptions.map((shift) => shift.key));

      row.cells.forEach((cell) => {
        if (cell.status !== "shift" || allowedShiftKeys.has(cell.shiftKey)) return;

        invalidShiftCells.push(`${row.sourceName} ${formatPlannerDay(cell.dateKey, monthKey)}: ${cell.rawValue}`);
      });
    });

    if (invalidShiftCells.length) {
      const sample = invalidShiftCells.slice(0, 3).join(" | ");
      const rest = invalidShiftCells.length > 3 ? ` y ${invalidShiftCells.length - 3} mas` : "";

      showNotice("error", `Hay horarios que no existen en plantillas del area: ${sample}${rest}.`);
      return;
    }

    markDraftEdited();
    setDraftDays((current) => {
      const next = { ...current };

      rowsToApply.forEach((row) => {
        const employeeDays = { ...(next[row.employee.id] || {}) };
        const employeeShiftOptions = getShiftOptionsForEmployee(row.employee);
        const allowedShiftKeys = new Set(employeeShiftOptions.map((shift) => shift.key));

        row.cells.forEach((cell) => {
          if (overlaysByEmployeeDate.has(`${row.employee.id}|${cell.dateKey}`)) {
            return;
          }

          if (cell.status === "note") {
            employeeDays[cell.dateKey] = OFF_SHIFT_OPTION.key;
            return;
          }

          if (["vacation", "permission", "outside_work"].includes(cell.status)) {
            employeeDays[cell.dateKey] = cell.shiftKey;
            return;
          }

          employeeDays[cell.dateKey] = allowedShiftKeys.has(cell.shiftKey) ? cell.shiftKey : OFF_SHIFT_OPTION.key;
        });

        next[row.employee.id] = employeeDays;
      });

      return next;
    });
    setDraftDayNotes((current) => {
      const next = { ...current };

      rowsToApply.forEach((row) => {
        const employeeNotes = { ...(next[row.employee.id] || {}) };

        row.cells.forEach((cell) => {
          if (overlaysByEmployeeDate.has(`${row.employee.id}|${cell.dateKey}`)) {
            return;
          }

          if (["note", "permission", "outside_work"].includes(cell.status)) {
            employeeNotes[cell.dateKey] = cell.label;
            return;
          }

          delete employeeNotes[cell.dateKey];
        });

        next[row.employee.id] = employeeNotes;
      });

      return next;
    });
    setClipboardScheduleText("");

    const unmatchedMessage = clipboardPreview.stats.unmatched
      ? ` ${clipboardPreview.stats.unmatched} fila(s) quedaron sin empleado.`
      : "";

    showNotice("success", `Se aplicaron horarios para ${rowsToApply.length} empleado(s).${unmatchedMessage}`);
  }

  function saveWeek() {
    startTransition(async () => {
      try {
        const dailyBaseMinutes = dailyBaseHours * 60;
        const employeeDays = filteredEmployees.map((employee) => ({
          employeeId: employee.id,
          days: applyWeeklyExtraDays(weekDateKeys.map((dateKey) => {
            const dayRole = roleForEmployeeOnDate(employee, dateKey);
            const overlay = overlaysByEmployeeDate.get(`${employee.id}|${dateKey}`);
            const shiftKey = overlay
              ? (overlay.kind === "vacation" ? RESERVED_SHIFT_KEYS.vacation : OFF_SHIFT_OPTION.key)
              : draftDays[employee.id]?.[dateKey] || "off";
            const baseDay = buildOperationalDay(dateKey, shiftKey, shiftOptionsByKey);
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
        const response = await fetch("/api/planning/schedule-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "operational-save",
            monthKey,
            employeeDays,
            clearScheduleTargets,
          }),
        });
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.error || "No se pudo guardar la programacion.");

        const nextAssignments = payload.assignments || [];
        const overlaysPayload = await fetchPlanningOverlays(monthKey);

        setAssignments(nextAssignments);
        setExceptions(overlaysPayload.exceptions || []);
        setVacations(overlaysPayload.vacations || []);
        setDraftDays(buildDraftDays(nextAssignments, shiftOptions));
        setDraftWeekRoles(buildDraftWeekRoles(nextAssignments, employees, weekOptions));
        setDraftDayRoles(buildDraftDayRoles(nextAssignments));
        setDraftDayNotes(buildDraftDayNotes(nextAssignments));
        setClearScheduleTargets([]);
        setHasDraftChanges(false);
        showNotice("success", payload.message);
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  async function downloadScheduleExcel() {
    if (isExportingSchedule || shouldShowScopedLoading || !filteredEmployees.length) return;

    if (hasDraftChanges) {
      showNotice("error", "Guarda los cambios pendientes antes de descargar el Excel.");
      return;
    }

    try {
      setIsExportingSchedule(true);

      const params = new URLSearchParams({ month: monthKey });

      if (branchCode) params.set("branchCode", branchCode);
      if (areaCode) params.set("areaCode", areaCode);
      if (roleCode) params.set("roleCode", roleCode);

      const response = await fetch(`/api/planning/schedule-assignments/export?${params.toString()}`);

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "No se pudo descargar el horario.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const scopeSuffix = [branchCode, areaCode, roleCode].filter(Boolean).join("-").toLowerCase();

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
    if (event.target.closest("select, button, a")) return;

    const params = new URLSearchParams({ month: monthKey });

    if (branchCode) params.set("branchCode", branchCode);
    if (areaCode) params.set("areaCode", areaCode);
    if (roleCode) params.set("roleCode", roleCode);

    router.push(`${planningModulePath(`/planning/monthly/${employeeId}`)}?${params.toString()}`);
  }

  if (isLoading) {
    return (
      <section className={`${styles.loadingScene} page-entrance`} aria-live="polite">
        <div className={styles.loadingFilters}>
          {Array.from({ length: 5 }, (_, index) => <span key={index} className={styles.skeletonField} />)}
        </div>
        <div className={styles.loadingWeekToolbar}>
          <div className={styles.loadingWeekTabs}>
            {Array.from({ length: 4 }, (_, index) => <span key={index} className={styles.skeletonWeekTab} />)}
          </div>
          <span className={styles.skeletonButton} />
        </div>
        <div className={styles.loadingImportPanel}>
          <div>
            <span className={styles.skeletonTiny} />
            <span className={styles.skeletonTitle} />
          </div>
          <span className={styles.skeletonButton} />
        </div>
        <div className={styles.loadingMetrics}>
          {Array.from({ length: 3 }, (_, index) => (
            <article key={index}>
              <span className={styles.skeletonTiny} />
              <strong className={styles.skeletonValue} />
            </article>
          ))}
        </div>
        <div className={styles.loadingTable}>
          <div className={styles.loadingTableHeader}>
            {Array.from({ length: 10 }, (_, index) => <span key={index} className={styles.skeletonTitle} />)}
          </div>
          {Array.from({ length: 6 }, (_, rowIndex) => (
            <div key={rowIndex} className={styles.skeletonRow}>
              <span className={styles.skeletonPerson} />
              {Array.from({ length: 8 }, (_, cellIndex) => <span key={cellIndex} className={styles.skeletonCell} />)}
              <span className={styles.skeletonButton} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className={`${styles.layout} page-entrance`}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />
      <FloatingModal
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
      </FloatingModal>
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
              {selectedOverlay.raw?.startTime || selectedOverlay.raw?.endTime ? (
                <div>
                  <dt>Horario indicado</dt>
                  <dd>{[selectedOverlay.raw.startTime, selectedOverlay.raw.endTime].filter(Boolean).join(" - ")}</dd>
                </div>
              ) : null}
              {selectedOverlay.notes ? (
                <div>
                  <dt>Notas</dt>
                  <dd>{selectedOverlay.notes}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
      </FloatingModal>

      <section className={`${styles.toolbar} page-entrance page-entrance-delay-sm`}>
        <div>
          <p className={styles.eyebrow}>Programacion de horarios</p>
          <h2>Horario semanal sin plantillas</h2>
          <p className={styles.toolbarHint}>
            Primero selecciona sucursal y area. La planificacion se trabaja por alcance para evitar mezclar equipos.
          </p>
        </div>
        <label>
          <span>Mes</span>
          <input
            type="month"
            value={monthKey}
            onChange={(event) => {
              setMonthKey(event.target.value);
              setSelectedWeekIndex(0);
              replaceFilters({ monthKey: event.target.value, weekIndex: 0 });
            }}
          />
        </label>
        <label>
          <span>Sucursal</span>
          <select
            value={branchCode}
            onChange={(event) => {
              const nextBranchCode = event.target.value;

              setBranchCode(nextBranchCode);
              setAreaCode("");
              setRoleCode("");
              replaceFilters({ branchCode: nextBranchCode, areaCode: "", roleCode: "" });
            }}
          >
            <option value="">Seleccionar</option>
            {branches.map((branch) => (
              <option key={branch.code} value={branch.code}>{branch.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Area</span>
          <select
            value={areaCode}
            disabled={!branchCode}
            onChange={(event) => {
              setAreaCode(event.target.value);
              setRoleCode("");
              replaceFilters({ areaCode: event.target.value, roleCode: "" });
            }}
          >
            <option value="">{branchCode ? "Seleccionar" : "Elige una sucursal"}</option>
            {areaOptions.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Rol</span>
          <select
            value={roleCode}
            disabled={!hasPlanningScope}
            onChange={(event) => {
              setRoleCode(event.target.value);
              replaceFilters({ roleCode: event.target.value });
            }}
          >
            <option value="">Todos</option>
            {roleOptions.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>
      </section>

      {!hasPlanningScope ? (
        <section className={`${styles.scopeEmptyState} page-entrance page-entrance-delay-md`}>
          <strong>Selecciona una sucursal y un area para empezar</strong>
          <span>
            La programacion se mostrara separada por equipo. Luego podremos aplicar permisos para que cada usuario vea solo su sucursal y area asignada.
          </span>
        </section>
      ) : null}

      {shouldShowScopedLoading ? (
        <section className={`${styles.loadingScene} ${styles.scopedLoadingScene} page-entrance`} aria-live="polite">
          <div className={styles.loadingWeekToolbar}>
            <div className={styles.loadingWeekTabs}>
              {Array.from({ length: 4 }, (_, index) => <span key={index} className={styles.skeletonWeekTab} />)}
            </div>
            <span className={styles.skeletonButton} />
          </div>
          <div className={styles.loadingImportPanel}>
            <div>
              <span className={styles.skeletonTiny} />
              <span className={styles.skeletonTitle} />
            </div>
            <span className={styles.skeletonButton} />
          </div>
          <div className={styles.loadingMetrics}>
            {Array.from({ length: 3 }, (_, index) => (
              <article key={index}>
                <span className={styles.skeletonTiny} />
                <strong className={styles.skeletonValue} />
              </article>
            ))}
          </div>
          <div className={styles.loadingTable}>
            <div className={styles.loadingTableHeader}>
              {Array.from({ length: 10 }, (_, index) => <span key={index} className={styles.skeletonTitle} />)}
            </div>
            {Array.from({ length: 6 }, (_, rowIndex) => (
              <div key={rowIndex} className={styles.skeletonRow}>
                <span className={styles.skeletonPerson} />
                {Array.from({ length: 8 }, (_, cellIndex) => <span key={cellIndex} className={styles.skeletonCell} />)}
                <span className={styles.skeletonButton} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {hasPlanningScope && !shouldShowScopedLoading ? (
        <>
      <section className={`${styles.scopeHeader} page-entrance page-entrance-delay-sm`}>
        <div>
          <span>Alcance actual</span>
          <strong>{selectedBranch?.name || branchCode} · {selectedAreaName || areaCode}</strong>
        </div>
        <small>{roleCode ? `Rol filtrado: ${roleOptions.find(([code]) => code === roleCode)?.[1] || roleCode}` : "Todos los roles del area"}</small>
      </section>

      <section className={`${styles.weekToolbar} page-entrance page-entrance-delay-sm`}>
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
        <div className={styles.weekActions}>
          <button
            type="button"
            className={styles.resetAction}
            onClick={resetWeek}
            disabled={isPending || !filteredEmployees.length}
          >
            <RotateCcw size={16} />
            Limpiar horarios
          </button>
          <button
            type="button"
            onClick={downloadScheduleExcel}
            disabled={isExportingSchedule || isPending || !filteredEmployees.length}
          >
            {isExportingSchedule ? <RefreshCw size={16} /> : <Download size={16} />}
            {isExportingSchedule ? "Descargando..." : "Excel semanal"}
          </button>
          <button type="button" onClick={saveWeek} disabled={isPending || !hasDraftChanges || !filteredEmployees.length || !availableCoverageRoles.length}>
            {isPending ? <RefreshCw size={16} /> : <Save size={16} />}
            {isPending ? "Guardando..." : "Guardar semana"}
          </button>
        </div>
      </section>

      <section className={`${styles.importPanel} page-entrance page-entrance-delay-md`}>
        <div className={styles.importHeader}>
          <div>
            <span className={styles.eyebrow}>Pegado desde Excel</span>
            <strong>Cargar horarios de la semana visible</strong>
            <small>Copia la tabla completa en Excel y usa el boton para leer el portapapeles.</small>
          </div>
          <div className={styles.importActions}>
            {hasClipboardSchedule ? (
              <>
                <button
                  type="button"
                  onClick={applyClipboardSchedule}
                  disabled={!clipboardPreview.stats.matched}
                >
                  <Save size={16} />
                  Aplicar a la tabla
                </button>
                <button type="button" className={styles.clearImportAction} onClick={clearClipboardSchedule}>
                  <X size={16} />
                  Borrar carga
                </button>
              </>
            ) : (
              <button type="button" onClick={pasteClipboardSchedule}>
                <ClipboardPaste size={16} />
                Pegar tabla
              </button>
            )}
          </div>
        </div>
        {hasClipboardSchedule ? (
          <div className={styles.importStats} aria-live="polite">
            <span>{clipboardPreview.stats.shifts} turnos</span>
            <span>{clipboardPreview.stats.rests} descansos</span>
            <span>{clipboardPreview.stats.notes} ajustes/excepciones</span>
          </div>
        ) : null}
      </section>

      <section className={`${styles.summaryGrid} page-entrance page-entrance-delay-md`}>
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
          className={`${styles.summaryInfoCard} ${summary.extraCostAmount ? styles.summaryInfoCardActive : ""}`}
          onClick={() => setIsCostModalOpen(true)}
          disabled={!variableCostDetails.length}
        >
          <span>Costo variable aprox.</span>
          <strong>{formatMoney(summary.extraCostAmount)}</strong>
          <small>{summary.extraDayIndicators ? `${summary.extraDayIndicators} dia extra` : "Sin dias extra"}</small>
        </button>
      </section>

      <section className={`${styles.coveragePanel} page-entrance page-entrance-delay-md`}>
        <div className={styles.tableHeader}>
          <CalendarDays size={18} />
          <span>Cobertura por rol base</span>
        </div>
        <div className={styles.coverageGrid}>
          {weekDateKeys.map((dateKey) => {
            const roles = [...(coverageByDay.get(dateKey) || new Map()).values()];

            return (
              <article key={dateKey}>
                <strong>{DAY_LABELS[getDayOfWeek(dateKey)]} {dateKey.slice(8)}</strong>
                {roles.length ? (
                  roles.map((role, roleIndex) => (
                    <span key={`${role.roleCode || role.roleName}-${roleIndex}`}>{role.roleName}: {role.count}</span>
                  ))
                ) : (
                  <span>Sin cobertura</span>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className={`${styles.tablePanel} page-entrance page-entrance-delay-md`}>
        <div className={styles.tableHeader}>
          <div className={styles.tableHeaderTitle}>
            <CalendarDays size={18} />
            <span>{filteredEmployees.length} empleados para programar</span>
          </div>
          <div className={styles.tableWeekNav} aria-label="Navegacion semanal de la tabla">
            <button
              type="button"
              onClick={goToPreviousWeek}
              aria-label={resolvedSelectedWeekIndex <= 0 ? "Mes anterior" : "Semana anterior"}
              title={resolvedSelectedWeekIndex <= 0 ? "Mes anterior" : "Semana anterior"}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={goToNextWeek}
              aria-label={resolvedSelectedWeekIndex >= weekOptions.length - 1 ? "Mes siguiente" : "Semana siguiente"}
              title={resolvedSelectedWeekIndex >= weekOptions.length - 1 ? "Mes siguiente" : "Semana siguiente"}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Cobertura semana</th>
                {weekDateKeys.map((dateKey) => (
                  <th
                    key={dateKey}
                    className={`${styles.dayColumn} ${dateKey.startsWith(`${monthKey}-`) ? "" : styles.adjacentMonthDay}`}
                  >
                    <span>{DAY_LABELS[getDayOfWeek(dateKey)]}</span>
                    <small>{formatPlannerDay(dateKey, monthKey)}</small>
                  </th>
                ))}
                <th>Trabajados</th>
                <th>Impacto aprox.</th>
                <th>HL</th>
                <th>HS</th>
                <th>HE</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => {
                const workedCount = weekDateKeys.filter((dateKey) =>
                  isWorkShift(effectiveDraftDays[employee.id]?.[dateKey] || "off"),
                ).length;
                const weekRole = weekRoleForEmployee(employee, selectedWeek.weekStartKey);
                const employeeCoverageOptions = coverageRolesForEmployee(employee);
                const employeeShiftOptions = getShiftOptionsForEmployee(employee);
                const employeeCost = planningCostByEmployee.get(employee.id);
                const canChooseCoverage = employeeCoverageOptions.length > 1;
                const isDismissed = isEmployeeDismissedInMonth(employee, monthKey);
                const dismissalTitle = isDismissed ? employeeDismissalLabel(employee) : undefined;

                return (
                  <tr
                    key={employee.id}
                    className={`${styles.clickableRow} ${isDismissed ? styles.dismissedRow : ""}`}
                    title={dismissalTitle}
                    onClick={(event) => openEmployeeDetail(event, employee.id)}
                  >
                    <td data-label="Empleado">
                      <strong>{employee.fullName}</strong>
                      <span>{employee.branchName || employee.branchCode || "Sin sucursal"}</span>
                    </td>
                    <td data-label="Cobertura semana">
                      {canChooseCoverage ? (
                        <select
                          value={weekRole.code}
                          onChange={(event) => setWeekRole(employee.id, selectedWeek.weekStartKey, event.target.value)}
                          title="Seleccionar cobertura semanal"
                        >
                          {employeeCoverageOptions.map((role) => (
                            <option key={role.code} value={role.code}>{role.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={styles.coverageStatic}>{weekRole.name || "Sin cobertura"}</span>
                      )}
                    </td>
                    {weekDateKeys.map((dateKey) => {
                      const overlay = overlaysByEmployeeDate.get(`${employee.id}|${dateKey}`);

                      return (
                        <td
                          key={dateKey}
                          className={dateKey.startsWith(`${monthKey}-`) ? "" : styles.adjacentMonthCell}
                          data-label={`${DAY_LABELS[getDayOfWeek(dateKey)]} ${formatPlannerDay(dateKey, monthKey)}`}
                        >
                          {overlay ? (
                            <button
                              type="button"
                              className={`${styles.overlayButton} ${overlay.kind === "vacation" ? styles.overlayVacation : styles.overlayException}`}
                              onClick={() => setSelectedOverlay({
                                ...overlay,
                                employeeName: employee.fullName,
                              })}
                            >
                              <Info size={15} aria-hidden="true" />
                              <span>{overlay.shortLabel}</span>
                            </button>
                          ) : (
                            <>
                              <ShiftPicker
                                value={draftDays[employee.id]?.[dateKey] || "off"}
                                options={employeeShiftOptions}
                                onChange={(shiftKey) => setCell(employee.id, dateKey, shiftKey)}
                              />
                              {shouldShowDayNote(
                                draftDays[employee.id]?.[dateKey] || "off",
                                draftDayNotes[employee.id]?.[dateKey],
                              ) ? (
                                <small className={styles.dayNote}>{draftDayNotes[employee.id][dateKey]}</small>
                              ) : null}
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td data-label="Trabajados">
                      <span className={workedCount <= 5 ? styles.okPill : styles.warnPill}>
                        {workedCount} dias
                      </span>
                    </td>
                    <td data-label="Impacto aprox.">
                      <div className={styles.costCell}>
                        <strong>{formatMoney(employeeCost?.totalAmount || 0)}</strong>
                      </div>
                    </td>
                    <td data-label="HL">
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
                    </td>
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
                <td data-label="Cobertura semana" aria-hidden="true" />
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
                <td data-label="Impacto aprox.">
                  <div className={styles.costCell}>
                    <strong>{formatMoney(summary.extraCostAmount)}</strong>
                  </div>
                </td>
                <td data-label="HL">
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
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
        </>
      ) : null}
    </div>
  );
}
