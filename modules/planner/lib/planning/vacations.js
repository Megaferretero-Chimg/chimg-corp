import { addDays, differenceInCalendarDays, endOfMonth, format, isValid, parse, startOfMonth } from "date-fns";

import { makeEcuadorDate } from "@/lib/datetime/ecuador";

export const APPROVED_VACATION_STATUS_QUERY = {
  $nin: ["pending", "rejected"],
};

const VACATION_STATUS_LABELS = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
};

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
  const coveredDateKeys = [];

  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    coveredDateKeys.push(format(date, "yyyy-MM-dd"));
  }

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
    coveredDateKeys,
    totalCalendarDays,
    notes: String(body?.notes || "").trim(),
  };
}

export function buildMonthVacationQuery(monthKey) {
  const monthDate = parseMonthKey(monthKey);

  if (!monthDate) {
    return {};
  }

  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);

  return {
    startDate: { $lte: monthEnd },
    endDate: { $gte: monthStart },
  };
}

export function serializeVacationRecord(vacation) {
  const status = ["pending", "approved", "rejected"].includes(vacation.status)
    ? vacation.status
    : "approved";

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
    notes: vacation.notes || "",
    status,
    statusLabel: VACATION_STATUS_LABELS[status],
    requestedBy: vacation.requestedBy || "",
    requestedByUser: vacation.requestedByUser || "",
    reviewedAt: vacation.reviewedAt || null,
    reviewedBy: vacation.reviewedBy || "",
    reviewedByUser: vacation.reviewedByUser || "",
    reviewNotes: vacation.reviewNotes || "",
    createdAt: vacation.createdAt,
    updatedAt: vacation.updatedAt,
  };
}
