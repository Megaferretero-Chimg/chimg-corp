import { NextResponse } from "next/server";

import connectToDatabase from "@/lib/db/mongodb";
import { authenticateDeviceRequest, logDeviceSync } from "@/modules/business/lib/device-auth";
import { validateGuide, validatePendingCustomer } from "@/modules/business/lib/sync-validation";
import { Device, PendingCustomer, SyncGuide } from "@/modules/business/models";

async function acceptOne(Model, validation, accepted, duplicates, rejected) {
  if (validation.errors.length) {
    rejected.push({ uuid: validation.syncUuid || "", error: validation.errors.join(" ") });
    return;
  }

  const result = await Model.updateOne(
    { syncUuid: validation.syncUuid },
    { $setOnInsert: validation.document },
    { upsert: true },
  );
  if (result.upsertedCount === 1) accepted.push(validation.syncUuid);
  else duplicates.push(validation.syncUuid);
}

export async function POST(request) {
  const auth = await authenticateDeviceRequest(request, { action: "batch" });
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const deviceId = String(body?.deviceId || "").trim();
    if (deviceId !== auth.device.deviceId) {
      await logDeviceSync({
        device: auth.device,
        action: "batch",
        status: "rejected",
        details: { reason: "device_mismatch", requestedDeviceId: deviceId },
      });
      return NextResponse.json({ error: "deviceId no corresponde al Bearer Token." }, { status: 403 });
    }

    const guides = Array.isArray(body?.guides) ? body.guides : [];
    const pendingCustomers = Array.isArray(body?.pendingCustomers) ? body.pendingCustomers : [];
    if (guides.length + pendingCustomers.length > 200) {
      return NextResponse.json({ error: "El lote supera el máximo de 200 registros." }, { status: 400 });
    }

    await connectToDatabase();
    const accepted = [];
    const duplicates = [];
    const rejected = [];

    for (const guide of guides) {
      await acceptOne(SyncGuide, validateGuide(guide, auth.device), accepted, duplicates, rejected);
    }
    for (const customer of pendingCustomers) {
      await acceptOne(PendingCustomer, validatePendingCustomer(customer, auth.device), accepted, duplicates, rejected);
    }

    const now = new Date();
    await Promise.all([
      Device.updateOne({ _id: auth.device._id }, {
        $set: { lastSyncAt: now, lastSeenAt: now },
        $inc: { documentCount: accepted.length },
      }),
      logDeviceSync({
        device: auth.device,
        action: "batch",
        status: rejected.length ? "partial" : "success",
        details: { accepted: accepted.length, duplicates: duplicates.length, rejected },
      }),
    ]);

    return NextResponse.json({ accepted, duplicates, rejected });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudo procesar el lote." }, { status: 400 });
  }
}
