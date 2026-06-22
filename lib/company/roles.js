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

  candidates.push("ROL");

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

  throw new Error("No se pudo generar un código único para el rol.");
}

export function normalizeRolePayload(body) {
  const code = String(body?.code || "").trim().toUpperCase();
  const name = String(body?.name || "").trim().toUpperCase();
  const areaCode = String(body?.areaCode || "").trim();
  const description = String(body?.description || "").trim();
  const subroles = normalizeSubroles(body?.subroles);
  const isActive = Boolean(body?.isActive);

  if (!name) {
    throw new Error("El nombre del rol es obligatorio.");
  }

  if (!areaCode) {
    throw new Error("Debes seleccionar un área para el rol.");
  }

  return {
    code,
    name,
    areaCode,
    description,
    subroles,
    isActive,
  };
}

function normalizeSubroles(rawSubroles = []) {
  if (!Array.isArray(rawSubroles)) {
    return [];
  }

  const usedCodes = new Set();

  return rawSubroles
    .map((subrole) => {
      const name = String(subrole?.name || "").trim().toUpperCase();
      const preferredCode = String(subrole?.code || "").trim().toUpperCase();

      if (!name) {
        return null;
      }

      const code = resolveUniqueRoleCode(preferredCode, [...usedCodes], name);
      usedCodes.add(code);

      return {
        code,
        name,
        description: String(subrole?.description || "").trim(),
        isActive: subrole?.isActive === undefined ? true : Boolean(subrole.isActive),
      };
    })
    .filter(Boolean);
}

export function serializeRole(role) {
  return {
    id: role._id.toString(),
    code: role.code || "",
    name: role.name || "",
    areaCode: role.areaCode || "",
    areaName: role.areaName || "",
    description: role.description || "",
    subroles: (role.subroles || []).map((subrole) => ({
      code: subrole.code || "",
      name: subrole.name || "",
      description: subrole.description || "",
      isActive: subrole.isActive !== false,
    })),
    isActive: Boolean(role.isActive),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
