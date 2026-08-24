import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import {
  publishInventoryImport,
  serializePublication,
} from "@/modules/business/lib/inventory-publication";

export async function POST(_request, context) {
  const access = await getBusinessAccess("business.inventory.publish");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await connectToDatabase();
    const { id } = await context.params;
    const publication = await publishInventoryImport({ importId: id, user: access.user });
    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "business.inventory.publish",
      entityType: "businessInventoryPublication",
      entityId: publication._id.toString(),
      entityLabel: publication.version,
      route: `/api/business/inventory/imports/${id}/publish`,
      details: {
        importId: id,
        version: publication.version,
        checksum: publication.checksum,
        productCount: publication.productCount,
        stockCount: publication.stockCount,
      },
    });

    return NextResponse.json({
      message: `Inventario ${publication.version} publicado correctamente.`,
      publication: serializePublication(publication),
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudo publicar el inventario." }, { status: 400 });
  }
}
