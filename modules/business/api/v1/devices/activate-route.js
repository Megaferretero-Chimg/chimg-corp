import mongoose from "mongoose";
import { NextResponse } from "next/server";

import connectToDatabase from "@/lib/db/mongodb";
import AuditLog from "@/models/AuditLog";
import {
  consumeRateLimit,
  createAccessToken,
  getClientIp,
  hashActivationCode,
  hashDeviceToken,
  isUuid,
} from "@/modules/business/lib/device-auth";
import {
  Device,
  DeviceActivationCode,
  DeviceSyncLog,
} from "@/modules/business/models";

export async function POST(request) {
  await connectToDatabase();
  const rate = await consumeRateLimit(`activation:${getClientIp(request)}`, { limit: 10, windowMs: 15 * 60_000 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Demasiados intentos de activación." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const body = await request.json();
    const activationCode = String(body?.activationCode || "").trim().toUpperCase();
    const deviceId = String(body?.deviceId || "").trim();
    const requestedDeviceName = String(body?.deviceName || "").trim();

    if (!activationCode || !isUuid(deviceId) || !requestedDeviceName) {
      return NextResponse.json({ error: "activationCode, deviceId UUID y deviceName son obligatorios." }, { status: 400 });
    }

    const accessToken = createAccessToken();
    const tokenHash = hashDeviceToken(accessToken);
    const codeHash = hashActivationCode(activationCode);
    const now = new Date();
    const session = await mongoose.startSession();
    let device;

    try {
      await session.withTransaction(async () => {
        const existingDevice = await Device.findOne({ deviceId }).session(session);
        if (existingDevice) throw new Error("DEVICE_ALREADY_REGISTERED");

        const activation = await DeviceActivationCode.findOneAndUpdate(
          {
            codeHash,
            usedAt: null,
            revokedAt: null,
            expiresAt: { $gt: now },
          },
          { $set: { usedAt: now, usedByDeviceId: deviceId } },
          { returnDocument: "after", session },
        ).select("+codeHash");
        if (!activation) throw new Error("INVALID_ACTIVATION_CODE");

        [device] = await Device.create([{
          deviceId,
          deviceName: activation.deviceName,
          warehouse: activation.warehouse,
          warehouseName: activation.warehouseName,
          tokenHash,
          status: "active",
          activatedAt: now,
          lastSeenAt: now,
        }], { session });

        await DeviceSyncLog.create([{
          device: device._id,
          deviceId,
          action: "activate",
          status: "success",
          details: { requestedDeviceName, warehouse: device.warehouseName },
          happenedAt: now,
        }], { session });
        await AuditLog.create([{
          actor: `device:${deviceId}`,
          action: "business.device.activate",
          entityType: "businessDevice",
          entityId: device._id.toString(),
          entityLabel: device.deviceName,
          route: "/api/v1/devices/activate",
          details: { warehouse: device.warehouseName },
        }], { session });
      });
    } finally {
      await session.endSession();
    }

    return NextResponse.json({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      warehouse: device.warehouseName,
      accessToken,
    });
  } catch (error) {
    if (error.message === "INVALID_ACTIVATION_CODE") {
      return NextResponse.json({ error: "Código inválido, utilizado o vencido." }, { status: 401 });
    }
    if (error.message === "DEVICE_ALREADY_REGISTERED" || error?.code === 11000) {
      return NextResponse.json({ error: "El dispositivo ya fue registrado." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message || "No se pudo activar el dispositivo." }, { status: 400 });
  }
}
