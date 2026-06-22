import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  normalizeBaseScheduleTemplatePayload,
  serializeBaseScheduleTemplate,
} from "@/lib/planning/baseSchedules";
import Area from "@/models/Area";
import BaseScheduleTemplate from "@/models/BaseScheduleTemplate";
import Role from "@/models/Role";

export async function GET() {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  await connectToDatabase();

  const templates = await BaseScheduleTemplate.find({ isActive: { $ne: false } })
    .sort({ areaName: 1, roleName: 1, name: 1 })
    .lean();

  return NextResponse.json({
    templates: templates.map(serializeBaseScheduleTemplate),
  });
}

export async function POST(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const body = await request.json();
    const areaCode = String(body?.areaCode || "").trim();
    const roleCode = String(body?.roleCode || "").trim();
    const [area, role] = await Promise.all([
      Area.findOne({ code: areaCode }).lean(),
      roleCode ? Role.findOne({ code: roleCode, areaCode }).lean() : null,
    ]);
    const payload = normalizeBaseScheduleTemplatePayload(body, { area, role });
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
        { error: "Ya existe una plantilla con ese nombre para el area y rol seleccionados." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: error.message || "No se pudo crear la plantilla de horario." },
      { status: 400 },
    );
  }
}
