import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import {
  DEFAULT_WAREHOUSES,
  normalizeWarehousePayload,
  resolveWarehouseCode,
  serializeWarehouse,
} from "@/modules/business/lib/warehouses";
import { InventoryStock, Warehouse } from "@/modules/business/models";

async function ensureDefaultWarehouses() {
  await Promise.all(DEFAULT_WAREHOUSES.map((warehouse) => Warehouse.updateOne(
    { code: warehouse.code },
    { $setOnInsert: { ...warehouse, isActive: true, createdFromImport: false } },
    { upsert: true },
  )));
}

export async function GET() {
  const access = await getBusinessAccess("business.warehouses.view");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await connectToDatabase();
    await ensureDefaultWarehouses();

    const [warehouses, summaries] = await Promise.all([
      Warehouse.find({}).sort({ name: 1 }).lean(),
      InventoryStock.aggregate([
        { $group: { _id: "$warehouse", productCount: { $sum: 1 }, totalQuantity: { $sum: "$quantity" } } },
      ]),
    ]);
    const summaryByWarehouse = new Map(summaries.map((item) => [item._id.toString(), item]));

    return NextResponse.json({
      warehouses: warehouses.map((warehouse) => serializeWarehouse(
        warehouse,
        summaryByWarehouse.get(warehouse._id.toString()),
      )),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudieron cargar las bodegas." }, { status: 500 });
  }
}

export async function POST(request) {
  const access = await getBusinessAccess("business.warehouses.manage");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await connectToDatabase();
    const payload = normalizeWarehousePayload(await request.json());
    const existingCodes = await Warehouse.distinct("code");
    const warehouse = await Warehouse.create({
      ...payload,
      code: resolveWarehouseCode(payload.name, existingCodes),
      createdFromImport: false,
    });
    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "business.warehouse.create",
      entityType: "businessWarehouse",
      entityId: warehouse._id.toString(),
      entityLabel: warehouse.name,
      route: "/api/business/warehouses",
      details: { after: serializeWarehouse(warehouse) },
    });

    return NextResponse.json({ warehouse: serializeWarehouse(warehouse) }, { status: 201 });
  } catch (error) {
    const message = error?.code === 11000
      ? "Ya existe una bodega con ese nombre o código."
      : error.message || "No se pudo crear la bodega.";
    return NextResponse.json({ error: message }, { status: error?.code === 11000 ? 409 : 400 });
  }
}
