import { differenceInCalendarDays, endOfMonth, format, isValid, parse, startOfMonth } from "date-fns";

import { makeEcuadorDate } from "@/lib/datetime/ecuador";

export const VACATION_NOTICE_DAYS = 30;

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

export function normalizeVacationPayload(body, employee) {
  const { date: startDate, dateKey: startDateKey } = parseDateKey(body?.startDateKey, "fecha de inicio");
  const { date: endDate, dateKey: endDateKey } = parseDateKey(body?.endDateKey, "fecha de fin");

  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("La fecha de fin no puede ser anterior a la fecha de inicio.");
  }

  if (!employee) {
    throw new Error("Empleado no encontrado.");
  }

  const totalCalendarDays = differenceInCalendarDays(endDate, startDate) + 1;

  return {
    employee: employee._id,
    employeeName: employee.fullName || "",
    employeeDni: employee.dni || "",
    branchName: employee.branchName || employee.branch || "",
    areaName: employee.areaName || employee.department || "",
    roleName: employee.roleName || "",
    startDate,
    endDate,
    startDateKey,
    endDateKey,
    totalCalendarDays,
    status: "scheduled",
    notes: String(body?.notes || "").trim(),
  };
}

export function buildMonthVacationQuery(monthKey) {
  const monthDate = parseMonthKey(monthKey);

  if (!monthDate) {
    return { status: "scheduled" };
  }

  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);

  return {
    status: "scheduled",
    startDate: { $lte: monthEnd },
    endDate: { $gte: monthStart },
  };
}

export function buildVacationWarnings(vacation) {
  const today = new Date();
  const noticeDays = differenceInCalendarDays(vacation.startDate, today);
  const warnings = [];

  if (noticeDays < VACATION_NOTICE_DAYS) {
    warnings.push(`La solicitud no cumple ${VACATION_NOTICE_DAYS} dias de anticipacion.`);
  }

  return warnings;
}

export function serializeVacationRequest(vacation) {
  const warnings = buildVacationWarnings(vacation);

  return {
    id: vacation._id.toString(),
    employeeId: vacation.employee?.toString?.() || String(vacation.employee || ""),
    employeeName: vacation.employeeName || "",
    employeeDni: vacation.employeeDni || "",
    branchName: vacation.branchName || "",
    areaName: vacation.areaName || "",
    roleName: vacation.roleName || "",
    startDateKey: vacation.startDateKey || "",
    endDateKey: vacation.endDateKey || "",
    totalCalendarDays: vacation.totalCalendarDays || 0,
    requestedAt: vacation.requestedAt || null,
    status: vacation.status || "scheduled",
    notes: vacation.notes || "",
    warnings,
    createdAt: vacation.createdAt,
    updatedAt: vacation.updatedAt,
  };
}
