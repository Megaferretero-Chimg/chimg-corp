function slugifyBranchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim();
}

export function buildBranchCodeCandidates(name) {
  const normalizedName = slugifyBranchText(name);
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

  candidates.push("SUC");

  return [...new Set(candidates.filter(Boolean))];
}

export function resolveUniqueBranchCode(preferredCode, existingCodes = [], name = "") {
  const normalizedPreferred = String(preferredCode || "").trim().toUpperCase();
  const usedCodes = new Set(existingCodes.map((code) => String(code || "").trim().toUpperCase()));
  const baseCandidates = normalizedPreferred
    ? [normalizedPreferred]
    : buildBranchCodeCandidates(name);

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

  throw new Error("No se pudo generar un código único para la sucursal.");
}

export function normalizeBranchPayload(body) {
  const code = String(body?.code || "").trim().toUpperCase();
  const name = String(body?.name || "").trim().toUpperCase();
  const city = String(body?.city || "").trim();
  const address = String(body?.address || "").trim();
  const isActive = Boolean(body?.isActive);

  if (!name) {
    throw new Error("El nombre de la sucursal es obligatorio.");
  }

  return {
    code,
    name,
    city,
    address,
    isActive,
  };
}

export function serializeBranch(branch) {
  return {
    id: branch._id.toString(),
    code: branch.code || "",
    name: branch.name || "",
    city: branch.city || "",
    address: branch.address || "",
    isActive: Boolean(branch.isActive),
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}
