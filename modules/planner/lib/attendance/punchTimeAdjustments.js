const SALCEDO_TIME_ADJUSTMENT_KEY = "SALCEDO_MINUS_24_MINUTES_V1";
const SALCEDO_TIME_ADJUSTMENT_MINUTES = -24;
const MINUTE_IN_MILLISECONDS = 60 * 1000;

function normalizedText(value) {
  return String(value || "").trim().toUpperCase();
}

function plainValue(value) {
  return typeof value?.toObject === "function" ? value.toObject() : value;
}

function isSalcedoUpload(snapshot, upload = {}) {
  const firstEmployee = snapshot?.employees?.[0] || {};
  const branchCode = normalizedText(upload.branchCode || firstEmployee.branchCode);
  const branchName = normalizedText(upload.branchName || firstEmployee.branchName);

  return branchCode === "SAL" || branchName === "SALCEDO";
}

function salcedoRawPunchDate(rawValue) {
  const match = String(rawValue || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second = "0"] = match;
  const punchedAt = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) + 5,
      Number(minute),
      Number(second),
    ),
  );

  return Number.isFinite(punchedAt.getTime()) ? punchedAt : null;
}

function adjustPunch(punch, adjustmentWasPersisted) {
  const plainPunch = plainValue(punch) || {};
  const rawPunchedAt = salcedoRawPunchDate(plainPunch.rawValue);
  const storedPunchedAt = new Date(plainPunch.punchedAt);
  const basePunchedAt = rawPunchedAt || storedPunchedAt;

  if (!Number.isFinite(basePunchedAt.getTime())) {
    return plainPunch;
  }

  if (!rawPunchedAt && adjustmentWasPersisted) {
    return plainPunch;
  }

  return {
    ...plainPunch,
    punchedAt: new Date(
      basePunchedAt.getTime() + SALCEDO_TIME_ADJUSTMENT_MINUTES * MINUTE_IN_MILLISECONDS,
    ),
  };
}

export function applyAttendancePunchTimeAdjustments(snapshot, upload = {}) {
  if (!snapshot || !isSalcedoUpload(snapshot, upload)) {
    return snapshot;
  }

  const plainSnapshot = plainValue(snapshot) || {};
  const adjustmentWasPersisted =
    plainSnapshot.timeAdjustmentKey === SALCEDO_TIME_ADJUSTMENT_KEY;
  const employees = (plainSnapshot.employees || []).map((employee) => {
    const plainEmployee = plainValue(employee) || {};

    return {
      ...plainEmployee,
      punches: (plainEmployee.punches || []).map((punch) =>
        adjustPunch(punch, adjustmentWasPersisted),
      ),
    };
  });
  const adjustmentLog =
    "Corrección Salcedo aplicada: se restaron 24 minutos a cada picada.";
  const parserLogs = [...(plainSnapshot.parserLogs || [])];

  if (!parserLogs.includes(adjustmentLog)) {
    parserLogs.push(adjustmentLog);
  }

  return {
    ...plainSnapshot,
    employees,
    parserLogs,
    timeAdjustmentKey: SALCEDO_TIME_ADJUSTMENT_KEY,
    timeAdjustmentMinutes: SALCEDO_TIME_ADJUSTMENT_MINUTES,
  };
}

export {
  SALCEDO_TIME_ADJUSTMENT_KEY,
  SALCEDO_TIME_ADJUSTMENT_MINUTES,
};
