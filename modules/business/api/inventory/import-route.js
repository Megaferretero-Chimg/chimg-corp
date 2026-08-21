import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { parseInventoryWorkbook, serializeImport } from "@/modules/business/lib/inventory";
import {
  DEFAULT_WAREHOUSES,
  normalizeWarehouseText,
  resolveWarehouseCode,
} from "@/modules/business/lib/warehouses";
import { InventoryImport, InventoryStock, Product, Warehouse } from "@/modules/business/models";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".xlsx", ".xls"];

function hasValidExtension(fileName) {
  const normalized = String(fileName || "").toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

async function ensureWarehouses(sourceNames) {
  await Promise.all(DEFAULT_WAREHOUSES.map((warehouse) => Warehouse.updateOne(
    { code: warehouse.code },
    { $setOnInsert: { ...warehouse, isActive: true, createdFromImport: false } },
    { upsert: true },
  )));

  let warehouses = await Warehouse.find({}).lean();
  const usedCodes = warehouses.map((warehouse) => warehouse.code);

  for (const sourceName of sourceNames) {
    const normalizedSource = normalizeWarehouseText(sourceName);
    const existing = warehouses.find((warehouse) =>
      normalizeWarehouseText(warehouse.name) === normalizedSource
      || (warehouse.sourceNames || []).some((alias) => normalizeWarehouseText(alias) === normalizedSource),
    );

    if (existing) continue;

    const code = resolveWarehouseCode(normalizedSource, usedCodes);
    const created = await Warehouse.create({
      code,
      name: normalizedSource,
      sourceNames: [normalizedSource],
      isActive: true,
      createdFromImport: true,
    });
    usedCodes.push(code);
    warehouses.push(created.toObject());
  }

  return warehouses;
}

export async function POST(request) {
  const access = await getBusinessAccess("business.inventory.import");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  let importDocument = null;

  try {
    await connectToDatabase();
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "Debes adjuntar un archivo de Excel válido." }, { status: 400 });
    }
    if (!hasValidExtension(file.name)) {
      return NextResponse.json({ error: "Solo se permiten archivos .xlsx o .xls." }, { status: 400 });
    }
    if (!file.size || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "El archivo está vacío o supera el máximo de 15 MB." }, { status: 400 });
    }

    const uploadedBy = String(access.user.employeeName || access.user.username || "SISTEMA").trim();
    importDocument = await InventoryImport.create({
      fileName: file.name,
      fileSize: file.size,
      status: "processing",
      uploadedBy,
      uploadedByUser: String(access.user.id || ""),
    });
    const parsed = parseInventoryWorkbook(Buffer.from(await file.arrayBuffer()));
    const importedAt = new Date();
    const productByCode = new Map();
    parsed.rows.forEach((row) => productByCode.set(row.saleCode, row.product));
    const warehouses = await ensureWarehouses([...new Set(parsed.rows.map((row) => row.warehouseName))]);
    const warehouseBySource = new Map();

    warehouses.forEach((warehouse) => {
      [warehouse.name, ...(warehouse.sourceNames || [])].forEach((name) => {
        warehouseBySource.set(normalizeWarehouseText(name), warehouse);
      });
    });

    await Product.bulkWrite([...productByCode.values()].map((product) => ({
      updateOne: {
        filter: { saleCode: product.saleCode },
        update: { $set: { ...product, lastImportedAt: importedAt } },
        upsert: true,
      },
    })), { ordered: false });

    const products = await Product.find({ saleCode: { $in: [...productByCode.keys()] } }, { saleCode: 1 }).lean();
    const productIdByCode = new Map(products.map((product) => [product.saleCode, product._id]));
    const stockByKey = new Map();

    parsed.rows.forEach((row) => {
      const warehouse = warehouseBySource.get(normalizeWarehouseText(row.warehouseName));
      const productId = productIdByCode.get(row.saleCode);
      if (!warehouse || !productId) return;
      stockByKey.set(`${productId}:${warehouse._id}`, {
        product: productId,
        warehouse: warehouse._id,
        ...row.stock,
      });
    });

    await InventoryStock.bulkWrite([...stockByKey.values()].map((stock) => ({
      updateOne: {
        filter: { product: stock.product, warehouse: stock.warehouse },
        update: { $set: { ...stock, lastImportedAt: importedAt, lastImport: importDocument._id } },
        upsert: true,
      },
    })), { ordered: false });

    importDocument.status = parsed.warnings.length ? "processed_with_warnings" : "processed";
    importDocument.totalRows = parsed.totalRows;
    importDocument.processedRows = parsed.rows.length;
    importDocument.skippedRows = parsed.totalRows - parsed.rows.length;
    importDocument.productCount = productByCode.size;
    importDocument.warehouseCount = new Set(parsed.rows.map((row) => row.warehouseName)).size;
    importDocument.stockCount = stockByKey.size;
    importDocument.warnings = parsed.warnings.slice(0, 100);
    importDocument.importedAt = importedAt;
    await importDocument.save();

    const actor = await resolveAuditActor();
    await createAuditLog({
      actor,
      action: "business.inventory.import",
      entityType: "businessInventoryImport",
      entityId: importDocument._id.toString(),
      entityLabel: file.name,
      route: "/api/business/inventory/import",
      details: {
        totalRows: parsed.totalRows,
        processedRows: parsed.rows.length,
        productCount: productByCode.size,
        stockCount: stockByKey.size,
      },
    });

    return NextResponse.json({
      message: `Importación completada: ${productByCode.size} producto(s) y ${stockByKey.size} existencia(s).`,
      inventoryImport: serializeImport(importDocument),
    }, { status: 201 });
  } catch (error) {
    if (importDocument) {
      importDocument.status = "failed";
      importDocument.warnings = [String(error.message || "No se pudo procesar el archivo.")];
      await importDocument.save().catch(() => {});
    }
    console.error("business-inventory-import-error", error);
    return NextResponse.json({ error: error.message || "No se pudo importar el inventario." }, { status: 400 });
  }
}
