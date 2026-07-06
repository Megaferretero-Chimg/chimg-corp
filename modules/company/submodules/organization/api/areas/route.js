import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { isAuthenticated } from "@/lib/auth";
import {
  normalizeAreaPayload,
  resolveUniqueAreaCode,
  serializeArea,
} from "@/modules/company/submodules/organization/lib/areas";
import { syncAreaRelations } from "@/modules/company/submodules/organization/lib/areaRelations";
import connectToDatabase from "@/lib/db/mongodb";
import { Area } from "@/modules/company/models";

export async function GET() {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  await connectToDatabase();
  const areas = await Area.find({ isActive: { $ne: false } })
    .sort({ name: 1 })
    .lean();

  return NextResponse.json({
    areas: areas.map(serializeArea),
  });
}

export async function POST(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const body = await request.json();
    const payload = normalizeAreaPayload(body);
    const existingAreas = await Area.find({}, { code: 1 }).lean();
    const code = resolveUniqueAreaCode(
      payload.code,
      existingAreas.map((area) => area.code),
      payload.name,
    );
    const area = await Area.create({
      ...payload,
      code,
    });
    await syncAreaRelations(area);
    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "area.create",
      entityType: "area",
      entityId: area._id.toString(),
      entityLabel: area.name,
      route: "/api/company/areas",
      details: {
        after: serializeArea(area),
      },
    });

    return NextResponse.json(
      {
        area: serializeArea(area),
      },
      { status: 201 },
    );
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
      { error: error.message || "No se pudo crear el área." },
      { status: 400 },
    );
  }
}
