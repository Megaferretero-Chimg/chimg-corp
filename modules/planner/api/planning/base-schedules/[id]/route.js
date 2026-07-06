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

export async function PATCH(request, context) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.settings.manage")) {
    return NextResponse.json({ error: "No tienes permiso para gestionar la configuracion de planificacion." }, { status: 403 });
  }

  try {
    const params = await context.params;
    const templateId = String(params?.id || "").trim();

    if (!templateId) {
      return NextResponse.json({ error: "Debes indicar una plantilla valida." }, { status: 400 });
    }

    await connectToDatabase();

    const body = await request.json();
    const roleCode = String(body?.roleCode || "").trim();
    const role = roleCode ? await Role.findOne({ code: roleCode }).lean() : null;
    const payload = normalizeBaseScheduleTemplatePayload(body, { role });
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
        { error: "Ya existe ese horario en plantillas." },
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
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.settings.manage")) {
    return NextResponse.json({ error: "No tienes permiso para gestionar la configuracion de planificacion." }, { status: 403 });
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
