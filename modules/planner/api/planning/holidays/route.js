import { endOfMonth } from "date-fns";
import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  normalizeHolidayPayload,
  parseMonthKey,
  serializeHoliday,
} from "@/modules/planner/lib/planning/holidays";
import { makeEcuadorDate } from "@/lib/datetime/ecuador";
import { Holiday } from "@/modules/planner/models";

export async function GET(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (
    !hasAccessPermission(user, "planner.holidays.view")
    && !hasAccessPermission(user, "planner.schedules.weekly.view")
  ) {
    return NextResponse.json({ error: "No tienes permiso para ver feriados." }, { status: 403 });
  }

  try {
    const { monthKey, year, monthIndex } = parseMonthKey(request.nextUrl.searchParams.get("month"));
    const monthStart = makeEcuadorDate(year, monthIndex, 1);
    const monthEndDate = endOfMonth(new Date(year, monthIndex, 1));
    const monthEnd = makeEcuadorDate(year, monthIndex, monthEndDate.getDate(), 23, 59, 59, 999);

    await connectToDatabase();

    const holidays = await Holiday.find({
      date: {
        $gte: monthStart,
        $lte: monthEnd,
      },
    })
      .sort({ dateKey: 1 })
      .lean();

    return NextResponse.json({
      month: monthKey,
      holidays: holidays.map(serializeHoliday),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron cargar los feriados." },
      { status: 400 },
    );
  }
}

export async function PUT(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.holidays.manage")) {
    return NextResponse.json({ error: "No tienes permiso para gestionar feriados." }, { status: 403 });
  }

  try {
    await connectToDatabase();

    const body = await request.json();
    const payload = normalizeHolidayPayload(body);
    const holiday = await Holiday.findOneAndUpdate(
      { dateKey: payload.dateKey },
      { $set: payload },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    return NextResponse.json({
      message: "Feriado guardado correctamente.",
      holiday: serializeHoliday(holiday),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo guardar el feriado." },
      { status: 400 },
    );
  }
}
