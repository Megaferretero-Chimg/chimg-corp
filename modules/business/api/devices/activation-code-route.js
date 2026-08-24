import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { createActivationCode, hashActivationCode } from "@/modules/business/lib/device-auth";
import { DeviceActivationCode } from "@/modules/business/models";

export async function POST(request) {
  const access = await getBusinessAccess("business.devices.manage");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await connectToDatabase();
    const body = await request.json();
    const deviceName = String(body?.deviceName || "").trim();
    if (!deviceName) throw new Error("El nombre del equipo es obligatorio.");

    let code = "";
    let activation;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      code = createActivationCode();
      try {
        activation = await DeviceActivationCode.create({
          codeHash: hashActivationCode(code),
          codeSuffix: code.slice(-3),
          deviceName,
          warehouse: null,
          warehouseName: "TODAS LAS BODEGAS",
          permanent: true,
          expiresAt: null,
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
      action: "business.device.permanentKey.create",
      entityType: "businessDevicePermanentKey",
      entityId: activation._id.toString(),
      entityLabel: deviceName,
      route: "/api/business/devices/activation-codes",
      details: { warehouseAccess: "all", permanent: true },
    });

    return NextResponse.json({
      deviceKey: code,
      activationCode: code,
      deviceName: activation.deviceName,
      warehouse: "TODAS LAS BODEGAS",
      permanent: true,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudo generar la llave permanente." }, { status: 400 });
  }
}
