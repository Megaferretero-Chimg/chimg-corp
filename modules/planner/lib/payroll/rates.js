import { MONTHLY_HOURLY_DIVISOR } from "@/modules/planner/lib/payroll/laborConstants";

export const DEFAULT_MONTHLY_HOURLY_DIVISOR = MONTHLY_HOURLY_DIVISOR;

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function calculatePayrollHourlyRate(salary, divisor = DEFAULT_MONTHLY_HOURLY_DIVISOR) {
  const safeDivisor = Number(divisor) || DEFAULT_MONTHLY_HOURLY_DIVISOR;
  if (safeDivisor <= 0) return 0;

  return roundMoney((Number(salary) || 0) / safeDivisor);
}

export function truncateMoney(value) {
  const normalizedValue = Math.round((Number(value) || 0) * 1000000) / 1000000;
  const normalizedCents = Math.round((normalizedValue * 100) * 1000000) / 1000000;

  return Math.trunc(normalizedCents) / 100;
}

export function calculatePayrollAdditionalRate(hourlyRate, multiplier) {
  return truncateMoney((Number(hourlyRate) || 0) * (Number(multiplier) || 0));
}
