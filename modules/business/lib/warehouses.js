export const DEFAULT_WAREHOUSES = [
  { code: "SAL-ALM", name: "SALCEDO ALMACEN", location: "Salcedo", sourceNames: ["SALCEDO ALMACEN"] },
  { code: "AMB-ALM", name: "AMBATO ALMACEN", location: "Ambato", sourceNames: ["AMBATO ALMACEN", "ALMACEN"] },
  { code: "INT", name: "INTERNA", location: "", sourceNames: ["INTERNA"] },
  { code: "EXT", name: "EXTERNA", location: "", sourceNames: ["EXTERNA"] },
];

export function normalizeWarehouseText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function codeBase(value) {
  const words = normalizeWarehouseText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "BOD";
  if (words.length > 1) return words.map((word) => word[0]).join("").slice(0, 8);
  return words[0].slice(0, 8);
}

export function resolveWarehouseCode(name, existingCodes = []) {
  const used = new Set(existingCodes.map(normalizeWarehouseText));
  const base = codeBase(name);

  if (!used.has(base)) return base;

  for (let index = 2; index <= 999; index += 1) {
    const suffix = String(index);
    const candidate = `${base.slice(0, Math.max(1, 8 - suffix.length))}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }

  throw new Error("No se pudo generar un código único para la bodega.");
}

export function normalizeWarehousePayload(body) {
  const name = normalizeWarehouseText(body?.name);
  const location = String(body?.location || "").trim();
  const sourceNames = [...new Set(
    [name, ...(Array.isArray(body?.sourceNames) ? body.sourceNames : String(body?.sourceNames || "").split(","))]
      .map(normalizeWarehouseText)
      .filter(Boolean),
  )];

  if (!name) throw new Error("El nombre de la bodega es obligatorio.");

  return { name, location, sourceNames, isActive: body?.isActive !== false };
}

export function serializeWarehouse(warehouse, stockSummary = {}) {
  return {
    id: warehouse._id.toString(),
    code: warehouse.code || "",
    name: warehouse.name || "",
    location: warehouse.location || "",
    sourceNames: warehouse.sourceNames || [],
    isActive: warehouse.isActive !== false,
    createdFromImport: Boolean(warehouse.createdFromImport),
    productCount: stockSummary.productCount || 0,
    totalQuantity: stockSummary.totalQuantity || 0,
    createdAt: warehouse.createdAt,
    updatedAt: warehouse.updatedAt,
  };
}
