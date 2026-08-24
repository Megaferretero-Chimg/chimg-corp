import { NextResponse } from "next/server";

import connectToDatabase from "@/lib/db/mongodb";
import { authenticateDeviceRequest, logDeviceSync } from "@/modules/business/lib/device-auth";
import { readPublicationBytes } from "@/modules/business/lib/inventory-publication";
import { Device, InventoryPublication } from "@/modules/business/models";

export async function GET(request, context) {
  const auth = await authenticateDeviceRequest(request, { action: "download" });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { version } = await context.params;
  if (!/^\d{8}-\d{2,}$/.test(String(version || ""))) {
    return NextResponse.json({ error: "Versión de inventario inválida." }, { status: 400 });
  }

  await connectToDatabase();
  const publication = await InventoryPublication.findOne({
    version,
    status: { $in: ["published", "superseded"] },
  }).lean();
  if (!publication) return NextResponse.json({ error: "Versión publicada no encontrada." }, { status: 404 });

  try {
    const bytes = await readPublicationBytes(publication);
    const now = new Date();
    await Promise.all([
      Device.updateOne({ _id: auth.device._id }, {
        $set: { lastDownloadedVersion: version, lastSyncAt: now, lastSeenAt: now },
      }),
      logDeviceSync({ device: auth.device, action: "download", status: "success", version }),
    ]);

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        ETag: `"${publication.checksum}"`,
        "X-Content-SHA256": publication.checksum,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "El paquete publicado no está disponible." }, { status: 500 });
  }
}
