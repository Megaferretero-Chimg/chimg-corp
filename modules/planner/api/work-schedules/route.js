import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  buildDefaultWeeklySchedule,
  DAY_TYPES,
  formatWeekRangeLabel,
  normalizeWeekStartKey,
  WEEK_DAYS,
} from "@/modules/planner/lib/schedules";
import connectToDatabase from "@/lib/db/mongodb";
import { isValidTime24 } from "@/lib/datetime/ecuador";
import { Employee } from "@/modules/company/models";
import { WorkSchedule } from "@/modules/planner/models";

const DAY_TYPE_MAP = new Map(DAY_TYPES.map((item) => [item.value, item]));
let workScheduleIndexesPromise = null;

async function ensureWorkScheduleIndexes() {
  if (!workScheduleIndexesPromise) {
    workScheduleIndexesPromise = (async () => {
      await WorkSchedule.createIndexes();

      const existingIndexes = await WorkSchedule.collection.indexes();
      const hasLegacyIndex = existingIndexes.some(
        (index) => index.name === "employee_1_dayOfWeek_1",
      );

      if (hasLegacyIndex) {
        await WorkSchedule.collection.dropIndex("employee_1_dayOfWeek_1");
      }
    })().catch((error) => {
      workScheduleIndexesPromise = null;
      throw error;
    });
  }

  return workScheduleIndexesPromise;
}

function isValidTimeString(value) {
  return isValidTime24(value, { allowEmpty: true });
}

function normalizeScheduleRow(row) {
  const dayType = String(row?.dayType || "").trim();
  const typeConfig = DAY_TYPE_MAP.get(dayType);

  if (!typeConfig) {
    throw new Error("Tipo de día inválido.");
  }

  const dayOfWeek = Number(row?.dayOfWeek);
  const startTime = String(row?.startTime || "").trim();
  const endTime = String(row?.endTime || "").trim();
  const hasLunch = Boolean(row?.hasLunch);
  const lunchDurationMinutes = Number(row?.lunchDurationMinutes || 0);

  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new Error("Día de la semana inválido.");
  }

  if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
    throw new Error("Las horas deben estar entre 00:00 y 24:00.");
  }

  if (![0, 30, 60, 90].includes(lunchDurationMinutes)) {
    throw new Error("La duración del almuerzo debe ser 0, 30, 60 o 90 minutos.");
  }

  if (typeConfig.isWorkingDay && (!startTime || !endTime)) {
    throw new Error("Los días laborables o extraordinarios deben tener hora de entrada y salida.");
  }

  const normalizedHasLunch = typeConfig.isWorkingDay ? hasLunch : false;
  const normalizedLunchDuration = normalizedHasLunch ? lunchDurationMinutes : 0;

  return {
    dayOfWeek,
    dayType,
    startTime: typeConfig.isWorkingDay ? startTime : "",
    lunchDurationMinutes: normalizedLunchDuration,
    hasLunch: normalizedHasLunch,
    endTime: typeConfig.isWorkingDay ? endTime : "",
    graceMinutes: 10,
    isWorkingDay: typeConfig.isWorkingDay,
    isPaidDay: typeConfig.isPaidDay,
  };
}

export async function GET(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  const employeeId = request.nextUrl.searchParams.get("employeeId");
  const weekStartKey = normalizeWeekStartKey(request.nextUrl.searchParams.get("weekStart"));

  if (!employeeId) {
    return NextResponse.json({ error: "Debes seleccionar un empleado." }, { status: 400 });
  }

  await connectToDatabase();
  await ensureWorkScheduleIndexes();

  const employee = await Employee.findById(employeeId).lean();

  if (!employee) {
    return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
  }

  const schedules = await WorkSchedule.find({
    employee: employeeId,
    weekKey: weekStartKey,
  }).lean();
  const scheduleMap = new Map(schedules.map((item) => [item.dayOfWeek, item]));

  const rows = buildDefaultWeeklySchedule().map((baseRow) => {
    const stored = scheduleMap.get(baseRow.dayOfWeek);

        return stored
      ? {
          dayOfWeek: stored.dayOfWeek,
          label: WEEK_DAYS.find((item) => item.dayOfWeek === stored.dayOfWeek)?.label || baseRow.label,
          dayType: stored.dayType,
          startTime: stored.startTime || "",
          lunchDurationMinutes: stored.lunchDurationMinutes ?? 60,
          hasLunch: stored.hasLunch ?? true,
          endTime: stored.endTime || "",
          graceMinutes: stored.graceMinutes ?? 10,
          isWorkingDay: stored.isWorkingDay ?? true,
          isPaidDay: stored.isPaidDay ?? false,
        }
      : baseRow;
  });

  return NextResponse.json({
    rows,
    weekStart: weekStartKey,
    weekLabel: formatWeekRangeLabel(weekStartKey),
  });
}

export async function PUT(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    await ensureWorkScheduleIndexes();
    const body = await request.json();
    const employeeId = String(body?.employeeId || "").trim();
    const weekStartKey = normalizeWeekStartKey(body?.weekStart);
    const rows = Array.isArray(body?.rows) ? body.rows : [];

    if (!employeeId) {
      throw new Error("Debes seleccionar un empleado.");
    }

    if (rows.length !== 7) {
      throw new Error("Debes enviar los 7 días de la semana.");
    }

    const employee = await Employee.findById(employeeId).lean();

    if (!employee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    const normalizedRows = rows.map(normalizeScheduleRow);
    const weekStartDate = new Date(`${weekStartKey}T00:00:00`);

    await Promise.all(
      normalizedRows.map((row) =>
        WorkSchedule.findOneAndUpdate(
          { employee: employeeId, weekKey: weekStartKey, dayOfWeek: row.dayOfWeek },
          {
            employee: employeeId,
            weekStartDate,
            weekKey: weekStartKey,
            ...row,
          },
          {
            new: true,
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true,
          },
        ),
      ),
    );

    return NextResponse.json({
      success: true,
      weekStart: weekStartKey,
      weekLabel: formatWeekRangeLabel(weekStartKey),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo guardar el horario semanal." },
      { status: 400 },
    );
  }
}
