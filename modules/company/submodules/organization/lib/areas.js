function slugifyAreaText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim();
}

export function buildAreaCodeCandidates(name) {
  const normalizedName = slugifyAreaText(name);
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

  candidates.push("AREA");

  return [...new Set(candidates.filter(Boolean))];
}

export function resolveUniqueAreaCode(preferredCode, existingCodes = [], name = "") {
  const normalizedPreferred = String(preferredCode || "").trim().toUpperCase();
  const usedCodes = new Set(existingCodes.map((code) => String(code || "").trim().toUpperCase()));
  const baseCandidates = normalizedPreferred
    ? [normalizedPreferred]
    : buildAreaCodeCandidates(name);

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

  throw new Error("No se pudo generar un código único para el área.");
}

export function normalizeAreaPayload(body) {
  const code = String(body?.code || "").trim().toUpperCase();
  const name = String(body?.name || "").trim().toUpperCase();
  const description = String(body?.description || "").trim();
  const isActive = Boolean(body?.isActive);

  if (!name) {
    throw new Error("El nombre del área es obligatorio.");
  }

  return {
    code,
    name,
    description,
    isActive,
  };
}

export function serializeArea(area) {
  return {
    id: area._id.toString(),
    code: area.code || "",
    name: area.name || "",
    description: area.description || "",
    isActive: Boolean(area.isActive),
    createdAt: area.createdAt,
    updatedAt: area.updatedAt,
  };
}
