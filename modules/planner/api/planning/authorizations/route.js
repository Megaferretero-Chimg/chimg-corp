import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  AUTHORIZATION_CONFIG_KEY,
  DEFAULT_AUTHORIZATION_CONFIG,
  normalizeAuthorizationConfigPayload,
  serializeAuthorizationConfig,
} from "@/modules/planner/lib/planning/authorizations";
import AuthorizationConfig from "@/modules/planner/models/AuthorizationConfig";

export async function GET() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.settings.view")) {
    return NextResponse.json({ error: "No tienes permiso para ver la configuracion de planificacion." }, { status: 403 });
  }

  await connectToDatabase();

  const config = await AuthorizationConfig.findOneAndUpdate(
    { key: AUTHORIZATION_CONFIG_KEY },
    { $setOnInsert: DEFAULT_AUTHORIZATION_CONFIG },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  ).lean();

  return NextResponse.json({
    config: serializeAuthorizationConfig(config),
    source: "saved",
  });
}

export async function PUT(request) {
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
    const payload = normalizeAuthorizationConfigPayload(body);
    const config = await AuthorizationConfig.findOneAndUpdate(
      { key: AUTHORIZATION_CONFIG_KEY },
      { $set: payload },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    return NextResponse.json({
      message: "Configuracion de autorizaciones guardada correctamente.",
      config: serializeAuthorizationConfig(config),
      source: "saved",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo guardar la configuracion de autorizaciones." },
      { status: 400 },
    );
  }
}
