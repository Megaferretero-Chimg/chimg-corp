import {
  differenceInMinutes,
  eachDayOfInterval,
  endOfMonth,
  format,
  isAfter,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";

import { formatTime24 } from "@/lib/datetime/ecuador";
import comparePayrollPunches from "@/modules/planner/lib/payroll/comparePayrollPunches";
import { attendancePayrollPolicy, isPlannedAttendanceExempt, plannedAttendanceExemptionLabel } from "@/modules/planner/lib/attendance/exemptions";
import {
  ECUADOR_DAILY_BASE_HOURS,
  EXTRAORDINARY_PAY_MULTIPLIER,
  MONTHLY_HOURLY_DIVISOR,
  SUPPLEMENTARY_PAY_MULTIPLIER,
} from "@/modules/planner/lib/payroll/laborConstants";
import { calculatePayrollAdditionalRate, calculatePayrollHourlyRate } from "@/modules/planner/lib/payroll/rates";

const REGULAR_DAILY_HOURS = ECUADOR_DAILY_BASE_HOURS;

function formatMoney(value) {
  if (!Number.isFinite(value)) {
    return "$0.00";
  }

  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatHours(hours) {
  if (!Number.isFinite(hours) || hours <= 0) {
    return "0h";
  }

  const totalMinutes = Math.round(hours * 60);
  const fullHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  if (!fullHours) {
    return `${remainingMinutes}m`;
  }

  if (!remainingMinutes) {
    return `${fullHours}h`;
  }

  return `${fullHours}h ${remainingMinutes}m`;
}

function formatDailyDiscount(absenceHours, lateMinutes, regularShortfallMinutes = 0) {
  const parts = [];

  if (absenceHours > 0) {
    parts.push(`${absenceHours}h`);
  }

  if (lateMinutes > 0) {
    parts.push(`${lateMinutes}m`);
  }

  if (regularShortfallMinutes > 0) {
    parts.push(`${regularShortfallMinutes}m faltantes`);
  }

  return parts.length ? parts.join(" + ") : "--";
}

function formatHourForSchedule(value) {
  return formatTime24(value, "--");
}

function formatLunchDuration(minutes) {
  if (!minutes) {
    return "sin almuerzo";
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (!hours) {
    return `${remainingMinutes}m`;
  }

  if (!remainingMinutes) {
    return `${hours}h`;
  }

  return `${hours}h${remainingMinutes}`;
}

function buildScheduleLine(schedule) {
  if (!schedule) {
    return "Sin horario";
  }

  if (schedule.dayType === "off_day") {
    return "No trabaja";
  }

  if (!schedule.startTime && !schedule.endTime) {
    return schedule.dayTypeLabel || "Horario incompleto";
  }

  const lunchLabel =
    schedule.hasLunch && schedule.lunchDurationMinutes > 0
      ? `almuerzo ${formatLunchDuration(schedule.lunchDurationMinutes)}`
      : "sin almuerzo";

  return `${formatHourForSchedule(schedule.startTime)} - ${lunchLabel} - ${formatHourForSchedule(schedule.endTime)}`;
}

function buildDateLabel(dateKey) {
  const parsed = parseISO(dateKey);
  return format(parsed, "d MMM yyyy", { locale: es });
}

function buildDayLabel(dateKey) {
  const parsed = parseISO(dateKey);
  return format(parsed, "EEEE", { locale: es });
}

function resolveTerminationDateKey(employee = {}) {
  const value = employee.terminationDate || null;
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

function resolveExtraordinaryHours(day, employee) {
  if (attendancePayrollPolicy(employee).appliesExtraordinaryHours === false) {
    return 0;
  }

  if (day.savedAttendanceAdditionalResolved) {
    return Math.max(0, Number(day.savedAttendanceExtraordinaryMinutes) || 0) / 60;
  }

  if (day.schedule?.dayType !== "weekend_overtime") {
    return 0;
  }

  if (!Number.isFinite(day.workedMinutes) || day.workedMinutes <= 0) {
    return 0;
  }

  return Math.floor(day.workedMinutes / 60);
}

function resolveSupplementaryHours(day, employee) {
  if (attendancePayrollPolicy(employee).appliesSupplementaryHours === false) {
    return 0;
  }

  if (day.savedAttendanceAdditionalResolved) {
    return Math.max(0, Number(day.savedAttendanceSupplementaryMinutes) || 0) / 60;
  }

  if (day.savedSupplementaryDecision) {
    if (day.savedSupplementaryDecision !== "supplementary") {
      return 0;
    }

    const savedMinutes = Math.max(0, Number(day.savedSupplementaryMinutes) || 0);

    if (savedMinutes > 0) {
      return savedMinutes / 60;
    }

    return Math.max(0, Number(day.savedSupplementaryHours) || 0);
  }

  const detectedMinutes = Math.max(0, Number(day.extraWorkedMinutes) || 0);
  const plannedMinutes = Math.max(0, Number(day.schedule?.authorizedExtraMinutes) || 0);

  return Math.min(detectedMinutes, plannedMinutes) / 60;
}

function resolveAbsenceHours(day, employee) {
  if (isPlannedAttendanceExempt(employee)) {
    return 0;
  }

  const isWeekday = [1, 2, 3, 4, 5].includes(parseISO(day.dateKey).getDay());
  const hasAnyPunch = Array.isArray(day.punches) && day.punches.length > 0;
  const needsManualDayReview = Boolean(day.needsManualDayReview);
  const incompleteDecision = day.savedIncompleteDayDecision || "";

  if (needsManualDayReview) {
    if (incompleteDecision === "absence") {
      return REGULAR_DAILY_HOURS;
    }

    return 0;
  }

  if (day.schedule?.dayType !== "workday" || !isWeekday || hasAnyPunch) {
    return 0;
  }

  return REGULAR_DAILY_HOURS;
}

function resolveLateDiscountMinutes(day) {
  if (day.savedIncompleteDayDecision === "absence") {
    return 0;
  }

  if (!day.savedLateConfirmation) {
    return 0;
  }

  return Math.max(0, Number(day.savedLateMinutes || day.lateArrivalMinutes) || 0);
}

function resolveRegularShortfallMinutes(day, employee, absenceHours) {
  if (isPlannedAttendanceExempt(employee) || absenceHours > 0) return 0;
  if (day.schedule?.dayType !== "workday") return 0;
  if (day.needsManualDayReview) return 0;

  const scheduledMinutes = Math.max(0, Number(day.scheduledWorkedMinutes) || 0);
  const plannedSupplementaryMinutes = Math.max(0, Number(day.schedule?.authorizedExtraMinutes) || 0);
  const plannedRegularMinutes = Math.min(
    REGULAR_DAILY_HOURS * 60,
    Math.max(0, scheduledMinutes - plannedSupplementaryMinutes),
  );
  const workedRegularMinutes = Math.max(0, Number(day.baseWorkedMinutes) || 0);

  return Math.max(0, plannedRegularMinutes - workedRegularMinutes);
}

function resolveStatus(day, extraordinaryHours, supplementaryHours, absenceHours, lateDiscountMinutes, employee) {
  const hasAnyPunch = Array.isArray(day.punches) && day.punches.length > 0;

  if (isPlannedAttendanceExempt(employee) && day.schedule?.dayType === "workday" && !hasAnyPunch) {
    return plannedAttendanceExemptionLabel(employee);
  }

  if (day.schedule?.dayType === "vacation") {
    return "Vacaciones pagadas";
  }

  if (day.schedule?.dayType === "holiday") {
    return "Feriado pagado";
  }

  if (day.schedule?.dayType === "weekend_overtime") {
    return extraordinaryHours > 0 ? "Extraordinario trabajado" : "Extraordinario sin horas";
  }

  if (day.schedule?.dayType === "off_day") {
    return "No trabaja";
  }

  if (day.needsManualDayReview && day.savedIncompleteDayDecision === "valid_day") {
    return "Día validado manualmente";
  }

  if (day.needsManualDayReview && !day.savedIncompleteDayDecision) {
    return "Pendiente de revisión";
  }

  if (absenceHours > 0) {
    return "Ausencia";
  }

  if (supplementaryHours > 0) {
    return "Asistencia con suplementarias";
  }

  if (lateDiscountMinutes > 0) {
    return "Asistencia con atraso confirmado";
  }

  return "Asistencia";
}

export default function calculatePayrollEstimate({
  employee,
  monthDate,
  punches,
  schedules,
  supplementaryByDate = new Map(),
  attendanceDecisionsByDate = new Map(),
  lateByDate = new Map(),
  incompleteDayByDate = new Map(),
  scheduleRules,
}) {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const compared = comparePayrollPunches({
    start: monthStart,
    end: monthEnd,
    punches,
    schedules,
    scheduleRules,
  });
  const terminationDateKey = resolveTerminationDateKey(employee);

  const visibleDays = compared.comparisons
    .filter((day) => Boolean(day.schedule))
    .filter((day) => !terminationDateKey || day.dateKey <= terminationDateKey)
    .map((day) => {
      const saved = supplementaryByDate.get(day.dateKey);
      const attendanceDecision = attendanceDecisionsByDate.get(day.dateKey);
      const savedLate = lateByDate.get(day.dateKey);

      return {
        ...day,
        savedSupplementaryDecision: saved?.decision || "",
        savedSupplementaryHours: saved?.candidateHours || 0,
        savedSupplementaryMinutes: saved?.candidateMinutes || 0,
        savedAttendanceAdditionalResolved: attendanceDecision?.additionalResolved === true,
        savedAttendanceSupplementaryMinutes: attendanceDecision?.authorizedSupplementaryMinutes || 0,
        savedAttendanceExtraordinaryMinutes: attendanceDecision?.authorizedExtraordinaryMinutes || 0,
        savedLateConfirmation: savedLate?.confirmed || false,
        savedLateMinutes: savedLate?.lateMinutes || 0,
        savedIncompleteDayDecision: incompleteDayByDate.get(day.dateKey)?.decision || "",
      };
    });
  const salary = Number(employee?.salary) || 0;
  const hasSalaryConfigured = salary > 0;
  const hourlyDivisor = MONTHLY_HOURLY_DIVISOR;
  const hourlyRate = hasSalaryConfigured ? calculatePayrollHourlyRate(salary, hourlyDivisor) : 0;
  const dailyRate = hourlyRate * REGULAR_DAILY_HOURS;

  let absenceHoursTotal = 0;
  let supplementaryHoursTotal = 0;
  let extraordinaryHoursTotal = 0;
  let lateDiscountMinutesTotal = 0;
  let regularShortfallMinutesTotal = 0;
  let basePaidHoursTotal = 0;
  let basePayTotal = 0;
  let absenceDiscount = 0;
  let lateDiscountAmount = 0;
  let regularShortfallDiscount = 0;
  let supplementaryPay = 0;
  let extraordinaryPay = 0;

  const rows = visibleDays.map((day) => {
    const extraordinaryHours = resolveExtraordinaryHours(day, employee);
    const supplementaryHours = resolveSupplementaryHours(day, employee);
    const absenceHours = resolveAbsenceHours(day, employee);
    const lateDiscountMinutes = resolveLateDiscountMinutes(day);
    const detectedRegularShortfallMinutes = resolveRegularShortfallMinutes(day, employee, absenceHours);
    const regularShortfallMinutes = Math.max(0, detectedRegularShortfallMinutes - lateDiscountMinutes);
    const normalPaidHours =
      day.schedule?.dayType === "vacation" || day.schedule?.dayType === "holiday"
        ? REGULAR_DAILY_HOURS
        : day.schedule?.dayType === "workday" && day.needsManualDayReview
          ? day.savedIncompleteDayDecision === "valid_day"
            ? REGULAR_DAILY_HOURS
            : 0
          : day.schedule?.dayType === "workday" && absenceHours === 0
            ? REGULAR_DAILY_HOURS
            : 0;

    const basePayAmount = normalPaidHours * hourlyRate;
    const deductionAmount = absenceHours > 0 ? dailyRate : 0;
    const lateAmount = (lateDiscountMinutes / 60) * hourlyRate;
    const regularShortfallAmount = (regularShortfallMinutes / 60) * hourlyRate;
    const supplementaryAmount = supplementaryHours * calculatePayrollAdditionalRate(hourlyRate, SUPPLEMENTARY_PAY_MULTIPLIER);
    const extraordinaryAmount = extraordinaryHours * calculatePayrollAdditionalRate(hourlyRate, EXTRAORDINARY_PAY_MULTIPLIER);
    const adjustmentAmount =
      supplementaryAmount + extraordinaryAmount;

    absenceHoursTotal += absenceHours;
    supplementaryHoursTotal += supplementaryHours;
    extraordinaryHoursTotal += extraordinaryHours;
    lateDiscountMinutesTotal += lateDiscountMinutes;
    regularShortfallMinutesTotal += regularShortfallMinutes;
    basePaidHoursTotal += normalPaidHours;
    basePayTotal += basePayAmount;
    absenceDiscount += deductionAmount;
    lateDiscountAmount += lateAmount;
    regularShortfallDiscount += regularShortfallAmount;
    supplementaryPay += supplementaryAmount;
    extraordinaryPay += extraordinaryAmount;

    return {
      dateKey: day.dateKey,
      dateLabel: buildDateLabel(day.dateKey),
      dayLabel: buildDayLabel(day.dateKey),
      scheduleType: day.schedule?.dayTypeLabel || "Horario",
      scheduleLine: buildScheduleLine(day.schedule),
      status: resolveStatus(day, extraordinaryHours, supplementaryHours, absenceHours, lateDiscountMinutes, employee),
      normalPaidHours,
      basePayAmount,
      basePayAmountLabel: formatMoney(hasSalaryConfigured ? basePayAmount : 0),
      supplementaryHours,
      extraordinaryHours,
      absenceHours,
      lateDiscountMinutes,
      regularShortfallMinutes,
      regularShortfallLabel: `${regularShortfallMinutes}m`,
      regularShortfallAmount,
      regularShortfallAmountLabel: formatMoney(hasSalaryConfigured ? regularShortfallAmount : 0),
      discountLabel: formatDailyDiscount(absenceHours, lateDiscountMinutes, regularShortfallMinutes),
      adjustmentAmount,
      adjustmentAmountLabel: formatMoney(hasSalaryConfigured ? adjustmentAmount : 0),
    };
  });

  const totalDiscount = absenceDiscount + lateDiscountAmount + regularShortfallDiscount;
  const estimatedBaseSalary = hasSalaryConfigured
    ? Math.max(0, salary - totalDiscount)
    : null;
  const estimatedSalary = hasSalaryConfigured
    ? estimatedBaseSalary + supplementaryPay + extraordinaryPay
    : null;

  return {
    month: {
      value: format(monthDate, "yyyy-MM"),
      label: format(monthDate, "MMMM yyyy", { locale: es }),
      start: monthStart,
      end: monthEnd,
    },
    employee: {
      id: employee._id.toString(),
      fullName: employee.fullName,
      salary,
      branch: employee.branch,
      department: employee.department || "",
      areaCode: employee.areaCode || "",
      areaName: employee.areaName || "",
      roleCode: employee.roleCode || "",
      roleName: employee.roleName || "",
    },
    summary: {
      hasSalaryConfigured,
      salary,
      salaryLabel: formatMoney(hasSalaryConfigured ? salary : 0),
      hourlyRate,
      hourlyRateLabel: formatMoney(hasSalaryConfigured ? hourlyRate : 0),
      hourlyDivisor,
      dailyRate,
      dailyRateLabel: formatMoney(hasSalaryConfigured ? dailyRate : 0),
      basePaidHours: basePaidHoursTotal,
      basePaidHoursLabel: formatHours(basePaidHoursTotal),
      basePayTotal,
      basePayTotalLabel: formatMoney(hasSalaryConfigured ? basePayTotal : 0),
      absenceHours: absenceHoursTotal,
      absenceHoursLabel: formatHours(absenceHoursTotal),
      supplementaryHours: supplementaryHoursTotal,
      supplementaryHoursLabel: formatHours(supplementaryHoursTotal),
      extraordinaryHours: extraordinaryHoursTotal,
      extraordinaryHoursLabel: formatHours(extraordinaryHoursTotal),
      lateDiscountMinutes: lateDiscountMinutesTotal,
      lateDiscountMinutesLabel: `${lateDiscountMinutesTotal}m`,
      absenceDiscount,
      absenceDiscountLabel: formatMoney(hasSalaryConfigured ? absenceDiscount : 0),
      lateDiscountAmount,
      lateDiscountAmountLabel: formatMoney(hasSalaryConfigured ? lateDiscountAmount : 0),
      regularShortfallMinutes: regularShortfallMinutesTotal,
      regularShortfallMinutesLabel: `${regularShortfallMinutesTotal}m`,
      regularShortfallDiscount,
      regularShortfallDiscountLabel: formatMoney(hasSalaryConfigured ? regularShortfallDiscount : 0),
      totalDiscount,
      totalDiscountLabel: formatMoney(hasSalaryConfigured ? totalDiscount : 0),
      estimatedBaseSalary,
      estimatedBaseSalaryLabel: formatMoney(hasSalaryConfigured ? estimatedBaseSalary : 0),
      supplementaryPay,
      supplementaryPayLabel: formatMoney(hasSalaryConfigured ? supplementaryPay : 0),
      extraordinaryPay,
      extraordinaryPayLabel: formatMoney(hasSalaryConfigured ? extraordinaryPay : 0),
      estimatedSalary,
      estimatedSalaryLabel: formatMoney(hasSalaryConfigured ? estimatedSalary : 0),
    },
    rows,
  };
}
