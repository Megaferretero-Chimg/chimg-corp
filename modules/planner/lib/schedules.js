import { addDays, format, isValid, parseISO, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";

export const DAY_TYPES = [
  { value: "workday", label: "Laboral normal", isPaidDay: false, isWorkingDay: true },
  { value: "vacation", label: "Vacaciones", isPaidDay: true, isWorkingDay: false },
  { value: "holiday", label: "Feriado", isPaidDay: true, isWorkingDay: false },
  { value: "weekend_overtime", label: "Extraordinario", isPaidDay: false, isWorkingDay: true },
  { value: "off_day", label: "No trabaja", isPaidDay: false, isWorkingDay: false },
];

export const WEEK_DAYS = [
  { dayOfWeek: 1, label: "Lunes" },
  { dayOfWeek: 2, label: "Martes" },
  { dayOfWeek: 3, label: "Miércoles" },
  { dayOfWeek: 4, label: "Jueves" },
  { dayOfWeek: 5, label: "Viernes" },
  { dayOfWeek: 6, label: "Sábado" },
  { dayOfWeek: 0, label: "Domingo" },
];

export function buildDefaultWeeklySchedule() {
  return WEEK_DAYS.map((day) => ({
    dayOfWeek: day.dayOfWeek,
    label: day.label,
    dayType: day.dayOfWeek === 0 ? "off_day" : day.dayOfWeek === 6 ? "weekend_overtime" : "workday",
    startTime: "",
    lunchDurationMinutes: day.dayOfWeek === 0 ? 0 : 60,
    hasLunch: day.dayOfWeek !== 0,
    endTime: "",
    graceMinutes: 10,
    isWorkingDay: day.dayOfWeek === 0 || day.dayOfWeek === 6 ? true : true,
    isPaidDay: false,
  }));
}

export function getWeekStartDate(value = new Date()) {
  return startOfWeek(value, { weekStartsOn: 1 });
}

export function formatWeekStartKey(value = new Date()) {
  return format(getWeekStartDate(value), "yyyy-MM-dd");
}

export function normalizeWeekStartKey(value) {
  if (!value) {
    return formatWeekStartKey();
  }

  const parsed = parseISO(String(value));

  if (!isValid(parsed)) {
    return formatWeekStartKey();
  }

  return formatWeekStartKey(parsed);
}

export function formatWeekRangeLabel(weekStartKey) {
  const weekStartDate = getWeekStartDate(parseISO(normalizeWeekStartKey(weekStartKey)));
  const weekEndDate = addDays(weekStartDate, 6);

  return `${format(weekStartDate, "d MMM", { locale: es })} al ${format(weekEndDate, "d MMM yyyy", {
    locale: es,
  })}`;
}
