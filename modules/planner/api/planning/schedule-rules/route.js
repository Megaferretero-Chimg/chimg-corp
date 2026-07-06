import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  DEFAULT_SCHEDULE_RULE_CONFIG,
  SCHEDULE_RULE_CONFIG_KEY,
  normalizeScheduleRuleConfigPayload,
  serializeScheduleRuleConfig,
} from "@/modules/planner/lib/planning/scheduleRules";
import { ScheduleRuleConfig } from "@/modules/planner/models";

export async function GET() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.settings.view")) {
    return NextResponse.json({ error: "No tienes permiso para ver la configuracion de planificacion." }, { status: 403 });
  }

  await connectToDatabase();

  const config = await ScheduleRuleConfig.findOneAndUpdate(
    { key: SCHEDULE_RULE_CONFIG_KEY },
    { $setOnInsert: DEFAULT_SCHEDULE_RULE_CONFIG },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  ).lean();

  return NextResponse.json({
    config: serializeScheduleRuleConfig(config),
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
    const payload = normalizeScheduleRuleConfigPayload(body);
    const config = await ScheduleRuleConfig.findOneAndUpdate(
      { key: SCHEDULE_RULE_CONFIG_KEY },
      { $set: payload },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    return NextResponse.json({
      message: "Reglas de horario guardadas correctamente.",
      config: serializeScheduleRuleConfig(config),
      source: "saved",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron guardar las reglas de horario." },
      { status: 400 },
    );
  }
}
