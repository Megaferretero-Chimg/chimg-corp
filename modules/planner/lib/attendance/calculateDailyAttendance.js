import {
  differenceInMinutes,
  endOfDay,
  format,
  isAfter,
  isBefore,
  startOfDay,
} from "date-fns";

import { DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES } from "@/modules/planner/lib/payroll/laborConstants";

const MIN_TWO_PUNCH_SPAN_MINUTES = 60;

function minutesBetween(start, end) {
  return Math.max(0, differenceInMinutes(end, start));
}

function combineDateAndTime(date, timeValue) {
  if (!timeValue) {
    return null;
  }

  const [hours, minutes] = timeValue.split(":").map(Number);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 24 ||
    (hours === 24 && minutes !== 0) ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  const merged = new Date(date);
  merged.setHours(hours, minutes, 0, 0);
  return merged;
}

function resolveStatus({ hasSchedule, punchCount, lateMinutes, earlyLeaveMinutes, overtimeMinutes }) {
  if (!hasSchedule) {
    return "without_schedule";
  }

  if (punchCount !== 2 && punchCount !== 4) {
    return "incomplete";
  }

  if (lateMinutes > 0) {
    return "late";
  }

  if (earlyLeaveMinutes > 0) {
    return "early_leave";
  }

  if (overtimeMinutes > 0) {
    return "overtime";
  }

  return "complete";
}

export default function calculateDailyAttendance({ date, punches, schedule }) {
  const dayDate = startOfDay(date);
  const sortedPunches = [...punches].sort((left, right) => left - right);
  const punchCount = sortedPunches.length;
  const hasValidPunchLayout = punchCount === 2 || punchCount === 4;
  const twoPunchSpanMinutes = punchCount === 2
    ? minutesBetween(sortedPunches[0], sortedPunches[1])
    : null;
  const hasInsufficientTwoPunchSpan = twoPunchSpanMinutes !== null && twoPunchSpanMinutes < MIN_TWO_PUNCH_SPAN_MINUTES;

  const dailyAttendance = {
    date: dayDate,
    checkIn: sortedPunches[0] || null,
    lunchOut: punchCount >= 4 ? sortedPunches[1] : null,
    lunchIn: punchCount >= 4 ? sortedPunches[2] : null,
    checkOut: sortedPunches[punchCount - 1] || null,
    workedMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    status: "incomplete",
    notes: "",
  };

  if (!hasValidPunchLayout) {
    dailyAttendance.notes = `Picadas incompletas (${punchCount}) para ${format(dayDate, "dd/MM/yyyy")}.`;
  } else if (punchCount === 2 && hasInsufficientTwoPunchSpan) {
    dailyAttendance.notes = `Picadas incompletas (${twoPunchSpanMinutes}m) para ${format(dayDate, "dd/MM/yyyy")}.`;
  } else if (punchCount === 2) {
    dailyAttendance.workedMinutes = minutesBetween(
      sortedPunches[0],
      sortedPunches[1],
    );
  } else {
    dailyAttendance.workedMinutes =
      minutesBetween(sortedPunches[0], sortedPunches[1]) +
      minutesBetween(sortedPunches[2], sortedPunches[3]);
  }

  if (schedule?.isWorkingDay === false) {
    dailyAttendance.notes = dailyAttendance.notes
      ? `${dailyAttendance.notes} Día marcado como no laborable.`
      : "Día marcado como no laborable.";
  }

  if (schedule && hasValidPunchLayout && !hasInsufficientTwoPunchSpan) {
    const scheduleStart = combineDateAndTime(dayDate, schedule.startTime);
    const scheduleEnd = combineDateAndTime(dayDate, schedule.endTime);
    const graceMinutes = schedule.graceMinutes || 0;

    if (scheduleStart && dailyAttendance.checkIn && isAfter(dailyAttendance.checkIn, scheduleStart)) {
      const lateDifference = differenceInMinutes(dailyAttendance.checkIn, scheduleStart);
      dailyAttendance.lateMinutes = Math.max(0, lateDifference - graceMinutes);
    }

    if (scheduleEnd && dailyAttendance.checkOut) {
      const lateDepartureToleranceMinutes = Math.max(
        0,
        Number(schedule.lateDepartureToleranceMinutes ?? DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES) || 0,
      );

      if (isBefore(dailyAttendance.checkOut, scheduleEnd)) {
        dailyAttendance.earlyLeaveMinutes = differenceInMinutes(
          scheduleEnd,
          dailyAttendance.checkOut,
        );
      }

      if (isAfter(dailyAttendance.checkOut, scheduleEnd)) {
        const rawOvertimeMinutes = differenceInMinutes(
          dailyAttendance.checkOut,
          scheduleEnd,
        );
        dailyAttendance.overtimeMinutes =
          rawOvertimeMinutes > lateDepartureToleranceMinutes ? rawOvertimeMinutes : 0;
      }
    }
  }

  dailyAttendance.status = resolveStatus({
    hasSchedule: Boolean(schedule),
    punchCount: hasInsufficientTwoPunchSpan ? 1 : punchCount,
    lateMinutes: dailyAttendance.lateMinutes,
    earlyLeaveMinutes: dailyAttendance.earlyLeaveMinutes,
    overtimeMinutes: dailyAttendance.overtimeMinutes,
  });

  if (!schedule) {
    dailyAttendance.notes = dailyAttendance.notes
      ? `${dailyAttendance.notes} No existe horario configurado.`
      : "No existe horario configurado.";
  }

  if (dailyAttendance.checkOut && isAfter(dailyAttendance.checkOut, endOfDay(dayDate))) {
    dailyAttendance.notes = dailyAttendance.notes
      ? `${dailyAttendance.notes} Se detectó una salida fuera del mismo día calendario.`
      : "Se detectó una salida fuera del mismo día calendario.";
  }

  return dailyAttendance;
}
