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

export async function PATCH(request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    const params = await context.params;
    const templateId = String(params?.id || "").trim();

    if (!templateId) {
      return NextResponse.json({ error: "Debes indicar una plantilla valida." }, { status: 400 });
    }

    await connectToDatabase();

    const body = await request.json();
    const areaCode = String(body?.areaCode || "").trim();
    const roleCode = String(body?.roleCode || "").trim();
    const [area, role] = await Promise.all([
      Area.findOne({ code: areaCode }).lean(),
      roleCode ? Role.findOne({ code: roleCode, areaCode }).lean() : null,
    ]);
    const payload = normalizeBaseScheduleTemplatePayload(body, { area, role });
    const template = await BaseScheduleTemplate.findByIdAndUpdate(templateId, payload, {
      new: true,
      runValidators: true,
    });

    if (!template) {
      return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 404 });
    }

    return NextResponse.json({
      message: "Plantilla actualizada correctamente.",
      template: serializeBaseScheduleTemplate(template),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return NextResponse.json(
        { error: "Ya existe una plantilla con ese nombre para el area y rol seleccionados." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: error.message || "No se pudo actualizar la plantilla de horario." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  const params = await context.params;
  const templateId = String(params?.id || "").trim();

  if (!templateId) {
    return NextResponse.json({ error: "Debes indicar una plantilla valida." }, { status: 400 });
  }

  await connectToDatabase();

  const deleted = await BaseScheduleTemplate.findByIdAndDelete(templateId).lean();

  if (!deleted) {
    return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
