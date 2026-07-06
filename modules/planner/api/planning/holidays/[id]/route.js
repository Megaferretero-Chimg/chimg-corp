import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { Holiday } from "@/modules/planner/models";

export async function DELETE(_request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  const params = await context.params;
  const holidayId = String(params?.id || "").trim();

  if (!holidayId) {
    return NextResponse.json({ error: "Debes indicar un feriado valido." }, { status: 400 });
  }

  await connectToDatabase();

  const deleted = await Holiday.findByIdAndDelete(holidayId).lean();

  if (!deleted) {
    return NextResponse.json({ error: "Feriado no encontrado." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
