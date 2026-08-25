import crypto from "node:crypto";
import mongoose from "mongoose";

import { getEcuadorParts } from "@/lib/datetime/ecuador";
import { CustomerDraft, CustomerImport, CustomerPackageChunk, CustomerPublication, CustomerVersionCounter } from "@/modules/business/models";

const CHUNK_SIZE = 2 * 1024 * 1024;
const pad = (value) => String(value).padStart(2, "0");

function ecuadorIso(value) {
  const parts = getEcuadorParts(value);
  if (!parts) throw new Error("La fecha de la carga no es válida.");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hours)}:${pad(parts.minutes)}:${pad(parts.seconds)}-05:00`;
}

function buildPackage(version, generatedAt, customers) {
  const normalized = customers.map((item) => ({
    identification: item.identification,
    identificationType: item.identificationType,
    customerType: item.customerType,
    firstNames: item.firstNames,
    lastNames: item.lastNames,
    name: item.name,
    address: item.address,
    phone: item.phone,
    email: item.email,
    city: item.city,
    zone: item.zone,
    active: item.active !== false,
  })).sort((left, right) => left.identification.localeCompare(right.identification));
  const bytes = Buffer.from(JSON.stringify({ version, generatedAt, customers: normalized }), "utf8");
  return { bytes, checksum: crypto.createHash("sha256").update(bytes).digest("hex"), customerCount: normalized.length };
}

async function nextVersion(session, now) {
  const parts = getEcuadorParts(now);
  const dateKey = `${parts.year}${pad(parts.month)}${pad(parts.day)}`;
  const counter = await CustomerVersionCounter.findOneAndUpdate({ dateKey }, { $inc: { sequence: 1 } }, { upsert: true, returnDocument: "after", session, setDefaultsOnInsert: true });
  return `C-${dateKey}-${pad(counter.sequence)}`;
}

export async function publishCustomerImport({ importId, user }) {
  const customerImport = await CustomerImport.findById(importId).lean();
  if (!customerImport || customerImport.status !== "validated") throw new Error("La carga no está validada o ya fue publicada.");
  const customers = await CustomerDraft.find({ customerImport: importId }).lean();
  if (!customers.length) throw new Error("La carga no contiene clientes publicables.");
  const now = new Date();
  const generatedAtText = ecuadorIso(customerImport.sourceGeneratedAt || customerImport.createdAt);
  const session = await mongoose.startSession();
  let publication;
  try {
    await session.withTransaction(async () => {
      const version = await nextVersion(session, now);
      const built = buildPackage(version, generatedAtText, customers);
      const chunks = [];
      for (let offset = 0; offset < built.bytes.length; offset += CHUNK_SIZE) chunks.push(built.bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, built.bytes.length)));
      const [created] = await CustomerPublication.create([{
        customerImport: customerImport._id, version, generatedAt: customerImport.sourceGeneratedAt || customerImport.createdAt,
        generatedAtText, publishedAt: now, publishedBy: String(user.employeeName || user.username || "ADMIN"),
        checksum: built.checksum, customerCount: built.customerCount, byteLength: built.bytes.length,
        chunkCount: chunks.length || 1, status: "published",
      }], { session });
      await CustomerPackageChunk.insertMany((chunks.length ? chunks : [Buffer.from("{}")]).map((data, index) => ({ publication: created._id, index, data })), { session });
      await CustomerPublication.updateMany({ _id: { $ne: created._id }, status: "published" }, { $set: { status: "superseded" } }, { session });
      const update = await CustomerImport.updateOne({ _id: customerImport._id, status: "validated" }, { $set: { status: "published", publishedVersion: version } }, { session });
      if (update.modifiedCount !== 1) throw new Error("La carga cambió durante la publicación.");
      publication = created;
    });
  } finally { await session.endSession(); }
  return publication;
}

export async function readCustomerPublicationBytes(publication) {
  const chunks = await CustomerPackageChunk.find({ publication: publication._id }).sort({ index: 1 }).lean();
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk.data) ? chunk.data : Buffer.from(chunk.data.buffer || chunk.data)));
  if (bytes.length !== publication.byteLength || crypto.createHash("sha256").update(bytes).digest("hex") !== publication.checksum) throw new Error("El paquete de clientes no supera la validación de integridad.");
  return bytes;
}

export function serializeCustomerPublication(item) {
  return { id: item._id.toString(), version: item.version, generatedAt: item.generatedAtText, publishedAt: item.publishedAt, checksum: item.checksum, customerCount: item.customerCount, status: item.status };
}
