import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { parseInventoryWorkbook, serializeImport } from "@/modules/business/lib/inventory";
import {
  DEFAULT_WAREHOUSES,
  normalizeWarehouseText,
} from "@/modules/business/lib/warehouses";
import {
  InventoryDraftProduct,
  InventoryImport,
  InventoryStock,
  Product,
  Warehouse,
} from "@/modules/business/models";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".xlsx", ".xls"];

function hasValidExtension(fileName) {
  const normalized = String(fileName || "").toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

async function ensureWarehouses() {
  await Promise.all(DEFAULT_WAREHOUSES.map((warehouse) => Warehouse.updateOne(
    { code: warehouse.code },
    { $setOnInsert: { ...warehouse, isActive: true, createdFromImport: false } },
    { upsert: true },
  )));

  return Warehouse.find({ isActive: { $ne: false } }).lean();
}

function isNonNegativeNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

export async function POST(request) {
  const access = await getBusinessAccess("business.inventory.import");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  let importDocument = null;

  try {
    await connectToDatabase();
    const formData = await request.formData();
    const file = formData.get("file");
    const sourceGeneratedAt = new Date(String(formData.get("generatedAt") || ""));

    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "Debes adjuntar un archivo de Excel válido." }, { status: 400 });
    }
    if (!hasValidExtension(file.name)) {
      return NextResponse.json({ error: "Solo se permiten archivos .xlsx o .xls." }, { status: 400 });
    }
    if (!file.size || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "El archivo está vacío o supera el máximo de 15 MB." }, { status: 400 });
    }
    if (Number.isNaN(sourceGeneratedAt.getTime())) {
      return NextResponse.json({ error: "La fecha de generación empresarial es obligatoria." }, { status: 400 });
    }

    const uploadedBy = String(access.user.employeeName || access.user.username || "SISTEMA").trim();
    importDocument = await InventoryImport.create({
      fileName: file.name,
      fileSize: file.size,
      status: "processing",
      sourceGeneratedAt,
      uploadedBy,
      uploadedByUser: String(access.user.id || ""),
    });
    const parsed = parseInventoryWorkbook(Buffer.from(await file.arrayBuffer()));
    const importedAt = new Date();
    const productByCode = new Map();
    const draftByCode = new Map();
    const validationErrors = [];
    const unknownWarehouses = new Set();
    const warehouses = await ensureWarehouses();
    const warehouseBySource = new Map();

    warehouses.forEach((warehouse) => {
      [warehouse.name, ...(warehouse.sourceNames || [])].forEach((name) => {
        warehouseBySource.set(normalizeWarehouseText(name), warehouse);
      });
    });

    parsed.rows.forEach((row) => {
      const warehouse = warehouseBySource.get(normalizeWarehouseText(row.warehouseName));
      if (!warehouse) {
        unknownWarehouses.add(normalizeWarehouseText(row.warehouseName));
        return;
      }

      const numericChecks = [
        [row.product.cost, "costo"],
        [row.product.salePrice, "precio"],
        [row.product.taxRate, "impuesto"],
        [row.stock.quantity, "cantidad"],
        [row.stock.fractionalQuantity, "cantidad fraccionaria"],
        [row.stock.totalValue, "valor de existencia"],
      ];
      const invalid = numericChecks.find(([value]) => !isNonNegativeNumber(value));
      if (invalid) {
        validationErrors.push(`Fila ${row.rowNumber}: ${invalid[1]} no puede ser negativo ni inválido.`);
        return;
      }

      productByCode.set(row.saleCode, row.product);
      const draft = draftByCode.get(row.saleCode) || {
        code: row.saleCode,
        barcode: row.product.barcode,
        description: row.product.description,
        price: row.product.salePrice,
        taxRate: row.product.taxRate,
        active: true,
        stocks: new Map(),
      };
      if (draft.stocks.has(warehouse.name)) {
        parsed.warnings.push(`Fila ${row.rowNumber}: la existencia de ${row.saleCode} en ${warehouse.name} reemplazó una fila anterior.`);
      }
      draft.stocks.set(warehouse.name, Number(row.stock.quantity));
      draftByCode.set(row.saleCode, draft);
    });

    if (!draftByCode.size) validationErrors.push("La importación no contiene productos publicables.");

    if (draftByCode.size) {
      await InventoryDraftProduct.insertMany([...draftByCode.values()].map((draft) => ({
        inventoryImport: importDocument._id,
        code: draft.code,
        barcode: draft.barcode,
        description: draft.description,
        price: draft.price,
        taxRate: draft.taxRate,
        active: draft.active,
        stocks: [...draft.stocks.entries()].map(([warehouse, quantity]) => ({ warehouse, quantity })),
      })));
    }

    if (productByCode.size) await Product.bulkWrite([...productByCode.values()].map((product) => ({
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

    if (stockByKey.size) await InventoryStock.bulkWrite([...stockByKey.values()].map((stock) => ({
      updateOne: {
        filter: { product: stock.product, warehouse: stock.warehouse },
        update: { $set: { ...stock, lastImportedAt: importedAt, lastImport: importDocument._id } },
        upsert: true,
      },
    })), { ordered: false });

    importDocument.status = validationErrors.length || unknownWarehouses.size ? "needs_review" : "validated";
    importDocument.totalRows = parsed.totalRows;
    importDocument.processedRows = parsed.rows.length;
    importDocument.skippedRows = parsed.totalRows - parsed.rows.length;
    importDocument.productCount = draftByCode.size;
    importDocument.warehouseCount = new Set(
      [...draftByCode.values()].flatMap((draft) => [...draft.stocks.keys()]),
    ).size;
    importDocument.stockCount = [...draftByCode.values()].reduce((sum, draft) => sum + draft.stocks.size, 0);
    importDocument.warnings = parsed.warnings.slice(0, 100);
    importDocument.validationErrors = validationErrors.slice(0, 100);
    importDocument.unknownWarehouses = [...unknownWarehouses].sort();
    importDocument.importedAt = importedAt;
    importDocument.validatedAt = importedAt;
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
        productCount: draftByCode.size,
        stockCount: importDocument.stockCount,
        unknownWarehouses: [...unknownWarehouses],
      },
    });

    return NextResponse.json({
      message: importDocument.status === "validated"
        ? `Importación validada: ${draftByCode.size} producto(s) listos para publicar.`
        : "Importación guardada para revisión. Corrige los errores o alias de bodegas antes de publicar.",
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
