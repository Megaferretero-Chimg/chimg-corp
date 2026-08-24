import crypto from "node:crypto";
import mongoose from "mongoose";
import * as XLSX from "xlsx";

import InventoryPublication from "../modules/business/models/InventoryPublication.js";

const baseUrl = process.env.BUSINESS_SYNC_BASE_URL || "http://127.0.0.1:3000";
const requiredEnv = ["AUTH_USERNAME", "AUTH_PASSWORD", "SESSION_SECRET", "MONGODB_URI"];
for (const name of requiredEnv) if (!process.env[name]) throw new Error(`${name} es obligatorio para la prueba.`);

const adminToken = crypto.createHash("sha256")
  .update(`${process.env.AUTH_USERNAME}:${process.env.AUTH_PASSWORD}`)
  .digest("hex");
const adminHeaders = { Cookie: `control_asistencia_session=${adminToken}` };
const results = [];

function check(name, condition, details = {}) {
  if (!condition) throw new Error(`PRUEBA FALLIDA: ${name} ${JSON.stringify(details)}`);
  results.push({ name, status: "passed", ...details });
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { response, body, text };
}

async function createActivation(deviceName, warehouseId, expiresInMinutes = 60) {
  return jsonRequest("/api/business/devices/activation-codes", {
    method: "POST",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceName, warehouseId, expiresInMinutes }),
  });
}

async function activate(activationCode, deviceId, deviceName) {
  return jsonRequest("/api/v1/devices/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activationCode, deviceId, deviceName }),
  });
}

const workbook = XLSX.utils.book_new();
const worksheet = XLSX.utils.json_to_sheet([
  {
    CodigoVentaProducto: "TEST-FER-001", CodigoCatalogoProducto: "TEST-FER-001",
    CodigoBarraProducto: "786100000001", DescripcionProducto: "DESTORNILLADOR DE PRUEBA",
    NombreBodega: "ALMACEN", ExistenciaProductoBodega: 25, PrecioVentaProducto: 10,
    PrecioConIva: 11.5, NombreCuentaVenta: "Ventas Gravadas 15%", CostoProducto: 7,
    TotalValorExistencia: 175,
  },
  {
    CodigoVentaProducto: "TEST-FER-001", CodigoCatalogoProducto: "TEST-FER-001",
    CodigoBarraProducto: "786100000001", DescripcionProducto: "DESTORNILLADOR DE PRUEBA",
    NombreBodega: "INTERNA", ExistenciaProductoBodega: 4, PrecioVentaProducto: 10,
    PrecioConIva: 11.5, NombreCuentaVenta: "Ventas Gravadas 15%", CostoProducto: 7,
    TotalValorExistencia: 28,
  },
  {
    CodigoVentaProducto: "TEST-FER-002", CodigoCatalogoProducto: "TEST-FER-002",
    CodigoBarraProducto: "786100000002", DescripcionProducto: "MARTILLO DE PRUEBA",
    NombreBodega: "SALCEDO ALMACEN", ExistenciaProductoBodega: 12, PrecioVentaProducto: 20,
    PrecioConIva: 23, NombreCuentaVenta: "Ventas Gravadas 15%", CostoProducto: 14,
    TotalValorExistencia: 168,
  },
  {
    CodigoVentaProducto: "TEST-FER-002", CodigoCatalogoProducto: "TEST-FER-002",
    CodigoBarraProducto: "786100000002", DescripcionProducto: "MARTILLO DE PRUEBA",
    NombreBodega: "EXTERNA", ExistenciaProductoBodega: 3, PrecioVentaProducto: 20,
    PrecioConIva: 23, NombreCuentaVenta: "Ventas Gravadas 15%", CostoProducto: 14,
    TotalValorExistencia: 42,
  },
]);
XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");
const workbookBytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
const form = new FormData();
form.append("file", new File([workbookBytes], "inventario-integracion.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
form.append("generatedAt", "2026-08-24T15:10:00.000Z");

const imported = await jsonRequest("/api/business/inventory/import", { method: "POST", headers: adminHeaders, body: form });
check("importar borrador validado", imported.response.status === 201 && imported.body.inventoryImport?.status === "validated", { status: imported.response.status });
const importId = imported.body.inventoryImport.id;

const published = await jsonRequest(`/api/business/inventory/imports/${importId}/publish`, { method: "POST", headers: adminHeaders });
check("publicar versión de inventario", published.response.status === 201 && published.body.publication?.version, { status: published.response.status });
const publication = published.body.publication;

const deviceCatalog = await jsonRequest("/api/business/devices", { headers: adminHeaders });
check("listar bodegas para activación", deviceCatalog.response.status === 200 && deviceCatalog.body.warehouses?.length === 4);
const ambato = deviceCatalog.body.warehouses.find((item) => item.name === "ALMACÉN AMBATO");

const firstCode = await createActivation("CAJA PRUEBA REVOCACIÓN", ambato.id, 60);
check("crear código de activación", firstCode.response.status === 201 && firstCode.body.activationCode);
const firstDeviceId = crypto.randomUUID();
const firstActivation = await activate(firstCode.body.activationCode, firstDeviceId, "CAJA-LOCAL-PRUEBA");
check("activar dispositivo", firstActivation.response.status === 200 && firstActivation.body.deviceId === firstDeviceId);
const firstToken = firstActivation.body.accessToken;

const reused = await activate(firstCode.body.activationCode, crypto.randomUUID(), "CAJA-REUSO");
check("rechazar código reutilizado", reused.response.status === 401, { status: reused.response.status });

await mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false });
const expiredCode = "EXP" + crypto.randomBytes(3).toString("hex").toUpperCase();
const expiredHash = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(expiredCode).digest("hex");
await mongoose.connection.db.collection("businessdeviceactivationcodes").insertOne({
  codeHash: expiredHash,
  codeSuffix: expiredCode.slice(-3),
  deviceName: "CAJA CÓDIGO VENCIDO",
  warehouse: new mongoose.Types.ObjectId(ambato.id),
  warehouseName: ambato.name,
  expiresAt: new Date(Date.now() - 60_000),
  usedAt: null,
  revokedAt: null,
  createdBy: "INTEGRATION_TEST",
  createdByUser: "test",
  createdAt: new Date(),
  updatedAt: new Date(),
});
const expired = await activate(expiredCode, crypto.randomUUID(), "CAJA-VENCIDA");
check("rechazar código vencido", expired.response.status === 401, { status: expired.response.status });

const manifest = await jsonRequest("/api/v1/sync/manifest", { headers: { Authorization: `Bearer ${firstToken}` } });
check("obtener manifiesto autenticado", manifest.response.status === 200 && manifest.body.inventory?.version === publication.version);
const download = await fetch(`${baseUrl}${manifest.body.inventory.downloadUrl}`, { headers: { Authorization: `Bearer ${firstToken}` } });
const packageBytes = Buffer.from(await download.arrayBuffer());
const packageBody = JSON.parse(packageBytes.toString("utf8"));
const calculatedChecksum = crypto.createHash("sha256").update(packageBytes).digest("hex");
check("descargar paquete publicado", download.status === 200 && packageBody.products.length === 2);
check("verificar SHA-256 exacto", calculatedChecksum === manifest.body.inventory.checksum, { checksum: calculatedChecksum });
check("version y generatedAt coinciden", packageBody.version === manifest.body.inventory.version && packageBody.generatedAt === manifest.body.inventory.generatedAt);

const missingPackage = await jsonRequest("/api/v1/sync/packages/inventory/20990101-99", { headers: { Authorization: `Bearer ${firstToken}` } });
check("impedir descargar versión no publicada", missingPackage.response.status === 404, { status: missingPackage.response.status });

let immutableRejected = false;
try {
  await InventoryPublication.updateOne({ version: publication.version }, { $set: { checksum: "0".repeat(64) } });
} catch {
  immutableRejected = true;
}
const checksumAfterAttempt = (await InventoryPublication.findOne({ version: publication.version }).lean()).checksum;
check("impedir mutar versión publicada", immutableRejected && checksumAfterAttempt === publication.checksum);

const devicesAfterActivation = await jsonRequest("/api/business/devices", { headers: adminHeaders });
const firstDevice = devicesAfterActivation.body.devices.find((item) => item.deviceId === firstDeviceId);
const revoked = await jsonRequest(`/api/business/devices/${firstDevice.id}/revoke`, { method: "PATCH", headers: adminHeaders });
check("revocar dispositivo", revoked.response.status === 200);
const revokedManifest = await jsonRequest("/api/v1/sync/manifest", { headers: { Authorization: `Bearer ${firstToken}` } });
check("rechazar dispositivo revocado", revokedManifest.response.status === 403, { status: revokedManifest.response.status });

const activeCode = await createActivation("CAJA AMBATO INTEGRACIÓN", ambato.id, 1440);
const activeDeviceId = crypto.randomUUID();
const activeActivation = await activate(activeCode.body.activationCode, activeDeviceId, "CAJA-ACTIVA-PRUEBA");
check("crear dispositivo activo de prueba", activeActivation.response.status === 200);
const activeToken = activeActivation.body.accessToken;

const guideUuid = crypto.randomUUID();
const customerUuid = crypto.randomUUID();
const batchBody = {
  deviceId: activeDeviceId,
  guides: [{
    syncUuid: guideUuid, uuid: guideUuid, device_id: activeDeviceId, sync_status: "PENDING",
    internal_number: `CONT-TEST-${Date.now()}`, cashier_id: 1, cashier_name: "CAJERO PRUEBA",
    seller_id: 1, seller_name: "VENDEDOR PRUEBA", warehouse: "ALMACÉN AMBATO",
    customer_source: "MASTER", customer_id: 1, customer_identification: "1800000001",
    customer_name: "CLIENTE DE PRUEBA", payment_method: "EFECTIVO", subtotal: 10, tax: 1.5,
    total: 11.5, notes: "", created_at: "2026-08-24T10:30:00-05:00",
    items: [{ id: 1, product_id: 20, product_code: "TEST-FER-001", description: "DESTORNILLADOR DE PRUEBA", warehouse: "ALMACÉN AMBATO", dispatched: true, quantity: 1, unit_price: 10, discount: 0, tax_rate: 15, subtotal: 10, tax: 1.5, total: 11.5 }],
  }],
  pendingCustomers: [{
    syncUuid: customerUuid, id: 25, identification: "1800000002", identification_type: "CÉDULA",
    customer_type: "PERSONA", first_names: "JUAN", last_names: "PÉREZ", name: "JUAN PÉREZ",
    address: "AMBATO", phone: "0999999999", email: "", city: "AMBATO", zone: "AA (NO APLICA)",
    source: "PENDING", status: "PENDING", created_at: "2026-08-24T10:20:00-05:00",
  }],
};
const batch = await jsonRequest("/api/v1/sync/batch", { method: "POST", headers: { Authorization: `Bearer ${activeToken}`, "Content-Type": "application/json" }, body: JSON.stringify(batchBody) });
check("recibir guía y cliente pendiente", batch.response.status === 200 && batch.body.accepted.includes(guideUuid) && batch.body.accepted.includes(customerUuid));
const duplicateBatch = await jsonRequest("/api/v1/sync/batch", { method: "POST", headers: { Authorization: `Bearer ${activeToken}`, "Content-Type": "application/json" }, body: JSON.stringify(batchBody) });
check("reenviar guía sin duplicarla", duplicateBatch.body.duplicates.includes(guideUuid) && duplicateBatch.body.duplicates.includes(customerUuid));

const invalidUuid = crypto.randomUUID();
const partial = await jsonRequest("/api/v1/sync/batch", {
  method: "POST",
  headers: { Authorization: `Bearer ${activeToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ deviceId: activeDeviceId, guides: [{ syncUuid: invalidUuid, device_id: activeDeviceId, created_at: "fecha mala", total: -1, items: [] }], pendingCustomers: [] }),
});
check("procesar lote parcialmente inválido", partial.response.status === 200 && partial.body.rejected.some((item) => item.uuid === invalidUuid));

const spoofed = await jsonRequest("/api/v1/sync/batch", {
  method: "POST",
  headers: { Authorization: `Bearer ${activeToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ deviceId: crypto.randomUUID(), guides: [], pendingCustomers: [] }),
});
check("impedir suplantación de dispositivo", spoofed.response.status === 403, { status: spoofed.response.status });

const pendingCode = await createActivation("CAJA PRUEBA PENDIENTE", ambato.id, 1440);
check("dejar código de activación de prueba", pendingCode.response.status === 201);

const report = {
  baseUrl,
  results,
  publication: {
    version: publication.version,
    checksum: publication.checksum,
    generatedAt: publication.generatedAt,
    products: packageBody.products,
  },
  activeDevice: {
    deviceId: activeDeviceId,
    deviceName: activeActivation.body.deviceName,
    warehouse: activeActivation.body.warehouse,
    accessToken: activeToken,
  },
  pendingActivation: pendingCode.body,
  idempotency: { guideUuid, customerUuid, duplicateResponse: duplicateBatch.body },
};

console.log(JSON.stringify(report, null, 2));
await mongoose.disconnect();
