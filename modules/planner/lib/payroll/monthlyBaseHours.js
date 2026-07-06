import { eachDayOfInterval, endOfMonth, startOfMonth } from "date-fns";

import { formatEcuadorDateKey } from "@/lib/datetime/ecuador";
import { ECUADOR_DAILY_BASE_HOURS, MONTHLY_HOURLY_DIVISOR } from "@/modules/planner/lib/payroll/laborConstants";
import { Holiday } from "@/modules/planner/models";

function isWeekday(date) {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function getMonthBoundaryKeys(monthKey) {
  return {
    from: `${monthKey}-01`,
    to: `${monthKey}-31`,
  };
}

export async function resolveMonthlyBaseHours({
  monthKey,
  year,
  monthIndex,
  dailyBaseHours = ECUADOR_DAILY_BASE_HOURS,
}) {
  const safeDailyBaseHours = Math.max(Number(dailyBaseHours) || ECUADOR_DAILY_BASE_HOURS, 1);
  const { from, to } = getMonthBoundaryKeys(monthKey);
  const holidays = await Holiday.find({
    dateKey: {
      $gte: from,
      $lte: to,
    },
  })
    .select({ dateKey: 1 })
    .lean();
  const holidayKeys = new Set(holidays.map((holiday) => holiday.dateKey));
  const days = eachDayOfInterval({
    start: startOfMonth(new Date(year, monthIndex, 1)),
    end: endOfMonth(new Date(year, monthIndex, 1)),
  });
  const laborableDays = days.filter((date) => (
    isWeekday(date) && !holidayKeys.has(formatEcuadorDateKey(date))
  )).length;
  const hourlyDivisor = MONTHLY_HOURLY_DIVISOR;

  return {
    laborableDays,
    dailyBaseHours: safeDailyBaseHours,
    hourlyDivisor,
    holidayDateKeys: [...holidayKeys].sort(),
  };
}
