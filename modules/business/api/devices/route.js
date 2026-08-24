import { NextResponse } from "next/server";

import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { PUBLISHABLE_WAREHOUSE_NAMES } from "@/modules/business/lib/warehouses";
import { Device, DeviceActivationCode, Warehouse } from "@/modules/business/models";

function serializeDevice(item) {
  return {
    id: item._id.toString(),
    deviceId: item.deviceId,
    deviceName: item.deviceName,
    warehouseName: item.warehouseName || "TODAS LAS BODEGAS",
    status: item.status,
    activatedAt: item.activatedAt,
    revokedAt: item.revokedAt,
    lastSeenAt: item.lastSeenAt,
    lastManifestAt: item.lastManifestAt,
    lastSyncAt: item.lastSyncAt,
    lastDownloadedVersion: item.lastDownloadedVersion || "",
    documentCount: item.documentCount || 0,
  };
}

export async function GET() {
  const access = await getBusinessAccess("business.devices.view");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await connectToDatabase();
    const [devices, activationCodes, warehouses] = await Promise.all([
      Device.find({}).sort({ createdAt: -1 }).lean(),
      DeviceActivationCode.find({}).sort({ createdAt: -1 }).limit(20).lean(),
      Warehouse.find({ isActive: { $ne: false } }).sort({ name: 1 }).lean(),
    ]);

    return NextResponse.json({
      devices: devices.map(serializeDevice),
      activationCodes: activationCodes.map((item) => ({
        id: item._id.toString(),
        codeSuffix: item.codeSuffix,
        deviceName: item.deviceName,
        warehouseName: item.warehouseName || "TODAS LAS BODEGAS",
        permanent: Boolean(item.permanent),
        expiresAt: item.expiresAt,
        usedAt: item.usedAt,
        revokedAt: item.revokedAt,
        createdBy: item.createdBy,
        createdAt: item.createdAt,
      })),
      warehouses: warehouses
        .filter((item) => PUBLISHABLE_WAREHOUSE_NAMES.has(item.name))
        .map((item) => ({ id: item._id.toString(), code: item.code, name: item.name })),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudieron cargar los dispositivos." }, { status: 500 });
  }
}
