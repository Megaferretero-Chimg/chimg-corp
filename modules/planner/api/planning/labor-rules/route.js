import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  DEFAULT_LABOR_RULE_CONFIG,
  LABOR_RULE_CONFIG_KEY,
  normalizeLaborRuleConfigPayload,
  serializeLaborRuleConfig,
} from "@/modules/planner/lib/planning/laborRules";
import LaborRuleConfig from "@/modules/planner/models/LaborRuleConfig";

export async function GET() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.settings.view")) {
    return NextResponse.json({ error: "No tienes permiso para ver la configuracion de planificacion." }, { status: 403 });
  }

  await connectToDatabase();

  const config = await LaborRuleConfig.findOneAndUpdate(
    { key: LABOR_RULE_CONFIG_KEY },
    {
      $setOnInsert: DEFAULT_LABOR_RULE_CONFIG,
      $unset: {
        mandatoryWeeklyRestDays: "",
        holidayWorkedMultiplier: "",
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  ).lean();

  return NextResponse.json({
    rules: serializeLaborRuleConfig(config),
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
    const payload = normalizeLaborRuleConfigPayload(body);
    const config = await LaborRuleConfig.findOneAndUpdate(
      { key: LABOR_RULE_CONFIG_KEY },
      {
        $set: payload,
        $unset: {
          mandatoryWeeklyRestDays: "",
          holidayWorkedMultiplier: "",
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    return NextResponse.json({
      message: "Reglas laborales guardadas correctamente.",
      rules: serializeLaborRuleConfig(config),
      source: "saved",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron guardar las reglas laborales." },
      { status: 400 },
    );
  }
}
