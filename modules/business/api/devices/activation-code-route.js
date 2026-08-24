import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { createActivationCode, hashActivationCode } from "@/modules/business/lib/device-auth";
import { PUBLISHABLE_WAREHOUSE_NAMES } from "@/modules/business/lib/warehouses";
import { DeviceActivationCode, Warehouse } from "@/modules/business/models";

export async function POST(request) {
  const access = await getBusinessAccess("business.devices.manage");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await connectToDatabase();
    const body = await request.json();
    const warehouseId = String(body?.warehouseId || "").trim();
    const deviceName = String(body?.deviceName || "").trim();
    const requestedMinutes = Number(body?.expiresInMinutes || 60);
    const expiresInMinutes = Math.min(1440, Math.max(5, Number.isFinite(requestedMinutes) ? requestedMinutes : 60));
    if (!deviceName || !warehouseId) throw new Error("Nombre del equipo y bodega son obligatorios.");

    const warehouse = await Warehouse.findOne({ _id: warehouseId, isActive: { $ne: false } }).lean();
    if (!warehouse || !PUBLISHABLE_WAREHOUSE_NAMES.has(warehouse.name)) {
      throw new Error("Selecciona una de las cuatro bodegas autorizadas.");
    }

    let code = "";
    let activation;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      code = createActivationCode();
      try {
        activation = await DeviceActivationCode.create({
          codeHash: hashActivationCode(code),
          codeSuffix: code.slice(-3),
          deviceName,
          warehouse: warehouse._id,
          warehouseName: warehouse.name,
          expiresAt: new Date(Date.now() + expiresInMinutes * 60_000),
          createdBy: String(access.user.employeeName || access.user.username || "ADMIN"),
          createdByUser: String(access.user.id || ""),
        });
        break;
      } catch (error) {
        if (error?.code !== 11000 || attempt === 4) throw error;
      }
    }

    const actor = await resolveAuditActor();
    await createAuditLog({
      actor,
      action: "business.device.activationCode.create",
      entityType: "businessDeviceActivationCode",
      entityId: activation._id.toString(),
      entityLabel: deviceName,
      route: "/api/business/devices/activation-codes",
      details: { warehouse: warehouse.name, expiresAt: activation.expiresAt },
    });

    return NextResponse.json({
      activationCode: code,
      deviceName: activation.deviceName,
      warehouse: activation.warehouseName,
      expiresAt: activation.expiresAt,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudo generar el código." }, { status: 400 });
  }
}
