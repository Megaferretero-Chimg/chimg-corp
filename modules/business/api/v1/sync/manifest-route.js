import { NextResponse } from "next/server";

import connectToDatabase from "@/lib/db/mongodb";
import { authenticateDeviceRequest, logDeviceSync } from "@/modules/business/lib/device-auth";
import { Device, InventoryPublication } from "@/modules/business/models";

export async function GET(request) {
  const auth = await authenticateDeviceRequest(request, { action: "manifest" });
  if (auth.error) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: auth.retryAfterSeconds ? { "Retry-After": String(auth.retryAfterSeconds) } : undefined },
    );
  }

  await connectToDatabase();
  const publication = await InventoryPublication.findOne({ status: "published" }).sort({ publishedAt: -1 }).lean();
  const now = new Date();
  await Promise.all([
    Device.updateOne({ _id: auth.device._id }, { $set: { lastManifestAt: now, lastSeenAt: now } }),
    logDeviceSync({ device: auth.device, action: "manifest", status: "success", version: publication?.version || "" }),
  ]);

  return NextResponse.json({
    inventory: publication ? {
      version: publication.version,
      checksum: publication.checksum,
      generatedAt: publication.generatedAtText,
      downloadUrl: `/api/v1/sync/packages/inventory/${publication.version}`,
    } : null,
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}
