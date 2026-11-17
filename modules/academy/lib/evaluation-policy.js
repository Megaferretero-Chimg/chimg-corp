export const DAILY_ATTEMPT_LIMIT = 3;
export const PASSING_RATIO = .7;

const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" });

export function evaluationDay(now = Date.now()) {
  return dayFormatter.format(new Date(now));
}

export function passingGrade(maxGrade = 10) {
  return Math.ceil(maxGrade * PASSING_RATIO * 100) / 100;
}

export function hasPassedEvaluation(attempt) {
  return Boolean(attempt?.result && attempt.result.grade >= (attempt.passingGrade ?? passingGrade(attempt.maxGrade)));
}

export function evaluationAvailability(attempt, now = Date.now()) {
  const day = evaluationDay(now);
  // Older attempts have no date. Count the existing result as the first attempt.
  const attemptDay = attempt?.day ?? (attempt?.startedAt ? evaluationDay(attempt.startedAt) : day);
  const used = attempt && attemptDay === day ? (attempt.dailyCount ?? 1) : 0;
  return {
    day,
    used,
    remaining: Math.max(0, DAILY_ATTEMPT_LIMIT - used),
    passed: hasPassedEvaluation(attempt),
    nextAvailableAt: new Date(new Date(day + "T00:00:00-05:00").getTime() + 86400000),
  };
}
