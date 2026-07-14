export const AUTHORIZATION_CONFIG_KEY = "default";

export const DEFAULT_AUTHORIZATION_CONFIG = {
  key: AUTHORIZATION_CONFIG_KEY,
  requireSupplementaryAuthorization: true,
  requireExtraordinaryAuthorization: true,
  requireHolidayWorkAuthorization: true,
  requireScheduleChangeAuthorization: false,
  requireTimeOffAuthorization: true,
  defaultAuthorizedSupplementaryMinutesPerDay: 60,
  supplementaryAuthorizationThresholdMinutes: 60,
  extraordinaryAuthorizationThresholdMinutes: 1,
  authorizationToleranceMinutes: 10,
  maxAuthorizableMinutesPerDay: 180,
  maxAuthorizableMinutesPerWeek: 600,
  requireSupplementaryJustification: true,
  requireExtraordinaryJustification: true,
  requireHolidayWorkJustification: true,
  allowRetroactiveAuthorization: true,
  retroactiveAuthorizationDays: 5,
  includeOnlyAuthorizedInPayroll: true,
  defaultAuthorizationScope: "day",
  requiresDoubleApproval: false,
  authorizerRoleCodes: ["admin", "supervisor"],
  notes: "",
};

const VALID_AUTHORIZATION_SCOPES = new Set(["day", "date_range", "event"]);

function normalizeNumber(value, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function normalizeRoleCodes(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((code) => String(code || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function normalizeAuthorizationConfigPayload(body) {
  const defaultAuthorizationScope = String(
    body?.defaultAuthorizationScope || DEFAULT_AUTHORIZATION_CONFIG.defaultAuthorizationScope,
  ).trim();

  if (!VALID_AUTHORIZATION_SCOPES.has(defaultAuthorizationScope)) {
    throw new Error("El alcance default de autorizacion no es valido.");
  }

  return {
    key: AUTHORIZATION_CONFIG_KEY,
    requireSupplementaryAuthorization: Boolean(body?.requireSupplementaryAuthorization),
    requireExtraordinaryAuthorization: Boolean(body?.requireExtraordinaryAuthorization),
    requireHolidayWorkAuthorization: Boolean(body?.requireHolidayWorkAuthorization),
    requireScheduleChangeAuthorization: Boolean(body?.requireScheduleChangeAuthorization),
    requireTimeOffAuthorization: Boolean(body?.requireTimeOffAuthorization),
    defaultAuthorizedSupplementaryMinutesPerDay: normalizeNumber(
      body?.defaultAuthorizedSupplementaryMinutesPerDay,
      60,
      { min: 0, max: 720 },
    ),
    supplementaryAuthorizationThresholdMinutes: normalizeNumber(
      body?.supplementaryAuthorizationThresholdMinutes,
      60,
      { min: 0, max: 720 },
    ),
    extraordinaryAuthorizationThresholdMinutes: normalizeNumber(
      body?.extraordinaryAuthorizationThresholdMinutes,
      1,
      { min: 0, max: 720 },
    ),
    authorizationToleranceMinutes: normalizeNumber(body?.authorizationToleranceMinutes, 10, {
      min: 0,
      max: 180,
    }),
    maxAuthorizableMinutesPerDay: normalizeNumber(body?.maxAuthorizableMinutesPerDay, 180, {
      min: 0,
      max: 1440,
    }),
    maxAuthorizableMinutesPerWeek: normalizeNumber(body?.maxAuthorizableMinutesPerWeek, 600, {
      min: 0,
      max: 10080,
    }),
    requireSupplementaryJustification: Boolean(body?.requireSupplementaryJustification),
    requireExtraordinaryJustification: Boolean(body?.requireExtraordinaryJustification),
    requireHolidayWorkJustification: Boolean(body?.requireHolidayWorkJustification),
    allowRetroactiveAuthorization: Boolean(body?.allowRetroactiveAuthorization),
    retroactiveAuthorizationDays: normalizeNumber(body?.retroactiveAuthorizationDays, 5, {
      min: 0,
      max: 365,
    }),
    includeOnlyAuthorizedInPayroll: Boolean(body?.includeOnlyAuthorizedInPayroll),
    defaultAuthorizationScope,
    requiresDoubleApproval: Boolean(body?.requiresDoubleApproval),
    authorizerRoleCodes: normalizeRoleCodes(body?.authorizerRoleCodes),
    notes: String(body?.notes || "").trim(),
  };
}

export function serializeAuthorizationConfig(config) {
  const source = config || DEFAULT_AUTHORIZATION_CONFIG;

  return {
    id: source._id?.toString?.() || "",
    key: source.key || AUTHORIZATION_CONFIG_KEY,
    requireSupplementaryAuthorization:
      source.requireSupplementaryAuthorization ??
      DEFAULT_AUTHORIZATION_CONFIG.requireSupplementaryAuthorization,
    requireExtraordinaryAuthorization:
      source.requireExtraordinaryAuthorization ??
      DEFAULT_AUTHORIZATION_CONFIG.requireExtraordinaryAuthorization,
    requireHolidayWorkAuthorization:
      source.requireHolidayWorkAuthorization ??
      DEFAULT_AUTHORIZATION_CONFIG.requireHolidayWorkAuthorization,
    requireScheduleChangeAuthorization:
      source.requireScheduleChangeAuthorization ??
      DEFAULT_AUTHORIZATION_CONFIG.requireScheduleChangeAuthorization,
    requireTimeOffAuthorization:
      source.requireTimeOffAuthorization ?? DEFAULT_AUTHORIZATION_CONFIG.requireTimeOffAuthorization,
    defaultAuthorizedSupplementaryMinutesPerDay:
      source.defaultAuthorizedSupplementaryMinutesPerDay ??
      DEFAULT_AUTHORIZATION_CONFIG.defaultAuthorizedSupplementaryMinutesPerDay,
    supplementaryAuthorizationThresholdMinutes:
      source.supplementaryAuthorizationThresholdMinutes ??
      DEFAULT_AUTHORIZATION_CONFIG.supplementaryAuthorizationThresholdMinutes,
    extraordinaryAuthorizationThresholdMinutes:
      source.extraordinaryAuthorizationThresholdMinutes ??
      DEFAULT_AUTHORIZATION_CONFIG.extraordinaryAuthorizationThresholdMinutes,
    authorizationToleranceMinutes:
      source.authorizationToleranceMinutes ??
      DEFAULT_AUTHORIZATION_CONFIG.authorizationToleranceMinutes,
    maxAuthorizableMinutesPerDay:
      source.maxAuthorizableMinutesPerDay ??
      DEFAULT_AUTHORIZATION_CONFIG.maxAuthorizableMinutesPerDay,
    maxAuthorizableMinutesPerWeek:
      source.maxAuthorizableMinutesPerWeek ??
      DEFAULT_AUTHORIZATION_CONFIG.maxAuthorizableMinutesPerWeek,
    requireSupplementaryJustification:
      source.requireSupplementaryJustification ??
      DEFAULT_AUTHORIZATION_CONFIG.requireSupplementaryJustification,
    requireExtraordinaryJustification:
      source.requireExtraordinaryJustification ??
      DEFAULT_AUTHORIZATION_CONFIG.requireExtraordinaryJustification,
    requireHolidayWorkJustification:
      source.requireHolidayWorkJustification ??
      DEFAULT_AUTHORIZATION_CONFIG.requireHolidayWorkJustification,
    allowRetroactiveAuthorization:
      source.allowRetroactiveAuthorization ??
      DEFAULT_AUTHORIZATION_CONFIG.allowRetroactiveAuthorization,
    retroactiveAuthorizationDays:
      source.retroactiveAuthorizationDays ??
      DEFAULT_AUTHORIZATION_CONFIG.retroactiveAuthorizationDays,
    includeOnlyAuthorizedInPayroll:
      source.includeOnlyAuthorizedInPayroll ??
      DEFAULT_AUTHORIZATION_CONFIG.includeOnlyAuthorizedInPayroll,
    defaultAuthorizationScope:
      source.defaultAuthorizationScope || DEFAULT_AUTHORIZATION_CONFIG.defaultAuthorizationScope,
    requiresDoubleApproval:
      source.requiresDoubleApproval ?? DEFAULT_AUTHORIZATION_CONFIG.requiresDoubleApproval,
    authorizerRoleCodes: source.authorizerRoleCodes || DEFAULT_AUTHORIZATION_CONFIG.authorizerRoleCodes,
    notes: source.notes || "",
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
}
