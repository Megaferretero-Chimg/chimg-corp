import crypto from "node:crypto";
import mongoose from "mongoose";

import { getEcuadorParts } from "@/lib/datetime/ecuador";
import {
  InventoryDraftProduct,
  InventoryImport,
  InventoryPackageChunk,
  InventoryPublication,
  InventoryVersionCounter,
} from "@/modules/business/models";
import { PUBLISHABLE_WAREHOUSE_NAMES } from "@/modules/business/lib/warehouses";

const PACKAGE_CHUNK_SIZE = 2 * 1024 * 1024;

function pad(value) {
  return String(value).padStart(2, "0");
}

export function formatEcuadorIso(value) {
  const parts = getEcuadorParts(value);
  if (!parts) throw new Error("La fecha de generación empresarial no es válida.");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hours)}:${pad(parts.minutes)}:${pad(parts.seconds)}-05:00`;
}

function normalizeJsonNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} debe ser un número no negativo.`);
  return number;
}

export function buildInventoryPackage({ version, generatedAtText, products }) {
  if (!version) throw new Error("La versión es obligatoria.");
  if (!generatedAtText) throw new Error("La fecha de generación es obligatoria.");

  const codes = new Set();
  const normalizedProducts = [...products]
    .map((product) => {
      const code = String(product.code || "").trim();
      const description = String(product.description || "").trim();
      if (!code) throw new Error("Todos los productos deben tener código.");
      if (!description) throw new Error(`El producto ${code} no tiene descripción.`);
      if (codes.has(code)) throw new Error(`El código ${code} está repetido.`);
      codes.add(code);

      const warehouses = new Set();
      const stocks = [...(product.stocks || [])]
        .map((stock) => {
          const warehouse = String(stock.warehouse || "").trim().toUpperCase();
          if (!PUBLISHABLE_WAREHOUSE_NAMES.has(warehouse)) {
            throw new Error(`La bodega ${warehouse || "sin nombre"} no está autorizada para publicación.`);
          }
          if (warehouses.has(warehouse)) throw new Error(`La bodega ${warehouse} se repite en ${code}.`);
          warehouses.add(warehouse);
          return { warehouse, quantity: normalizeJsonNumber(stock.quantity, `Cantidad de ${code}`) };
        })
        .sort((left, right) => left.warehouse.localeCompare(right.warehouse));

      return {
        code,
        barcode: String(product.barcode || "").trim(),
        description,
        price: normalizeJsonNumber(product.price, `Precio de ${code}`),
        taxRate: normalizeJsonNumber(product.taxRate, `Impuesto de ${code}`),
        active: product.active !== false,
        stocks,
      };
    })
    .sort((left, right) => left.code.localeCompare(right.code));

  const payload = { version, generatedAt: generatedAtText, products: normalizedProducts };
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  return {
    payload,
    bytes,
    checksum: crypto.createHash("sha256").update(bytes).digest("hex"),
    productCount: normalizedProducts.length,
    stockCount: normalizedProducts.reduce((sum, product) => sum + product.stocks.length, 0),
  };
}

function splitBuffer(buffer) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += PACKAGE_CHUNK_SIZE) {
    chunks.push(buffer.subarray(offset, Math.min(buffer.length, offset + PACKAGE_CHUNK_SIZE)));
  }
  return chunks.length ? chunks : [Buffer.from("{}")];
}

async function nextVersion(session, now) {
  const parts = getEcuadorParts(now);
  const dateKey = `${parts.year}${pad(parts.month)}${pad(parts.day)}`;
  const counter = await InventoryVersionCounter.findOneAndUpdate(
    { dateKey },
    { $inc: { sequence: 1 } },
    { upsert: true, returnDocument: "after", session, setDefaultsOnInsert: true },
  );
  return `${dateKey}-${pad(counter.sequence)}`;
}

export async function publishInventoryImport({ importId, user }) {
  const inventoryImport = await InventoryImport.findById(importId).lean();
  if (!inventoryImport) throw new Error("Importación no encontrada.");
  if (inventoryImport.status !== "validated") {
    throw new Error("Solo se pueden publicar importaciones validadas y sin bodegas desconocidas.");
  }
  if (!inventoryImport.sourceGeneratedAt) throw new Error("La importación no tiene fecha de generación empresarial.");

  const draftProducts = await InventoryDraftProduct.find({ inventoryImport: importId })
    .sort({ code: 1 })
    .lean();
  if (!draftProducts.length) throw new Error("La importación no contiene productos publicables.");

  const now = new Date();
  const generatedAtText = formatEcuadorIso(inventoryImport.sourceGeneratedAt);
  const session = await mongoose.startSession();
  let publication;

  try {
    await session.withTransaction(async () => {
      const version = await nextVersion(session, now);
      const built = buildInventoryPackage({ version, generatedAtText, products: draftProducts });
      const chunks = splitBuffer(built.bytes);
      const [createdPublication] = await InventoryPublication.create([{
        inventoryImport: inventoryImport._id,
        version,
        generatedAt: inventoryImport.sourceGeneratedAt,
        generatedAtText,
        publishedAt: now,
        publishedBy: String(user.employeeName || user.username || "ADMIN"),
        publishedByUser: String(user.id || ""),
        checksum: built.checksum,
        productCount: built.productCount,
        stockCount: built.stockCount,
        byteLength: built.bytes.length,
        chunkCount: chunks.length,
        status: "published",
        packageRef: `mongo:businessinventorypackagechunks/${version}`,
      }], { session });

      await InventoryPackageChunk.insertMany(chunks.map((data, index) => ({
        publication: createdPublication._id,
        index,
        data,
      })), { session });

      await InventoryPublication.updateMany(
        { _id: { $ne: createdPublication._id }, status: "published" },
        { $set: { status: "superseded" } },
        { session },
      );
      const updateResult = await InventoryImport.updateOne(
        { _id: inventoryImport._id, status: "validated", publishedVersion: "" },
        { $set: { status: "published", publishedVersion: version } },
        { session },
      );
      if (updateResult.modifiedCount !== 1) throw new Error("La importación ya fue publicada o cambió durante el proceso.");
      publication = createdPublication;
    });
  } finally {
    await session.endSession();
  }

  return publication;
}

export async function readPublicationBytes(publication) {
  const chunks = await InventoryPackageChunk.find({ publication: publication._id }).sort({ index: 1 }).lean();
  if (chunks.length !== publication.chunkCount) throw new Error("El paquete publicado está incompleto.");
  const bytes = Buffer.concat(chunks.map((chunk) => {
    if (Buffer.isBuffer(chunk.data)) return chunk.data;
    if (chunk.data?.buffer) return Buffer.from(chunk.data.buffer);
    return Buffer.from(chunk.data);
  }));
  if (bytes.length !== publication.byteLength) throw new Error("El tamaño del paquete publicado no coincide.");
  const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
  if (checksum !== publication.checksum) throw new Error("El paquete publicado no supera la validación SHA-256.");
  return bytes;
}

export function serializePublication(item) {
  return {
    id: item._id.toString(),
    importId: item.inventoryImport.toString(),
    version: item.version,
    generatedAt: item.generatedAtText,
    publishedAt: item.publishedAt,
    publishedBy: item.publishedBy,
    checksum: item.checksum,
    productCount: item.productCount,
    stockCount: item.stockCount,
    byteLength: item.byteLength,
    status: item.status,
  };
}
