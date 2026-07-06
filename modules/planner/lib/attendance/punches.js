import { endOfDay, isValid, parseISO, startOfDay } from "date-fns";

import { makeEcuadorDate } from "@/lib/datetime/ecuador";

export function parsePunchDateTime(value) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return null;
  }

  const match = normalizedValue.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T|\s)(\d{2}):(\d{2})(?::(\d{2}))?/,
  );

  if (match) {
    const [, year, month, day, hours, minutes, seconds = "0"] = match;

    return makeEcuadorDate(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
      0,
    );
  }

  const parsed = parseISO(normalizedValue);
  return isValid(parsed) ? parsed : null;
}

export function resolvePunchRange(searchParams) {
  const from = parseISO(String(searchParams.get("from") || ""));
  const to = parseISO(String(searchParams.get("to") || ""));
  const now = new Date();
  const fallbackStart = new Date(now.getFullYear(), now.getMonth(), 1);

  return {
    start: isValid(from) ? startOfDay(from) : startOfDay(fallbackStart),
    end: isValid(to) ? endOfDay(to) : endOfDay(now),
  };
}
