import { formatTime24, isValidTime24 } from "@/lib/datetime/ecuador";
import { DAY_TYPES, WEEK_DAYS } from "@/modules/planner/lib/schedules";

const DAY_TYPE_MAP = new Map(DAY_TYPES.map((item) => [item.value, item]));

export const DEFAULT_TEMPLATE_ROWS = [{
  dayOfWeek: 1,
  label: "Horario",
  dayType: "workday",
  startTime: "08:00",
  lunchDurationMinutes: 0,
  lunchStartTime: "",
  lunchEndTime: "",
  hasLunch: false,
  endTime: "18:00",
  authorizedExtraMinutes: 0,
  graceMinutes: 10,
}];

function isValidTimeString(value) {
  return isValidTime24(value, { allowEmpty: true });
}

function normalizeNumber(value, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function parseTimeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) {
    return null;
  }

  const [hours, minutes] = String(value).split(":").map(Number);

  return hours * 60 + minutes;
}

function calculateNetMinutes({ startTime, endTime, lunchDurationMinutes }) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);

  if (start === null || end === null || end <= start) {
    return 0;
  }

  return Math.max(0, end - start - (Number(lunchDurationMinutes) || 0));
}

function minutesToTime(totalMinutes) {
  const minutes = Math.max(0, Number(totalMinutes) || 0);

  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatTimeLabel(value) {
  return formatTime24(value, "--");
}

function calculateLunchDurationMinutes(lunchStartTime, lunchEndTime) {
  const lunchStart = parseTimeToMinutes(lunchStartTime);
  const lunchEnd = parseTimeToMinutes(lunchEndTime);

  if (lunchStart === null || lunchEnd === null || lunchEnd <= lunchStart) {
    return 0;
  }

  return lunchEnd - lunchStart;
}

function deriveLunchTimes(row, startTime, endTime, lunchDurationMinutes) {
  const lunchStartTime = String(row?.lunchStartTime || "").trim();
  const lunchEndTime = String(row?.lunchEndTime || "").trim();

  if (isValidTimeString(lunchStartTime) && isValidTimeString(lunchEndTime) && lunchStartTime && lunchEndTime) {
    return { lunchStartTime, lunchEndTime };
  }

  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  const duration = Number(lunchDurationMinutes) || 0;

  if (start === null || end === null || !duration) {
    return { lunchStartTime: "", lunchEndTime: "" };
  }

  const preferredStart = parseTimeToMinutes("13:00") ?? start;
  const lunchStart = Math.min(Math.max(preferredStart, start), Math.max(start, end - duration));

  return {
    lunchStartTime: minutesToTime(lunchStart),
    lunchEndTime: minutesToTime(lunchStart + duration),
  };
}

function calculateAutoSupplementaryMinutes(row) {
  if (row.dayType !== "workday") {
    return 0;
  }

  return Math.max(0, calculateNetMinutes(row) - 8 * 60);
}

function resolveAuthorizedSupplementaryMinutes(row, normalizedRow = row) {
  const configuredMinutes = Number(row?.authorizedExtraMinutes);
  const autoMinutes = calculateAutoSupplementaryMinutes(normalizedRow);

  return Math.max(0, Number.isFinite(configuredMinutes) ? configuredMinutes : 0, autoMinutes);
}

export function normalizeTemplateRow(row) {
  const dayOfWeek = Number(row?.dayOfWeek);
  const dayType = String(row?.dayType || "").trim();
  const typeConfig = DAY_TYPE_MAP.get(dayType);
  const startTime = String(row?.startTime || "").trim();
  const endTime = String(row?.endTime || "").trim();
  const lunchStartInput = String(row?.lunchStartTime || "").trim();
  const lunchEndInput = String(row?.lunchEndTime || "").trim();

  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new Error("Dia de la semana invalido.");
  }

  if (!typeConfig) {
    throw new Error("Tipo de dia invalido.");
  }

  if (!isValidTimeString(startTime) || !isValidTimeString(endTime) || !isValidTimeString(lunchStartInput) || !isValidTimeString(lunchEndInput)) {
    throw new Error("Las horas deben estar entre 00:00 y 24:00.");
  }

  if (typeConfig.isWorkingDay && (!startTime || !endTime)) {
    throw new Error("El horario debe tener entrada y salida.");
  }

  const requestedLunchDuration = normalizeNumber(row?.lunchDurationMinutes, 60, { min: 0, max: 240 });
  const lunchTimes = typeConfig.isWorkingDay
    ? deriveLunchTimes(row, startTime, endTime, requestedLunchDuration)
    : { lunchStartTime: "", lunchEndTime: "" };
  const lunchDurationMinutes = calculateLunchDurationMinutes(lunchTimes.lunchStartTime, lunchTimes.lunchEndTime);
  const hasLunch = typeConfig.isWorkingDay ? lunchDurationMinutes > 0 : false;

  if (typeConfig.isWorkingDay && hasLunch) {
    const start = parseTimeToMinutes(startTime);
    const end = parseTimeToMinutes(endTime);
    const lunchStart = parseTimeToMinutes(lunchTimes.lunchStartTime);
    const lunchEnd = parseTimeToMinutes(lunchTimes.lunchEndTime);

    if (lunchStart <= start || lunchEnd >= end) {
      throw new Error("El almuerzo debe quedar dentro de la jornada laboral.");
    }
  }

  const normalizedRow = {
    dayOfWeek,
    dayType,
    startTime: typeConfig.isWorkingDay ? startTime : "",
    lunchDurationMinutes: hasLunch ? lunchDurationMinutes : 0,
    lunchStartTime: hasLunch ? lunchTimes.lunchStartTime : "",
    lunchEndTime: hasLunch ? lunchTimes.lunchEndTime : "",
    hasLunch,
    endTime: typeConfig.isWorkingDay ? endTime : "",
    graceMinutes: normalizeNumber(row?.graceMinutes, 10, { min: 0, max: 180 }),
  };

  return {
    ...normalizedRow,
    authorizedExtraMinutes: 0,
  };
}

export function normalizeBaseScheduleTemplatePayload(body, { role } = {}) {
  const roleCode = String(body?.roleCode || "").trim();
  const rows = Array.isArray(body?.weeklyRows) ? body.weeklyRows : [];

  if (roleCode && !role) {
    throw new Error("El rol seleccionado no existe.");
  }

  if (rows.length !== 1 && rows.length !== 7) {
    throw new Error("La plantilla debe contener un horario diario.");
  }

  const weeklyRows = rows.slice(0, 1).map(normalizeTemplateRow);
  const firstRow = weeklyRows[0];
  const defaultName = firstRow?.hasLunch
    ? `${formatTimeLabel(firstRow.startTime)} A ${formatTimeLabel(firstRow.lunchStartTime)} ${formatTimeLabel(firstRow.lunchEndTime)} A ${formatTimeLabel(firstRow.endTime)}`
    : `${formatTimeLabel(firstRow.startTime)} A ${formatTimeLabel(firstRow.endTime)}`;
  const name = String(body?.name || defaultName).trim().toUpperCase();

  return {
    name,
    areaCode: "",
    areaName: "",
    roleCode,
    roleName: role?.name || "",
    rotationGroup: "",
    weeklyRows,
    notes: String(body?.notes || "").trim(),
    isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
  };
}

export function serializeBaseScheduleTemplate(template) {
  return {
    id: template._id.toString(),
    name: template.name || "",
    areaCode: "",
    areaName: "",
    roleCode: template.roleCode || "",
    roleName: template.roleName || "Toda el area",
    rotationGroup: template.rotationGroup || "",
    weeklyRows: (template.weeklyRows || []).map((row) => {
      const day = WEEK_DAYS.find((item) => item.dayOfWeek === row.dayOfWeek);

      return {
        dayOfWeek: row.dayOfWeek,
        label: day?.label || "",
        dayType: row.dayType || "workday",
        startTime: row.startTime || "",
        lunchDurationMinutes: row.lunchDurationMinutes || 0,
        lunchStartTime: row.lunchStartTime || "",
        lunchEndTime: row.lunchEndTime || "",
        hasLunch: Boolean(row.hasLunch),
        endTime: row.endTime || "",
        authorizedExtraMinutes: 0,
        graceMinutes: row.graceMinutes ?? 10,
      };
    }),
    notes: template.notes || "",
    isActive: template.isActive !== false,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}
