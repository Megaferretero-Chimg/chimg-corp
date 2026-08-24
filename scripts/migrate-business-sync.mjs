import mongoose from "mongoose";

import ApiRateLimit from "../modules/business/models/ApiRateLimit.js";
import Device from "../modules/business/models/Device.js";
import DeviceActivationCode from "../modules/business/models/DeviceActivationCode.js";
import DeviceSyncLog from "../modules/business/models/DeviceSyncLog.js";
import InventoryDraftProduct from "../modules/business/models/InventoryDraftProduct.js";
import InventoryImport from "../modules/business/models/InventoryImport.js";
import InventoryPackageChunk from "../modules/business/models/InventoryPackageChunk.js";
import InventoryPublication from "../modules/business/models/InventoryPublication.js";
import InventoryStock from "../modules/business/models/InventoryStock.js";
import InventoryVersionCounter from "../modules/business/models/InventoryVersionCounter.js";
import PendingCustomer from "../modules/business/models/PendingCustomer.js";
import Product from "../modules/business/models/Product.js";
import SyncGuide from "../modules/business/models/SyncGuide.js";
import Warehouse from "../modules/business/models/Warehouse.js";

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI no está configurado.");

const warehouses = [
  { code: "AMB-ALM", name: "ALMACÉN AMBATO", location: "Ambato", sourceNames: ["ALMACÉN AMBATO", "ALMACEN AMBATO", "AMBATO ALMACEN", "ALMACEN"] },
  { code: "SAL-ALM", name: "ALMACÉN SALCEDO", location: "Salcedo", sourceNames: ["ALMACÉN SALCEDO", "ALMACEN SALCEDO", "SALCEDO ALMACEN"] },
  { code: "INT", name: "INTERNA", location: "", sourceNames: ["INTERNA"] },
  { code: "EXT", name: "EXTERNA", location: "", sourceNames: ["EXTERNA"] },
];

await mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false });

for (const warehouse of warehouses) {
  await Warehouse.updateOne(
    { code: warehouse.code },
    { $set: { ...warehouse, isActive: true, createdFromImport: false } },
    { upsert: true },
  );
}

const models = [
  ApiRateLimit,
  Device,
  DeviceActivationCode,
  DeviceSyncLog,
  InventoryDraftProduct,
  InventoryImport,
  InventoryPackageChunk,
  InventoryPublication,
  InventoryStock,
  InventoryVersionCounter,
  PendingCustomer,
  Product,
  SyncGuide,
  Warehouse,
];

for (const Model of models) {
  await Model.createIndexes();
}

console.log(JSON.stringify({
  migratedAt: new Date().toISOString(),
  warehouses: warehouses.map(({ code, name }) => ({ code, name })),
  indexedModels: models.map((Model) => Model.modelName),
}, null, 2));

await mongoose.disconnect();
