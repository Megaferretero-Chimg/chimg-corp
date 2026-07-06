import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { isAuthenticated } from "@/lib/auth";
import {
  normalizeAreaPayload,
  resolveUniqueAreaCode,
  serializeArea,
} from "@/modules/company/submodules/organization/lib/areas";
import { syncAreaRelations } from "@/modules/company/submodules/organization/lib/areaRelations";
import { syncCatalogsFromActiveStructure } from "@/modules/company/submodules/organization/lib/structureCatalogSync";
import connectToDatabase from "@/lib/db/mongodb";
import { Area, OrganizationNode, Role } from "@/modules/company/models";

export async function PATCH(request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const { id } = await context.params;
    const body = await request.json();
    const existingArea = await Area.findById(id).lean();

    if (!existingArea) {
      return NextResponse.json({ error: "Área no encontrada." }, { status: 404 });
    }

    const payload = normalizeAreaPayload(body);
    const existingAreas = await Area.find({ _id: { $ne: id } }, { code: 1 }).lean();
    const code = payload.code
      ? resolveUniqueAreaCode(
        payload.code,
        existingAreas.map((area) => area.code),
        payload.name,
      )
      : existingArea.code;

    const area = await Area.findByIdAndUpdate(id, { ...payload, code }, {
      new: true,
      runValidators: true,
    });
    await syncAreaRelations(area, { previousAreaCode: existingArea.code });
    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "area.update",
      entityType: "area",
      entityId: area._id.toString(),
      entityLabel: area.name,
      route: `/api/company/areas/${id}`,
      details: {
        before: serializeArea(existingArea),
        after: serializeArea(area),
      },
    });

    return NextResponse.json({
      area: serializeArea(area),
    });
  } catch (error) {
    if (error?.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const message =
        field === "code"
          ? "Ya existe un área con ese código."
          : "Ya existe un área con ese nombre.";

      return NextResponse.json({ error: message }, { status: 409 });
    }

    return NextResponse.json(
      { error: error.message || "No se pudo actualizar el área." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  await connectToDatabase();
  const { id } = await context.params;
  const area = await Area.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true });

  if (!area) {
    return NextResponse.json({ error: "Área no encontrada." }, { status: 404 });
  }
  await OrganizationNode.updateMany(
    { areaCode: area.code },
    { $set: { isActive: false } },
  );
  await Role.updateMany(
    { areaCode: area.code },
    { $set: { isActive: false } },
  );
  await syncCatalogsFromActiveStructure();
  const actor = await resolveAuditActor();

  await createAuditLog({
    actor,
    action: "area.delete",
    entityType: "area",
    entityId: area._id.toString(),
    entityLabel: area.name,
    route: `/api/company/areas/${id}`,
    details: {
      deleted: serializeArea(area),
    },
  });

  return NextResponse.json({ success: true });
}
