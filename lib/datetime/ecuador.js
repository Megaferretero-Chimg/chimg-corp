export const ECUADOR_TIME_ZONE = "America/Guayaquil";
const ECUADOR_OFFSET_HOURS = -5;
const ECUADOR_OFFSET_MINUTES = ECUADOR_OFFSET_HOURS * 60;

function pad(value) {
  return String(value).padStart(2, "0");
}

export function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function makeEcuadorDate(
  year,
  monthIndex,
  day,
  hours = 0,
  minutes = 0,
  seconds = 0,
  milliseconds = 0,
) {
  return new Date(
    Date.UTC(
      year,
      monthIndex,
      day,
      hours - ECUADOR_OFFSET_HOURS,
      minutes,
      seconds,
      milliseconds,
    ),
  );
}

export function normalizeToEcuadorDate(value) {
  const parsed = value instanceof Date ? value : new Date(value);

  if (!isValidDate(parsed)) {
    return null;
  }

  return makeEcuadorDate(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    parsed.getHours(),
    parsed.getMinutes(),
    parsed.getSeconds(),
    parsed.getMilliseconds(),
  );
}

export function getEcuadorShiftedDate(value) {
  const parsed = value instanceof Date ? value : new Date(value);

  if (!isValidDate(parsed)) {
    return null;
  }

  return new Date(parsed.getTime() + ECUADOR_OFFSET_MINUTES * 60 * 1000);
}

export function getEcuadorParts(value) {
  const shifted = getEcuadorShiftedDate(value);

  if (!shifted) {
    return null;
  }

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    seconds: shifted.getUTCSeconds(),
    milliseconds: shifted.getUTCMilliseconds(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

export function startOfEcuadorDay(value) {
  const parts = getEcuadorParts(value);

  if (!parts) {
    return null;
  }

  return makeEcuadorDate(parts.year, parts.monthIndex, parts.day, 0, 0, 0, 0);
}

export function setEcuadorTime(value, { hours = 0, minutes = 0, seconds = 0, milliseconds = 0 }) {
  const parts = getEcuadorParts(value);

  if (!parts) {
    return null;
  }

  return makeEcuadorDate(
    parts.year,
    parts.monthIndex,
    parts.day,
    hours,
    minutes,
    seconds,
    milliseconds,
  );
}

export function formatEcuadorDateKey(value) {
  const parts = getEcuadorParts(value);

  if (!parts) {
    return "";
  }

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function formatEcuadorMonthKey(value = new Date()) {
  const parts = getEcuadorParts(value);

  if (!parts) {
    return "";
  }

  return `${parts.year}-${pad(parts.month)}`;
}

export function formatPayrollDefaultMonthKey(value = new Date()) {
  const parts = getEcuadorParts(value);

  if (!parts) {
    return "";
  }

  if (parts.day >= 6) {
    return `${parts.year}-${pad(parts.month)}`;
  }

  return formatEcuadorMonthKey(
    makeEcuadorDate(parts.year, parts.monthIndex - 1, 1),
  );
}

export function formatEcuadorTime(value) {
  const parts = getEcuadorParts(value);

  if (!parts) {
    return "N/D";
  }

  return `${pad(parts.hours)}:${pad(parts.minutes)}`;
}

export function formatEcuadorDate(value) {
  const parts = getEcuadorParts(value);

  if (!parts) {
    return "N/D";
  }

  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
}

export function formatEcuadorDateTime(value) {
  const parts = getEcuadorParts(value);

  if (!parts) {
    return "N/D";
  }

  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} ${pad(parts.hours)}:${pad(parts.minutes)}`;
}

export function isValidTime24(value, { allowEmpty = false } = {}) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return allowEmpty;

  const match = cleanValue.match(/^(\d{2}):(\d{2})$/);

  if (!match) return false;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  return minutes <= 59 && (hours < 24 || (hours === 24 && minutes === 0));
}

export function formatTime24(value, fallback = "") {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{1,2})$/);

  if (!match) return fallback;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) return fallback;

  return `${pad(hours)}:${pad(minutes)}`;
}

export function formatTimeText24(value) {
  return String(value || "").replace(
    /\b(\d{1,2})\s*([Hh.]|:)\s*(\d{2})\b/g,
    (match, hoursValue, _separator, minutesValue) => {
      const hours = Number(hoursValue);
      const minutes = Number(minutesValue);

      if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) {
        return match;
      }

      return `${pad(hours)}:${pad(minutes)}`;
    },
  );
}

export function formatEcuadorDateTimeLabel(
  value,
  { fallback = "N/D", dateStyle = "medium" } = {},
) {
  const parsed = value instanceof Date ? value : new Date(value);

  if (!isValidDate(parsed)) return fallback;

  return new Intl.DateTimeFormat("es-EC", {
    dateStyle,
    timeStyle: "short",
    timeZone: ECUADOR_TIME_ZONE,
    hourCycle: "h23",
  }).format(parsed);
}
