import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  normalizeBaseScheduleTemplatePayload,
  serializeBaseScheduleTemplate,
} from "@/modules/planner/lib/planning/baseSchedules";
import { BaseScheduleTemplate } from "@/modules/planner/models";
import { Role } from "@/modules/company/models";

export async function GET() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.settings.view")) {
    return NextResponse.json({ error: "No tienes permiso para ver la configuracion de planificacion." }, { status: 403 });
  }

  await connectToDatabase();

  const templates = await BaseScheduleTemplate.find({ isActive: { $ne: false } })
    .sort({ name: 1 })
    .lean();

  return NextResponse.json({
    templates: templates.map(serializeBaseScheduleTemplate),
  });
}

export async function POST(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.settings.manage")) {
    return NextResponse.json({ error: "No tienes permiso para gestionar la configuracion de planificacion." }, { status: 403 });
  }

  try {
    await connectToDatabase();

    const body = await request.json();
    const roleCode = String(body?.roleCode || "").trim();
    const role = roleCode ? await Role.findOne({ code: roleCode }).lean() : null;
    const payload = normalizeBaseScheduleTemplatePayload(body, { role });
    const template = await BaseScheduleTemplate.create(payload);

    return NextResponse.json(
      {
        message: "Plantilla creada correctamente.",
        template: serializeBaseScheduleTemplate(template),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error?.code === 11000) {
      return NextResponse.json(
        { error: "Ya existe ese horario en plantillas." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: error.message || "No se pudo crear la plantilla de horario." },
      { status: 400 },
    );
  }
}
