import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { PendingCustomer, SyncGuide } from "@/modules/business/models";

const MODELS = { guides: SyncGuide, customers: PendingCustomer };

export async function PATCH(request, context) {
  const access = await getBusinessAccess("business.syncDocuments.manage");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await connectToDatabase();
    const { type, id } = await context.params;
    const Model = MODELS[type];
    if (!Model) return NextResponse.json({ error: "Tipo de documento inválido." }, { status: 400 });
    const body = await request.json();
    const status = String(body?.status || "").trim().toLowerCase();
    if (!["pending", "processed", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
    }
    const item = await Model.findByIdAndUpdate(
      id,
      { $set: { status } },
      { returnDocument: "after" },
    );
    if (!item) return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });

    const actor = await resolveAuditActor();
    await createAuditLog({
      actor,
      action: "business.syncDocument.status",
      entityType: type === "guides" ? "businessSyncGuide" : "businessPendingCustomer",
      entityId: item._id.toString(),
      entityLabel: item.syncUuid,
      route: `/api/business/sync/documents/${type}/${id}`,
      details: { status },
    });
    return NextResponse.json({ success: true, status });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudo actualizar el documento." }, { status: 400 });
  }
}
