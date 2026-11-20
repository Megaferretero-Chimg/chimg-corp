import { format, isValid, parse } from "date-fns";

import { makeEcuadorDate } from "@/lib/datetime/ecuador";

export function parseDateKey(value) {
  const dateKey = String(value || "").trim();
  const parsed = parse(dateKey, "yyyy-MM-dd", new Date());

  if (!isValid(parsed) || format(parsed, "yyyy-MM-dd") !== dateKey) {
    throw new Error("La fecha del feriado no es valida.");
  }

  return {
    dateKey,
    date: makeEcuadorDate(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()),
  };
}

export function parseMonthKey(value) {
  const monthKey = String(value || "").trim();
  const parsed = parse(monthKey, "yyyy-MM", new Date());

  if (!isValid(parsed) || format(parsed, "yyyy-MM") !== monthKey) {
    throw new Error("El mes seleccionado no es valido.");
  }

  return {
    monthKey,
    year: parsed.getFullYear(),
    monthIndex: parsed.getMonth(),
  };
}

export function normalizeHolidayPayload(body) {
  const { dateKey, date } = parseDateKey(body?.dateKey);
  const name = String(body?.name || "").trim().toUpperCase();

  if (!name) {
    throw new Error("El nombre del feriado es obligatorio.");
  }

  const scope = body?.scope ?? "all";
  if (!["all", "branches"].includes(scope)) throw new Error("Selecciona un alcance válido.");
  if (scope === "branches" && !Array.isArray(body?.branchCodes)) {
    throw new Error("Selecciona al menos una sucursal.");
  }
  const branchCodes = scope === "branches"
    ? [...new Set(body.branchCodes.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean))]
    : [];
  if (scope === "branches" && !branchCodes.length) throw new Error("Selecciona al menos una sucursal.");

  return { date, dateKey, name, scope, branchCodes };
}

export function serializeHoliday(holiday) {
  return {
    id: holiday._id.toString(),
    dateKey: holiday.dateKey || "",
    name: holiday.name || "",
    scope: holiday.scope || "all",
    branchCodes: holiday.scope === "branches" ? holiday.branchCodes || [] : [],
    date: holiday.date || null,
    createdAt: holiday.createdAt,
    updatedAt: holiday.updatedAt,
  };
}
