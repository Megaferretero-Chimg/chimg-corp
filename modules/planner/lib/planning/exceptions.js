import { endOfMonth, format, isValid, parse, startOfMonth } from "date-fns";

import { makeEcuadorDate } from "@/lib/datetime/ecuador";

export const EXCEPTION_TYPES = [
  { value: "outside_work", label: "Trabajo externo" },
  { value: "outside_work_punch", label: "Trabajo externo con picada" },
  { value: "permission", label: "Permiso o ausencia" },
  { value: "medical_appointment", label: "Salud" },
  { value: "schedule_change", label: "Ajuste de horario" },
  { value: "other", label: "Otro" },
];

export const EXCEPTION_RESOLUTIONS = [
  { value: "pending", label: "Pendiente de revisar" },
  { value: "approved_work_time", label: "Sin descuento de horas" },
  { value: "discount_day", label: "Con descuento de horas" },
];

export const RESOLUTION_EFFECTS = [
  { value: "planning_change", label: "Cambio de planificacion" },
  { value: "paid_absence", label: "Ausencia justificada" },
  { value: "paid_partial_leave", label: "Permiso parcial" },
  { value: "unpaid_absence", label: "Ausencia con descuento" },
  { value: "external_work", label: "Trabajo externo" },
  { value: "manual_punch", label: "Picada manual" },
  { value: "alert_review", label: "Alerta revisada" },
  { value: "other", label: "Otro" },
];

export const ATTENDANCE_MODES = [
  { value: "use_punches", label: "Usar picadas" },
  { value: "use_authorized_schedule", label: "Usar horario autorizado" },
  { value: "add_manual_punch", label: "Agregar picada manual" },
  { value: "ignore_attendance", label: "Ignorar asistencia" },
  { value: "none", label: "Sin cambio de asistencia" },
];

export const PAY_MODES = [
  { value: "regular_only", label: "Solo horas laborables" },
  { value: "regular_and_extra", label: "Laborables, suplementarias y extraordinarias" },
  { value: "discount", label: "Descontar" },
  { value: "no_pay_change", label: "Sin cambio de pago" },
  { value: "none", label: "Sin pago" },
];

export const EXCEPTION_SCOPES = [
  { value: "outside_work", label: "Trabajo fuera de sucursal" },
  { value: "exit_return", label: "Salida con retorno" },
  { value: "full_day", label: "Dia completo" },
  { value: "partial_day", label: "Rango de horas" },
  { value: "early_leave", label: "Salida temprana" },
  { value: "late_arrival", label: "Llegada tardia" },
  { value: "missing_punch", label: "Picada omitida" },
  { value: "date_range", label: "Varios dias" },
  { value: "other", label: "Otro alcance" },
];

const TYPE_VALUES = new Set(EXCEPTION_TYPES.map((type) => type.value));
const RESOLUTION_VALUES = new Set([
  ...EXCEPTION_RESOLUTIONS.map((resolution) => resolution.value),
  "complete_scheduled_time",
  "justified_record",
  "paid_leave",
  "reschedule",
  "replacement",
  "no_action",
  "other",
]);
const SCOPE_VALUES = new Set(EXCEPTION_SCOPES.map((scope) => scope.value));
const EFFECT_VALUES = new Set(RESOLUTION_EFFECTS.map((effect) => effect.value));
const ATTENDANCE_MODE_VALUES = new Set(ATTENDANCE_MODES.map((mode) => mode.value));
const PAY_MODE_VALUES = new Set(PAY_MODES.map((mode) => mode.value));

function getLabel(options, value) {
  if (["complete_scheduled_time", "justified_record", "paid_leave", "reschedule", "replacement", "no_action", "other"].includes(value)) {
    return "Sin descuento de horas";
  }

  return options.find((option) => option.value === value)?.label || value;
}

function normalizeExceptionType(value) {
  const type = String(value || "").trim();

  if (type === "outside_work_punch") {
    return "outside_work_punch";
  }

  if (["material_pickup", "field_visit", "outside_work"].includes(type)) {
    return "outside_work";
  }

  if (["absence", "permission"].includes(type)) {
    return "permission";
  }

  if (["sick_leave", "medical_appointment"].includes(type)) {
    return "medical_appointment";
  }

  if (["early_leave", "late_arrival", "missing_punch", "schedule_change"].includes(type)) {
    return "schedule_change";
  }

  return "other";
}

export function resolveOperationalExceptionEffect(exception = {}) {
  const existingEffect = String(exception.effect || "").trim();

  if (EFFECT_VALUES.has(existingEffect) && existingEffect !== "other") {
    return existingEffect;
  }

  const type = normalizeExceptionType(exception.type);
  const scope = String(exception.scope || "full_day").trim();
  const resolution = String(exception.resolution || "pending").trim();
  const hasPlannedSchedule = Boolean(exception.plannedStartTime && exception.plannedEndTime);
  const hasManualPunch = Boolean(exception.manualPunchTime || exception.manualPunch);

  if (resolution === "no_action") {
    return "alert_review";
  }

  if (resolution === "discount_day") {
    return "unpaid_absence";
  }

  if (hasManualPunch || type === "outside_work_punch" || scope === "missing_punch") {
    return "manual_punch";
  }

  if (type === "outside_work") {
    return "external_work";
  }

  if (hasPlannedSchedule || type === "schedule_change" || resolution === "reschedule") {
    return "planning_change";
  }

  if (scope === "partial_day" || scope === "early_leave" || scope === "late_arrival" || scope === "exit_return") {
    return "paid_partial_leave";
  }

  if (["permission", "medical_appointment"].includes(type) || ["paid_leave", "approved_work_time", "complete_scheduled_time", "justified_record"].includes(resolution)) {
    return "paid_absence";
  }

  return "other";
}

function defaultAttendanceModeForEffect(effect, exception = {}) {
  if (effect === "manual_punch") return "add_manual_punch";
  if (effect === "external_work") {
    return exception.countsAsWorkedTime === false ? "use_authorized_schedule" : "use_punches";
  }
  if (effect === "paid_absence" || effect === "paid_partial_leave") return "ignore_attendance";
  if (effect === "planning_change") return "use_punches";

  return "none";
}

function defaultPayModeForEffect(effect, exception = {}) {
  if (effect === "unpaid_absence") return "discount";
  if (effect === "external_work") return exception.allowSupplementaryTime === false ? "regular_only" : "regular_and_extra";
  if (effect === "planning_change") return "no_pay_change";
  if (effect === "manual_punch" || effect === "alert_review") return "no_pay_change";
  if (effect === "paid_absence" || effect === "paid_partial_leave") return "regular_only";

  return "none";
}

function normalizeResolutionEffect(value, exception) {
  const effect = String(value || "").trim();

  return EFFECT_VALUES.has(effect) ? effect : resolveOperationalExceptionEffect(exception);
}

function normalizeAttendanceMode(value, effect, exception) {
  const mode = String(value || "").trim();

  return ATTENDANCE_MODE_VALUES.has(mode) ? mode : defaultAttendanceModeForEffect(effect, exception);
}

function normalizePayMode(value, effect, exception) {
  const mode = String(value || "").trim();

  return PAY_MODE_VALUES.has(mode) ? mode : defaultPayModeForEffect(effect, exception);
}

function minutesBetweenTimes(startTime, endTime) {
  if (!/^\d{2}:\d{2}$/.test(startTime || "") || !/^\d{2}:\d{2}$/.test(endTime || "")) {
    return 0;
  }

  const [startHours, startMinutes] = startTime.split(":").map(Number);
  const [endHours, endMinutes] = endTime.split(":").map(Number);
  const startTotal = (startHours * 60) + startMinutes;
  const endTotal = (endHours * 60) + endMinutes;

  return Math.max(0, endTotal - startTotal);
}

export function parseMonthKey(value) {
  const monthKey = String(value || "").trim();

  if (!monthKey) {
    return null;
  }

  const parsed = parse(monthKey, "yyyy-MM", new Date());

  if (!isValid(parsed) || format(parsed, "yyyy-MM") !== monthKey) {
    throw new Error("El mes no es valido.");
  }

  return makeEcuadorDate(parsed.getFullYear(), parsed.getMonth(), 1);
}

export function parseDateKey(value, fieldLabel = "fecha") {
  const dateKey = String(value || "").trim();
  const parsed = parse(dateKey, "yyyy-MM-dd", new Date());

  if (!isValid(parsed) || format(parsed, "yyyy-MM-dd") !== dateKey) {
    throw new Error(`La ${fieldLabel} no es valida.`);
  }

  return {
    dateKey,
    date: makeEcuadorDate(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()),
  };
}

export function buildMonthExceptionQuery(monthKey) {
  const monthDate = parseMonthKey(monthKey);
  const query = { status: { $ne: "void" } };

  if (!monthDate) {
    return query;
  }

  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);

  query.date = { $lte: monthEnd };
  query.$or = [
    { endDate: { $gte: monthStart } },
    { endDate: null },
    { endDateKey: "" },
    { endDate: { $exists: false } },
  ];

  return query;
}

export function normalizeExceptionPayload(body, employee) {
  if (!employee) {
    throw new Error("Empleado no encontrado.");
  }

  const { date, dateKey } = parseDateKey(body?.dateKey, "fecha de la excepcion");
  const cleanEndDateKey = String(body?.endDateKey || "").trim();
  const endDateData = cleanEndDateKey ? parseDateKey(cleanEndDateKey, "fecha de fin") : null;
  const type = normalizeExceptionType(body?.type);
  const scope = String(body?.scope || "full_day").trim();
  const resolution = String(body?.resolution || "pending").trim();
  const registeredBy = String(body?.registeredBy || "").trim().toUpperCase();
  const authorizedBy = String(body?.authorizedBy || "").trim().toUpperCase();
  const startTime = String(body?.startTime || "").trim();
  const endTime = String(body?.endTime || "").trim();
  const plannedStartTime = String(body?.plannedStartTime || "").trim();
  const plannedEndTime = String(body?.plannedEndTime || "").trim();
  const plannedLunchStartTime = String(body?.plannedLunchStartTime || "").trim();
  const plannedLunchEndTime = String(body?.plannedLunchEndTime || "").trim();
  const plannedLunchDurationMinutes = plannedLunchStartTime && plannedLunchEndTime
    ? minutesBetweenTimes(plannedLunchStartTime, plannedLunchEndTime)
    : 0;
  const manualPunchTime = String(body?.manualPunchTime || "").trim();
  const destination = String(body?.destination || "").trim().toUpperCase();
  const countsAsWorkedTime = Boolean(body?.countsAsWorkedTime);
  const allowSupplementaryTime = Boolean(body?.allowSupplementaryTime);
  const status = resolution === "pending" ? "open" : "resolved";
  const effectInput = {
    ...body,
    type,
    scope,
    resolution,
    plannedStartTime,
    plannedEndTime,
    manualPunchTime,
    countsAsWorkedTime,
    allowSupplementaryTime,
  };
  const effect = normalizeResolutionEffect(body?.effect, effectInput);
  const attendanceMode = normalizeAttendanceMode(body?.attendanceMode, effect, effectInput);
  const payMode = normalizePayMode(body?.payMode, effect, effectInput);

  if (!TYPE_VALUES.has(type)) {
    throw new Error("Debes seleccionar un tipo de excepcion valido.");
  }

  if (!RESOLUTION_VALUES.has(resolution)) {
    throw new Error("Debes seleccionar una resolucion valida.");
  }

  if (!SCOPE_VALUES.has(scope)) {
    throw new Error("Debes seleccionar un alcance valido.");
  }

  if (!registeredBy) {
    throw new Error("Debes indicar quien registro la excepcion.");
  }

  if (endDateData && endDateData.date.getTime() < date.getTime()) {
    throw new Error("La fecha de fin no puede ser anterior a la fecha inicial.");
  }

  if (scope === "date_range" && !endDateData) {
    throw new Error("Para varios dias debes indicar una fecha de fin.");
  }

  if (["partial_day", "early_leave", "late_arrival", "outside_work", "exit_return"].includes(scope) && (!startTime || !endTime)) {
    throw new Error("Para justificar horas debes indicar hora de inicio y hora de fin.");
  }

  if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) {
    throw new Error("La hora de inicio no es valida.");
  }

  if (endTime && !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new Error("La hora de fin no es valida.");
  }

  if (plannedStartTime && !/^\d{2}:\d{2}$/.test(plannedStartTime)) {
    throw new Error("La hora de inicio del horario no es valida.");
  }

  if (plannedEndTime && !/^\d{2}:\d{2}$/.test(plannedEndTime)) {
    throw new Error("La hora de fin del horario no es valida.");
  }

  if (plannedLunchStartTime && !/^\d{2}:\d{2}$/.test(plannedLunchStartTime)) {
    throw new Error("La hora de inicio de almuerzo no es valida.");
  }

  if (plannedLunchEndTime && !/^\d{2}:\d{2}$/.test(plannedLunchEndTime)) {
    throw new Error("La hora de fin de almuerzo no es valida.");
  }

  if (type === "outside_work_punch" && !manualPunchTime) {
    throw new Error("Debes indicar la hora de la picada manual.");
  }

  if (manualPunchTime && !/^\d{2}:\d{2}$/.test(manualPunchTime)) {
    throw new Error("La hora de la picada manual no es valida.");
  }

  if (startTime && endTime && endTime <= startTime && !["outside_work", "exit_return"].includes(scope)) {
    throw new Error("La hora de fin debe ser posterior a la hora de inicio.");
  }

  return {
    employee: employee._id,
    employeeName: employee.fullName || "",
    employeeDni: employee.dni || "",
    branchName: employee.branchName || employee.branch || "",
    areaName: employee.areaName || employee.department || "",
    roleName: employee.roleName || "",
    effect,
    attendanceMode,
    payMode,
    type,
    scope,
    date,
    dateKey,
    endDate: endDateData?.date || null,
    endDateKey: endDateData?.dateKey || "",
    startTime,
    endTime,
    plannedStartTime,
    plannedEndTime,
    plannedLunchStartTime,
    plannedLunchEndTime,
    plannedLunchDurationMinutes,
    manualPunchTime,
    destination,
    countsAsWorkedTime,
    allowSupplementaryTime,
    registeredBy,
    authorizedBy,
    resolution,
    resolutionNotes: String(body?.resolutionNotes || "").trim(),
    notes: String(body?.notes || "").trim(),
    status,
  };
}

export function serializeOperationalException(exception) {
  const type = normalizeExceptionType(exception.type);
  const resolution = exception.resolution || "pending";
  const scope = exception.scope || "full_day";
  const effect = normalizeResolutionEffect(exception.effect, exception);
  const attendanceMode = normalizeAttendanceMode(exception.attendanceMode, effect, exception);
  const payMode = normalizePayMode(exception.payMode, effect, exception);

  return {
    id: exception._id.toString(),
    employeeId: exception.employee?.toString?.() || String(exception.employee || ""),
    employeeName: exception.employeeName || "",
    employeeDni: exception.employeeDni || "",
    branchName: exception.branchName || "",
    areaName: exception.areaName || "",
    roleName: exception.roleName || "",
    effect,
    effectLabel: getLabel(RESOLUTION_EFFECTS, effect),
    attendanceMode,
    attendanceModeLabel: getLabel(ATTENDANCE_MODES, attendanceMode),
    payMode,
    payModeLabel: getLabel(PAY_MODES, payMode),
    type,
    typeLabel: getLabel(EXCEPTION_TYPES, type),
    scope,
    scopeLabel: getLabel(EXCEPTION_SCOPES, scope),
    dateKey: exception.dateKey || "",
    endDateKey: exception.endDateKey || "",
    startTime: exception.startTime || "",
    endTime: exception.endTime || "",
    plannedStartTime: exception.plannedStartTime || "",
    plannedEndTime: exception.plannedEndTime || "",
    plannedLunchStartTime: exception.plannedLunchStartTime || "",
    plannedLunchEndTime: exception.plannedLunchEndTime || "",
    plannedLunchDurationMinutes: Number(exception.plannedLunchDurationMinutes) || 0,
    manualPunchId: exception.manualPunch?.toString?.() || String(exception.manualPunch || ""),
    manualPunchTime: exception.manualPunchTime || "",
    destination: exception.destination || "",
    countsAsWorkedTime: Boolean(exception.countsAsWorkedTime),
    allowSupplementaryTime: Boolean(exception.allowSupplementaryTime),
    registeredBy: exception.registeredBy || "",
    authorizedBy: exception.authorizedBy || "",
    resolution,
    resolutionLabel: getLabel(EXCEPTION_RESOLUTIONS, resolution),
    resolutionNotes: exception.resolutionNotes || "",
    notes: exception.notes || "",
    status: exception.status || "open",
    createdAt: exception.createdAt,
    updatedAt: exception.updatedAt,
  };
}
