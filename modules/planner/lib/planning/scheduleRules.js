import {
  DEFAULT_ATTENDANCE_GRACE_MINUTES,
  DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES,
} from "@/modules/planner/lib/payroll/laborConstants";

export const SCHEDULE_RULE_CONFIG_KEY = "default";

export const DEFAULT_SCHEDULE_RULE_CONFIG = {
  key: SCHEDULE_RULE_CONFIG_KEY,
  lateToleranceMinutes: DEFAULT_ATTENDANCE_GRACE_MINUTES,
  earlyLeaveToleranceMinutes: 5,
  lateDepartureToleranceMinutes: DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES,
};

function normalizeNumber(value, fallback, { min = 0, max = 180 } = {}) {
  const numericValue = Number(value);
  const resolvedValue = Number.isFinite(numericValue) ? numericValue : fallback;

  return Math.min(max, Math.max(min, Math.round(resolvedValue)));
}

export function normalizeScheduleRuleConfigPayload(body) {
  return {
    key: SCHEDULE_RULE_CONFIG_KEY,
    lateToleranceMinutes: normalizeNumber(
      body?.lateToleranceMinutes,
      DEFAULT_SCHEDULE_RULE_CONFIG.lateToleranceMinutes,
    ),
    earlyLeaveToleranceMinutes: normalizeNumber(
      body?.earlyLeaveToleranceMinutes,
      DEFAULT_SCHEDULE_RULE_CONFIG.earlyLeaveToleranceMinutes,
    ),
    lateDepartureToleranceMinutes: normalizeNumber(
      body?.lateDepartureToleranceMinutes,
      DEFAULT_SCHEDULE_RULE_CONFIG.lateDepartureToleranceMinutes,
    ),
  };
}

export function serializeScheduleRuleConfig(config) {
  const source = config || DEFAULT_SCHEDULE_RULE_CONFIG;

  return {
    id: source._id?.toString?.() || "",
    key: source.key || SCHEDULE_RULE_CONFIG_KEY,
    lateToleranceMinutes: normalizeNumber(
      source.lateToleranceMinutes,
      DEFAULT_SCHEDULE_RULE_CONFIG.lateToleranceMinutes,
    ),
    earlyLeaveToleranceMinutes: normalizeNumber(
      source.earlyLeaveToleranceMinutes,
      DEFAULT_SCHEDULE_RULE_CONFIG.earlyLeaveToleranceMinutes,
    ),
    lateDepartureToleranceMinutes: normalizeNumber(
      source.lateDepartureToleranceMinutes,
      DEFAULT_SCHEDULE_RULE_CONFIG.lateDepartureToleranceMinutes,
    ),
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
}
