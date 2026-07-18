import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { isValidTime24 } from "@/lib/datetime/ecuador";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import { Role } from "@/modules/company/models";
import { BaseScheduleTemplate } from "@/modules/planner/models";
import { serializeRole } from "@/modules/company/submodules/organization/lib/roles";
import { serializeBaseScheduleTemplate } from "@/modules/planner/lib/planning/baseSchedules";

function normalizeMode(value) {
  return String(value || "").trim() === "fixed" ? "fixed" : "variable";
}

function parseTimeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return null;

  const [hours, minutes] = String(value).split(":").map(Number);
  return (hours * 60) + minutes;
}

function calculateLunchDurationMinutes(startTime, endTime) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);

  if (start === null || end === null || end <= start) return 0;

  return end - start;
}

function normalizeScheduleRow(row = {}) {
  const dayOfWeek = Number(row.dayOfWeek);
  const dayType = ["workday", "vacation", "holiday", "weekend_overtime", "off_day"].includes(row.dayType)
    ? row.dayType
    : "workday";
  const isWorkingDay = dayType === "workday" || dayType === "weekend_overtime";
  const hasLunch = Boolean(isWorkingDay && row.hasLunch);
  const lunchStartTime = hasLunch ? String(row.lunchStartTime || "").trim() : "";
  const lunchEndTime = hasLunch ? String(row.lunchEndTime || "").trim() : "";
  const lunchDurationMinutes = calculateLunchDurationMinutes(lunchStartTime, lunchEndTime);
  const startTime = isWorkingDay ? String(row.startTime || "").trim() : "";
  const endTime = isWorkingDay ? String(row.endTime || "").trim() : "";

  if (
    !isValidTime24(startTime, { allowEmpty: true })
    || !isValidTime24(endTime, { allowEmpty: true })
    || !isValidTime24(lunchStartTime, { allowEmpty: true })
    || !isValidTime24(lunchEndTime, { allowEmpty: true })
  ) {
    throw new Error("Las horas del horario fijo deben estar entre 00:00 y 24:00.");
  }

  return {
    dayOfWeek: Number.isFinite(dayOfWeek) ? Math.min(Math.max(Math.round(dayOfWeek), 0), 6) : 1,
    dayType,
    startTime,
    lunchDurationMinutes,
    lunchStartTime,
    lunchEndTime,
    hasLunch,
    endTime,
    authorizedExtraMinutes: Math.max(0, Number(row.authorizedExtraMinutes) || 0),
    graceMinutes: Math.max(0, Number(row.graceMinutes) || 0),
  };
}

function cloneTemplateSchedule(template) {
  return (template?.weeklyRows || []).map(normalizeScheduleRow);
}

export async function GET() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.settings.view")) {
    return NextResponse.json({ error: "No tienes permiso para ver la configuracion de planificacion." }, { status: 403 });
  }

  await connectToDatabase();

  const [roles, templates] = await Promise.all([
    Role.find({ isActive: { $ne: false } }).sort({ areaName: 1, name: 1 }).lean(),
    BaseScheduleTemplate.find({ isActive: { $ne: false } }).sort({ name: 1 }).lean(),
  ]);

  return NextResponse.json({
    roles: roles.map(serializeRole),
    templates: templates.map(serializeBaseScheduleTemplate),
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
    const roleConfigs = Array.isArray(body?.roles) ? body.roles : [];
    const roleIds = roleConfigs.map((entry) => String(entry?.id || entry?.roleId || "").trim()).filter(Boolean);
    const templateIds = roleConfigs
      .map((entry) => String(entry?.fixedScheduleTemplateId || entry?.templateId || "").trim())
      .filter(Boolean);
    const [roles, templates] = await Promise.all([
      Role.find({ _id: { $in: roleIds } }).lean(),
      templateIds.length
        ? BaseScheduleTemplate.find({ _id: { $in: templateIds }, isActive: { $ne: false } }).lean()
        : [],
    ]);
    const rolesById = new Map(roles.map((role) => [role._id.toString(), role]));
    const templatesById = new Map(templates.map((template) => [template._id.toString(), template]));
    const operations = [];

    roleConfigs.forEach((entry) => {
      const roleId = String(entry?.id || entry?.roleId || "").trim();
      const role = rolesById.get(roleId);

      if (!role) {
        return;
      }

      const scheduleMode = normalizeMode(entry?.scheduleMode);
      const templateId = String(entry?.fixedScheduleTemplateId || entry?.templateId || "").trim();
      const template = templateId ? templatesById.get(templateId) : null;
      const submittedRows = Array.isArray(entry?.fixedScheduleWeeklyRows)
        ? entry.fixedScheduleWeeklyRows.map(normalizeScheduleRow)
        : [];
      const existingRows = Array.isArray(role.fixedScheduleWeeklyRows)
        ? role.fixedScheduleWeeklyRows.map(normalizeScheduleRow)
        : [];
      const snapshotRows = submittedRows.length
        ? submittedRows
        : existingRows.length
          ? existingRows
          : template
            ? cloneTemplateSchedule(template)
            : [];
      const fixedWeekdayRows = snapshotRows.filter((row) => [1, 2, 3, 4, 5].includes(row.dayOfWeek));

      if (scheduleMode === "fixed") {
        if (!fixedWeekdayRows.some((row) => row.dayType === "workday" && row.startTime && row.endTime)) {
          throw new Error(`Define un horario fijo para ${role.name}.`);
        }

      }

      operations.push({
        updateOne: {
          filter: { _id: role._id },
          update: {
            $set: {
              scheduleMode,
              punchesAffectHours: entry.punchesAffectHours !== false,
              fixedScheduleTemplate: scheduleMode === "fixed" ? (template?._id || role.fixedScheduleTemplate || null) : null,
              fixedScheduleTemplateName: scheduleMode === "fixed"
                ? String(entry.fixedScheduleTemplateName || role.fixedScheduleTemplateName || template?.name || "HORARIO COPIADO").trim()
                : "",
              fixedScheduleTemplateSourceName: scheduleMode === "fixed"
                ? String(template?.name || role.fixedScheduleTemplateSourceName || role.fixedScheduleTemplateName || "").trim()
                : "",
              fixedScheduleAreaCode: scheduleMode === "fixed" ? role.areaCode || "" : "",
              fixedScheduleAreaName: scheduleMode === "fixed" ? role.areaName || "" : "",
              fixedScheduleRoleCode: scheduleMode === "fixed" ? template?.roleCode || role.fixedScheduleRoleCode || role.code || "" : "",
              fixedScheduleRoleName: scheduleMode === "fixed" ? template?.roleName || role.fixedScheduleRoleName || role.name || "" : "",
              fixedScheduleRotationGroup: scheduleMode === "fixed" ? template?.rotationGroup || role.fixedScheduleRotationGroup || "" : "",
              fixedScheduleWeeklyRows: scheduleMode === "fixed" ? fixedWeekdayRows : [],
            },
          },
        },
      });
    });

    if (operations.length) {
      await Role.bulkWrite(operations);
    }

    const updatedRoles = await Role.find({ isActive: { $ne: false } }).sort({ areaName: 1, name: 1 }).lean();

    return NextResponse.json({
      message: "Configuracion de horarios por cargo guardada correctamente.",
      roles: updatedRoles.map(serializeRole),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo guardar la configuracion de horarios por cargo." },
      { status: 400 },
    );
  }
}
