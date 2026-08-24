import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { normalizeWarehousePayload, serializeWarehouse } from "@/modules/business/lib/warehouses";
import { InventoryStock, Warehouse } from "@/modules/business/models";

export async function PATCH(request, context) {
  const access = await getBusinessAccess("business.warehouses.manage");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await connectToDatabase();
    const { id } = await context.params;
    const existing = await Warehouse.findById(id).lean();
    if (!existing) return NextResponse.json({ error: "Bodega no encontrada." }, { status: 404 });

    const payload = normalizeWarehousePayload(await request.json());
    const warehouse = await Warehouse.findByIdAndUpdate(id, payload, {
      returnDocument: "after",
      runValidators: true,
    });
    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "business.warehouse.update",
      entityType: "businessWarehouse",
      entityId: warehouse._id.toString(),
      entityLabel: warehouse.name,
      route: `/api/business/warehouses/${id}`,
      details: { before: serializeWarehouse(existing), after: serializeWarehouse(warehouse) },
    });

    return NextResponse.json({ warehouse: serializeWarehouse(warehouse) });
  } catch (error) {
    const message = error?.code === 11000
      ? "Ya existe una bodega con ese nombre."
      : error.message || "No se pudo actualizar la bodega.";
    return NextResponse.json({ error: message }, { status: error?.code === 11000 ? 409 : 400 });
  }
}

export async function DELETE(_request, context) {
  const access = await getBusinessAccess("business.warehouses.manage");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await connectToDatabase();
    const { id } = await context.params;
    const stockCount = await InventoryStock.countDocuments({ warehouse: id });

    if (stockCount) {
      return NextResponse.json(
        { error: "La bodega tiene existencias registradas. Inactívala para conservar el historial." },
        { status: 409 },
      );
    }

    const warehouse = await Warehouse.findByIdAndDelete(id);
    if (!warehouse) return NextResponse.json({ error: "Bodega no encontrada." }, { status: 404 });

    const actor = await resolveAuditActor();
    await createAuditLog({
      actor,
      action: "business.warehouse.delete",
      entityType: "businessWarehouse",
      entityId: warehouse._id.toString(),
      entityLabel: warehouse.name,
      route: `/api/business/warehouses/${id}`,
      details: { deleted: serializeWarehouse(warehouse) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudo eliminar la bodega." }, { status: 400 });
  }
}
