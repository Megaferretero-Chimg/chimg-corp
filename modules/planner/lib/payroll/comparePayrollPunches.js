import {
  addMinutes,
  differenceInMinutes,
  eachDayOfInterval,
  isAfter,
  isBefore,
  isEqual,
} from "date-fns";

import { dedupePunchesByMinute } from "@/modules/planner/lib/attendance/punchIdentity";
import {
  formatEcuadorDate,
  formatEcuadorDateKey,
  formatEcuadorTime,
  getEcuadorParts,
  setEcuadorTime,
  startOfEcuadorDay,
} from "@/lib/datetime/ecuador";
import { DAY_TYPES, formatWeekStartKey, getWeekStartDate } from "@/modules/planner/lib/schedules";
import { DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES } from "@/modules/planner/lib/payroll/laborConstants";

const DAY_TYPE_LABELS = new Map(DAY_TYPES.map((item) => [item.value, item.label]));
const SUPPLEMENTARY_ROUNDING_THRESHOLD_MINUTES = 5;
const REGULAR_DAILY_LIMIT_MINUTES = 8 * 60;

function combineDateAndTime(date, timeValue) {
  if (!timeValue) {
    return null;
  }

  const [hours, minutes] = String(timeValue)
    .split(":")
    .map((value) => Number(value));

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return setEcuadorTime(date, {
    hours,
    minutes,
    seconds: 0,
    milliseconds: 0,
  });
}

function formatMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) {
    return "--";
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (!hours) {
    return `${remainingMinutes}m`;
  }

  if (!remainingMinutes) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

function formatTime(date) {
  if (!date) {
    return "--";
  }

  return formatEcuadorTime(date);
}

function resolveSupplementaryHours(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 0;
  }

  return Math.floor((minutes + SUPPLEMENTARY_ROUNDING_THRESHOLD_MINUTES) / 60);
}

function formatPunchChip(punch) {
  return {
    id: punch._id?.toString?.() || punch.id || `${punch.punchedAt}`,
    time: formatTime(punch.punchedAt),
    rawValue: punch.rawValue || "",
    punchedAt: punch.punchedAt,
  };
}

function buildScheduleSummary(schedule) {
  if (!schedule) {
    return "Sin horario configurado";
  }

  const dayTypeLabel = DAY_TYPE_LABELS.get(schedule.dayType) || "Horario";

  if (!schedule.isWorkingDay || schedule.dayType === "off_day") {
    return dayTypeLabel;
  }

  const lunchLabel =
    schedule.hasLunch && schedule.lunchDurationMinutes > 0
      ? ` · Almuerzo ${formatMinutes(schedule.lunchDurationMinutes)}`
      : "";

  return `${schedule.startTime || "--"} - ${schedule.endTime || "--"}${lunchLabel}`;
}

function resolveScheduledWorkedMinutes(schedule, date) {
  if (!schedule?.isWorkingDay) {
    return 0;
  }

  const scheduleStart = combineDateAndTime(date, schedule.startTime);
  const scheduleEnd = combineDateAndTime(date, schedule.endTime);

  if (!scheduleStart || !scheduleEnd || !isAfter(scheduleEnd, scheduleStart)) {
    return 0;
  }

  const lunchDiscountMinutes =
    schedule.hasLunch && schedule.lunchDurationMinutes > 0 ? schedule.lunchDurationMinutes : 0;

  return Math.max(differenceInMinutes(scheduleEnd, scheduleStart) - lunchDiscountMinutes, 0);
}

function pickNearestPunch(punches, target, predicate = () => true) {
  if (!target) {
    return null;
  }

  const candidates = punches.filter(predicate);

  if (!candidates.length) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const distanceLeft = Math.abs(differenceInMinutes(left.punchedAt, target));
    const distanceRight = Math.abs(differenceInMinutes(right.punchedAt, target));

    if (distanceLeft !== distanceRight) {
      return distanceLeft - distanceRight;
    }

    return left.punchedAt - right.punchedAt;
  })[0];
}

function pickLunchPair(candidates, expectedLunchOut, expectedLunchIn, lunchDurationMinutes) {
  if (!expectedLunchOut || !expectedLunchIn || candidates.length < 2) {
    return { lunchOut: null, lunchIn: null };
  }

  let bestPair = null;

  for (let startIndex = 0; startIndex < candidates.length - 1; startIndex += 1) {
    for (let endIndex = startIndex + 1; endIndex < candidates.length; endIndex += 1) {
      const lunchOut = candidates[startIndex];
      const lunchIn = candidates[endIndex];
      const lunchGap = Math.max(0, differenceInMinutes(lunchIn.punchedAt, lunchOut.punchedAt));
      const score =
        Math.abs(lunchGap - lunchDurationMinutes) +
        Math.abs(differenceInMinutes(lunchOut.punchedAt, expectedLunchOut)) +
        Math.abs(differenceInMinutes(lunchIn.punchedAt, expectedLunchIn));

      if (!bestPair || score < bestPair.score) {
        bestPair = {
          score,
          lunchOut,
          lunchIn,
        };
      }
    }
  }

  return {
    lunchOut: bestPair?.lunchOut || null,
    lunchIn: bestPair?.lunchIn || null,
  };
}

function buildExpectedLunchWindow(schedule, date) {
  if (!schedule?.hasLunch || !schedule?.lunchDurationMinutes) {
    return { expectedLunchOut: null, expectedLunchIn: null };
  }

  const scheduleStart = combineDateAndTime(date, schedule.startTime);
  const scheduleEnd = combineDateAndTime(date, schedule.endTime);

  if (!scheduleStart || !scheduleEnd || !isAfter(scheduleEnd, scheduleStart)) {
    return { expectedLunchOut: null, expectedLunchIn: null };
  }

  const totalMinutes = differenceInMinutes(scheduleEnd, scheduleStart);
  const activeWorkMinutes = Math.max(totalMinutes - schedule.lunchDurationMinutes, 0);
  const expectedLunchOut = addMinutes(scheduleStart, Math.round(activeWorkMinutes / 2));
  const expectedLunchIn = addMinutes(expectedLunchOut, schedule.lunchDurationMinutes);

  return { expectedLunchOut, expectedLunchIn };
}

function compareDay({ date, punches, schedule, scheduleRules }) {
  const sortedPunches = dedupePunchesByMinute(punches.filter((punch) => punch.isIgnored !== true))
    .sort((left, right) => left.punchedAt - right.punchedAt);
  const scheduleStart = schedule ? combineDateAndTime(date, schedule.startTime) : null;
  const scheduleEnd = schedule ? combineDateAndTime(date, schedule.endTime) : null;
  const scheduledWorkedMinutes = resolveScheduledWorkedMinutes(schedule, date);
  const lateDepartureToleranceMinutes = Math.max(
    0,
    Number(scheduleRules?.lateDepartureToleranceMinutes ?? DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES) || 0,
  );
  const notes = [];

  if (!schedule) {
    notes.push("No existe horario cargado para esta fecha.");
  }

  if (schedule && schedule.isWorkingDay && (!scheduleStart || !scheduleEnd)) {
    notes.push("El horario existe, pero está incompleto para comparar entrada y salida.");
  }

  if (!sortedPunches.length) {
    if (schedule?.isWorkingDay) {
      notes.push("No hay picadas registradas para un día laborable.");
    }

    const hasMissingPunches = Boolean(schedule?.isWorkingDay);

    return {
      dayLabel: new Intl.DateTimeFormat("es-EC", {
        timeZone: "America/Guayaquil",
        weekday: "long",
      }).format(date),
      dateLabel: formatEcuadorDate(date),
      dateKey: formatEcuadorDateKey(date),
      schedule: schedule
        ? {
            dayType: schedule.dayType,
            dayTypeLabel: DAY_TYPE_LABELS.get(schedule.dayType) || schedule.dayType,
            startTime: schedule.startTime || "",
            endTime: schedule.endTime || "",
            hasLunch: Boolean(schedule.hasLunch),
            lunchDurationMinutes: schedule.lunchDurationMinutes || 0,
            summary: buildScheduleSummary(schedule),
          }
        : null,
      punches: [],
      matched: {
        checkIn: null,
        lunchOut: null,
        lunchIn: null,
        checkOut: null,
      },
      workedMinutes: null,
      workedLabel: "--",
      alertTags: notes,
      extraPunches: [],
      hasMissingPunches,
      hasOvertimeCandidate: false,
      overtimeCandidateMinutes: 0,
      overtimeCandidateHours: 0,
      lateDepartureToleranceMinutes,
      rawOvertimeCandidateMinutes: 0,
      baseWorkedMinutes: null,
      extraWorkedMinutes: 0,
      lateArrivalMinutes: 0,
      hasLateArrival: false,
      scheduledWorkedMinutes,
      punchCount: 0,
      hasSinglePunchCandidate: false,
    };
  }

  const checkInPunch = sortedPunches[0] || null;
  const checkOutPunch = sortedPunches[sortedPunches.length - 1] || null;

  const middlePunches = sortedPunches.filter(
    (candidate) =>
      candidate !== checkInPunch &&
      candidate !== checkOutPunch &&
      (isAfter(candidate.punchedAt, checkInPunch.punchedAt) ||
        isEqual(candidate.punchedAt, checkInPunch.punchedAt)) &&
      (isBefore(candidate.punchedAt, checkOutPunch.punchedAt) ||
        isEqual(candidate.punchedAt, checkOutPunch.punchedAt)),
  );

  const { expectedLunchOut, expectedLunchIn } = buildExpectedLunchWindow(schedule, date);
  const { lunchOut, lunchIn } = pickLunchPair(
    middlePunches,
    expectedLunchOut,
    expectedLunchIn,
    schedule?.lunchDurationMinutes || 0,
  );

  const assignedPunches = [checkInPunch, lunchOut, lunchIn, checkOutPunch].filter(Boolean);
  const extraPunches = sortedPunches.filter((candidate) => !assignedPunches.includes(candidate));

  let workedMinutes = null;

  if (checkInPunch && checkOutPunch && isAfter(checkOutPunch.punchedAt, checkInPunch.punchedAt)) {
    workedMinutes = differenceInMinutes(checkOutPunch.punchedAt, checkInPunch.punchedAt);
    const lunchDiscountMinutes =
      schedule?.hasLunch && schedule?.lunchDurationMinutes > 0
        ? schedule.lunchDurationMinutes
        : 0;

    workedMinutes = Math.max(workedMinutes - lunchDiscountMinutes, 0);
  }

  const baseWorkedMinutes =
    schedule?.dayType === "workday" && Number.isFinite(workedMinutes)
      ? Math.min(workedMinutes, REGULAR_DAILY_LIMIT_MINUTES)
      : schedule?.dayType === "weekend_overtime"
        ? 0
        : workedMinutes;
  const extraWorkedMinutes =
    schedule?.dayType === "workday" && Number.isFinite(workedMinutes) && workedMinutes > REGULAR_DAILY_LIMIT_MINUTES
      ? workedMinutes - REGULAR_DAILY_LIMIT_MINUTES
      : schedule?.dayType === "weekend_overtime" && Number.isFinite(workedMinutes)
        ? workedMinutes
        : 0;

  if (extraPunches.length) {
    notes.push("Hay picadas adicionales que no entraron en la lectura sugerida.");
  }

  if (schedule?.isWorkingDay && scheduleStart && checkInPunch) {
    if (isAfter(checkInPunch.punchedAt, scheduleStart)) {
      notes.push("Posible atraso en la entrada.");
    }
  }

  const lateArrivalMinutes =
    schedule?.isWorkingDay && scheduleStart && checkInPunch && isAfter(checkInPunch.punchedAt, scheduleStart)
      ? differenceInMinutes(checkInPunch.punchedAt, scheduleStart)
      : 0;

  const scheduleOvertimeMinutes =
    schedule?.dayType === "workday" && scheduleEnd && checkOutPunch && isAfter(checkOutPunch.punchedAt, scheduleEnd)
      ? differenceInMinutes(checkOutPunch.punchedAt, scheduleEnd)
      : 0;
  const overtimeCandidateMinutes = schedule?.dayType === "workday"
    ? scheduleOvertimeMinutes > lateDepartureToleranceMinutes
      ? scheduleOvertimeMinutes
      : 0
    : 0;
  const overtimeCandidateHours = resolveSupplementaryHours(overtimeCandidateMinutes);

  if (schedule?.dayType === "workday" && scheduleEnd && checkOutPunch) {
    if (overtimeCandidateMinutes > 0) {
      notes.push("La salida supera la tolerancia posterior al horario. Revisar si corresponde a tiempo suplementario.");
    }

    if (isBefore(checkOutPunch.punchedAt, scheduleEnd)) {
      notes.push("Posible salida antes del horario.");
    }
  }

  const hasMissingPunches = Boolean(
    schedule?.isWorkingDay &&
      (
        sortedPunches.length < 2 ||
        !checkInPunch ||
        !checkOutPunch ||
        isEqual(checkInPunch.punchedAt, checkOutPunch.punchedAt) ||
        (schedule?.hasLunch && sortedPunches.length < 4)
      ),
  );
  const needsManualDayReview = Boolean(
    schedule?.dayType === "workday" && hasMissingPunches && sortedPunches.length > 0,
  );
  const hasSinglePunchCandidate = Boolean(
    schedule?.isWorkingDay && sortedPunches.length === 1 && checkInPunch && checkOutPunch && isEqual(checkInPunch.punchedAt, checkOutPunch.punchedAt),
  );
  const missingPunchesReason = needsManualDayReview
    ? "No cuenta con los registros necesarios para validar la jornada."
    : "";

  const effectiveLateArrivalMinutes = needsManualDayReview ? 0 : lateArrivalMinutes;
  const effectiveHasLateArrival = needsManualDayReview ? false : lateArrivalMinutes > 0;
  const effectiveOvertimeCandidateMinutes = needsManualDayReview ? 0 : overtimeCandidateMinutes;
  const effectiveOvertimeCandidateHours = needsManualDayReview ? 0 : overtimeCandidateHours;

  return {
    dayLabel: new Intl.DateTimeFormat("es-EC", {
      timeZone: "America/Guayaquil",
      weekday: "long",
    }).format(date),
    dateLabel: formatEcuadorDate(date),
    dateKey: formatEcuadorDateKey(date),
    schedule: schedule
      ? {
          dayType: schedule.dayType,
          dayTypeLabel: DAY_TYPE_LABELS.get(schedule.dayType) || schedule.dayType,
          startTime: schedule.startTime || "",
          endTime: schedule.endTime || "",
          hasLunch: Boolean(schedule.hasLunch),
          lunchDurationMinutes: schedule.lunchDurationMinutes || 0,
          summary: buildScheduleSummary(schedule),
        }
      : null,
    punches: sortedPunches.map(formatPunchChip),
    matched: {
      checkIn: checkInPunch ? formatTime(checkInPunch.punchedAt) : "--",
      lunchOut: lunchOut ? formatTime(lunchOut.punchedAt) : "--",
      lunchIn: lunchIn ? formatTime(lunchIn.punchedAt) : "--",
      checkOut: checkOutPunch ? formatTime(checkOutPunch.punchedAt) : "--",
    },
    workedMinutes,
    workedLabel: formatMinutes(workedMinutes),
    alertTags: notes,
    extraPunches: extraPunches.map(formatPunchChip),
    hasMissingPunches,
    hasOvertimeCandidate: effectiveOvertimeCandidateMinutes > 0,
    overtimeCandidateMinutes: effectiveOvertimeCandidateMinutes,
    overtimeCandidateHours: effectiveOvertimeCandidateHours,
    lateDepartureToleranceMinutes,
    rawOvertimeCandidateMinutes: needsManualDayReview ? 0 : scheduleOvertimeMinutes,
    baseWorkedMinutes: needsManualDayReview ? null : baseWorkedMinutes,
    extraWorkedMinutes: needsManualDayReview ? 0 : extraWorkedMinutes,
    lateArrivalMinutes: effectiveLateArrivalMinutes,
    hasLateArrival: effectiveHasLateArrival,
    scheduledWorkedMinutes,
    punchCount: sortedPunches.length,
    hasSinglePunchCandidate,
    needsManualDayReview,
    missingPunchesReason,
  };
}

export default function comparePayrollPunches({ start, end, punches, schedules, scheduleRules }) {
  const allDates = eachDayOfInterval({
    start: startOfEcuadorDay(start),
    end: startOfEcuadorDay(end),
  });

  const punchesByDate = new Map();

  punches.forEach((punch) => {
    const dateKey = formatEcuadorDateKey(punch.punchedAt);

    if (!punchesByDate.has(dateKey)) {
      punchesByDate.set(dateKey, []);
    }

    punchesByDate.get(dateKey).push(punch);
  });

  const schedulesByDay = new Map(
    schedules.map((schedule) => [`${schedule.weekKey}-${schedule.dayOfWeek}`, schedule]),
  );

  const missingScheduleDates = [];

  const comparisons = allDates.map((date) => {
    const weekKey = formatWeekStartKey(getWeekStartDate(date));
    const dayParts = getEcuadorParts(date);
    const dayKey = `${weekKey}-${dayParts?.dayOfWeek ?? date.getDay()}`;
    const schedule = schedulesByDay.get(dayKey) || null;

    if (!schedule) {
      missingScheduleDates.push(formatEcuadorDate(date));
    }

    return compareDay({
      date,
      punches: punchesByDate.get(formatEcuadorDateKey(date)) || [],
      schedule,
      scheduleRules,
    });
  });

  return {
    isComplete: missingScheduleDates.length === 0,
    missingScheduleDates,
    comparisons,
  };
}
