import { formatTimeText24 } from "@/lib/datetime/ecuador";

function slugifyRoleText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim();
}

export function buildRoleCodeCandidates(name) {
  const normalizedName = slugifyRoleText(name);
  const words = normalizedName
    .split(/\s+/)
    .map((word) => word.trim().toUpperCase())
    .filter(Boolean);

  const candidates = [];

  if (words.length >= 2) {
    candidates.push(words.map((word) => word[0]).join("").slice(0, 6));
  }

  if (words.length) {
    candidates.push(words.join("").slice(0, 6));
    candidates.push(words[0].slice(0, 6));
  }

  candidates.push("CAR");

  return [...new Set(candidates.filter(Boolean))];
}

export function resolveUniqueRoleCode(preferredCode, existingCodes = [], name = "") {
  const normalizedPreferred = String(preferredCode || "").trim().toUpperCase();
  const usedCodes = new Set(existingCodes.map((code) => String(code || "").trim().toUpperCase()));
  const baseCandidates = normalizedPreferred
    ? [normalizedPreferred]
    : buildRoleCodeCandidates(name);

  for (const baseCode of baseCandidates) {
    if (!usedCodes.has(baseCode)) {
      return baseCode;
    }

    for (let index = 2; index <= 99; index += 1) {
      const suffix = String(index);
      const truncatedBase = baseCode.slice(0, Math.max(1, 6 - suffix.length));
      const candidate = `${truncatedBase}${suffix}`;

      if (!usedCodes.has(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error("No se pudo generar un código único para el cargo.");
}

export function normalizeRolePayload(body) {
  const code = String(body?.code || "").trim().toUpperCase();
  const name = String(body?.name || "").trim().toUpperCase();
  const areaCode = String(body?.areaCode || "").trim();
  const supervisorRoleCode = String(body?.supervisorRoleCode || "").trim().toUpperCase();
  const description = String(body?.description || "").trim();

  if (!name) {
    throw new Error("El nombre del cargo es obligatorio.");
  }

  if (!areaCode) {
    throw new Error("Debes seleccionar un área para el cargo.");
  }

  return {
    code,
    name,
    areaCode,
    supervisorRoleCode,
    supervisorRoleName: "",
    description,
    functions: [],
    subroles: [],
    isActive: true,
  };
}

export function serializeRole(role) {
  return {
    id: role._id.toString(),
    code: role.code || "",
    name: role.name || "",
    areaCode: role.areaCode || "",
    areaName: role.areaName || "",
    supervisorRoleCode: role.supervisorRoleCode || "",
    supervisorRoleName: role.supervisorRoleName || "",
    scheduleMode: role.scheduleMode || "variable",
    punchesAffectHours: role.punchesAffectHours !== false,
    fixedScheduleTemplateId:
      role.fixedScheduleTemplate?._id?.toString?.() ||
      role.fixedScheduleTemplate?.toString?.() ||
      "",
    fixedScheduleTemplateName: formatTimeText24(role.fixedScheduleTemplateName),
    fixedScheduleTemplateSourceName: formatTimeText24(
      role.fixedScheduleTemplateSourceName || role.fixedScheduleTemplateName,
    ),
    fixedScheduleAreaCode: role.fixedScheduleAreaCode || "",
    fixedScheduleAreaName: role.fixedScheduleAreaName || "",
    fixedScheduleRoleCode: role.fixedScheduleRoleCode || "",
    fixedScheduleRoleName: role.fixedScheduleRoleName || "",
    fixedScheduleRotationGroup: role.fixedScheduleRotationGroup || "",
    fixedScheduleWeeklyRows: (role.fixedScheduleWeeklyRows || []).map((row) => ({
      dayOfWeek: row.dayOfWeek,
      dayType: row.dayType || "workday",
      startTime: row.startTime || "",
      lunchDurationMinutes: row.lunchDurationMinutes ?? 0,
      lunchStartTime: row.lunchStartTime || "",
      lunchEndTime: row.lunchEndTime || "",
      hasLunch: row.hasLunch !== false,
      endTime: row.endTime || "",
      authorizedExtraMinutes: row.authorizedExtraMinutes ?? 0,
      graceMinutes: row.graceMinutes ?? 10,
    })),
    description: role.description || "",
    functions: [],
    subroles: [],
    isActive: Boolean(role.isActive),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
