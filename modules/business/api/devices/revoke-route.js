import mongoose from "mongoose";
import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { Device, DeviceActivationCode } from "@/modules/business/models";

export async function PATCH(_request, context) {
  const access = await getBusinessAccess("business.devices.manage");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await connectToDatabase();
    const { id } = await context.params;
    const actor = await resolveAuditActor();
    const now = new Date();
    const session = await mongoose.startSession();
    let device;

    try {
      await session.withTransaction(async () => {
        device = await Device.findOneAndUpdate(
          { _id: id, status: "active" },
          { $set: { status: "revoked", revokedAt: now, revokedBy: actor } },
          { returnDocument: "after", session },
        );
        if (!device) return;

        await DeviceActivationCode.updateMany(
          { usedByDeviceId: device.deviceId, revokedAt: null },
          { $set: { revokedAt: now } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    if (!device) return NextResponse.json({ error: "Dispositivo activo no encontrado." }, { status: 404 });

    await createAuditLog({
      actor,
      action: "business.device.permanentKey.delete",
      entityType: "businessDevice",
      entityId: device._id.toString(),
      entityLabel: device.deviceName,
      route: `/api/business/devices/${id}/revoke`,
      details: { deviceId: device.deviceId, warehouse: device.warehouseName },
    });
    return NextResponse.json({ success: true, deviceId: device.deviceId });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudo eliminar la llave del dispositivo." }, { status: 400 });
  }
}
