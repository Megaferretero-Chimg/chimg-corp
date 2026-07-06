import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import { seedOperationalSetup } from "@/modules/planner/lib/planning/operationalSetup";

export async function POST() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.settings.manage")) {
    return NextResponse.json({ error: "No tienes permiso para gestionar la configuracion de planificacion." }, { status: 403 });
  }

  try {
    await connectToDatabase();

    const summary = await seedOperationalSetup();

    return NextResponse.json({
      message: "Catalogo operativo inicial cargado correctamente.",
      summary,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo cargar el catalogo operativo inicial." },
      { status: 400 },
    );
  }
}
