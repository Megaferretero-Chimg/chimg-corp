import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import connectToDatabase from "@/lib/db/mongodb";
import { formatTime24 } from "@/lib/datetime/ecuador";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  applyPlannerScopeToAssignmentQuery,
  assertWorkGroupInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import { parseMonthKey } from "@/modules/planner/lib/planning/holidays";
import {
  getMonthWeekOptions,
  getNextMonthKey,
  getPreviousMonthKey,
} from "@/modules/planner/lib/planning/scheduleAssignments";
import { ScheduleAssignment } from "@/modules/planner/models";

const DAY_LABELS = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];

function dateKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDayOfWeek(dateKey) {
  return new Date(`${dateKey}T12:00:00`).getDay();
}

function getWeekDateKeys(weekStartKey) {
  const start = new Date(`${weekStartKey}T12:00:00`);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12);

    return dateKeyFromDate(date);
  });
}

function cleanSheetName(value) {
  const name = String(value || "Hoja")
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return name.slice(0, 31) || "Hoja";
}

function uniqueSheetName(workbook, baseName) {
  const existing = new Set(workbook.SheetNames);
  const cleanBase = cleanSheetName(baseName);

  if (!existing.has(cleanBase)) return cleanBase;

  for (let index = 2; index < 100; index += 1) {
    const suffix = ` ${index}`;
    const candidate = cleanSheetName(`${cleanBase.slice(0, 31 - suffix.length)}${suffix}`);

    if (!existing.has(candidate)) return candidate;
  }

  return cleanSheetName(`${cleanBase.slice(0, 27)} ${Date.now().toString().slice(-3)}`);
}

function formatClockTime(value) {
  return formatTime24(value);
}

function formatHourRange(startTime, endTime) {
  const startLabel = formatClockTime(startTime);
  const endLabel = formatClockTime(endTime);

  if (!startLabel || !endLabel) return "";

  return `${startLabel} A ${endLabel}`;
}

function formatDaySchedule(day) {
  if (!day) return "";

  const note = String(day?.operationalNote || "").trim();

  if (note) return note.toUpperCase();
  if (day.dayType === "off_day") return "Descanso";
  if (day.dayType === "holiday") return "Feriado";
  if (day.dayType === "vacation") return "Vacaciones";

  if (day.lunchStartTime && day.lunchEndTime) {
    return `${formatHourRange(day.startTime, day.lunchStartTime)} ${formatHourRange(day.lunchEndTime, day.endTime)}`.trim();
  }

  return formatHourRange(day.startTime, day.endTime) || "Descanso";
}

function normalizeId(value) {
  return value?.toString?.() || String(value || "");
}

function findApprovedHistory(assignment, weekStartKey, groupId) {
  const approval = (assignment.planningApprovals || [])
    .filter((entry) =>
      entry.weekStartKey === weekStartKey
      && !entry.unlockedAt
      && (!groupId || normalizeId(entry.groupId) === groupId),
    )
    .sort((left, right) => new Date(right.approvedAt || 0) - new Date(left.approvedAt || 0))[0];

  if (!approval?.versionSavedAt) return null;

  const approvedSavedAt = new Date(approval.versionSavedAt).getTime();

  return (assignment.scheduleHistory || []).find((entry) => {
    if (entry.weekStartKey !== weekStartKey) return false;
    if (groupId && normalizeId(entry.groupId) !== groupId) return false;
    if (new Date(entry.savedAt || 0).getTime() !== approvedSavedAt) return false;

    if (approval.versionSavedByUser) {
      return entry.savedByUser === approval.versionSavedByUser;
    }

    if (approval.versionSavedBy) {
      return entry.savedBy === approval.versionSavedBy;
    }

    return true;
  }) || null;
}

function mergeApprovedAssignmentsByEmployee(assignments, requestedMonthKey, weekOptions, groupId) {
  const grouped = new Map();

  assignments.forEach((assignment) => {
    const employeeId = assignment.employee?.toString?.() || "";

    if (!employeeId) return;
    if (!grouped.has(employeeId)) grouped.set(employeeId, []);
    grouped.get(employeeId).push(assignment);
  });

  return [...grouped.values()].map((employeeAssignments) => {
    const primary =
      employeeAssignments.find((assignment) => assignment.monthKey === requestedMonthKey)
      || employeeAssignments[0];
    const approvedDaysByDate = new Map();

    weekOptions.forEach((week) => {
      const weekDateKeySet = new Set(getWeekDateKeys(week.weekStartKey));

      employeeAssignments.forEach((assignment) => {
        const approvedHistory = findApprovedHistory(assignment, week.weekStartKey, groupId);

        (approvedHistory?.generatedDays || []).forEach((day) => {
          if (weekDateKeySet.has(day?.dateKey)) {
            approvedDaysByDate.set(day.dateKey, day);
          }
        });
      });
    });

    return {
      ...primary,
      monthKey: requestedMonthKey || primary.monthKey,
      generatedDays: [...approvedDaysByDate.values()]
        .sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey))),
    };
  });
}

function buildAreaGroups(assignments, areaCodeFilter) {
  const groups = new Map();

  assignments.forEach((assignment) => {
    const areaCode = String(assignment.areaCode || "").trim();
    const areaName = String(assignment.areaName || areaCode || "SIN AREA").trim();

    if (areaCodeFilter && areaCode !== areaCodeFilter) return;

    const key = areaCode || areaName;

    if (!groups.has(key)) {
      groups.set(key, {
        areaCode,
        areaName,
        assignments: [],
      });
    }

    groups.get(key).assignments.push(assignment);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      assignments: group.assignments
        .slice()
        .sort((left, right) => String(left.employeeName || "").localeCompare(String(right.employeeName || ""), "es")),
    }))
    .sort((left, right) => String(left.areaName || "").localeCompare(String(right.areaName || ""), "es"));
}

function buildRowsForWeekArea({ weekDateKeys, areaGroup }) {
  const headerRow = [
    "Empleado",
    ...weekDateKeys.map((dateKey) => `${DAY_LABELS[getDayOfWeek(dateKey)]} ${dateKey.slice(8, 10)}`),
    "Dias trabajados",
  ];
  const rows = [headerRow];
  const activeTotals = new Map(weekDateKeys.map((dateKey) => [dateKey, 0]));
  let totalWorkedDays = 0;

  areaGroup.assignments.forEach((assignment) => {
    const daysByDate = new Map((assignment.generatedDays || []).map((day) => [day.dateKey, day]));
    const weekDays = weekDateKeys.map((dateKey) => daysByDate.get(dateKey) || null);
    const workedDays = weekDays.filter((day) =>
      day && ["workday", "weekend_overtime"].includes(day.dayType),
    ).length;

    weekDays.forEach((day, index) => {
      if (day && ["workday", "weekend_overtime"].includes(day.dayType)) {
        activeTotals.set(weekDateKeys[index], (activeTotals.get(weekDateKeys[index]) || 0) + 1);
      }
    });
    totalWorkedDays += workedDays;

    rows.push([
      assignment.employeeName || "",
      ...weekDays.map(formatDaySchedule),
      workedDays,
    ]);
  });

  rows.push([]);
  rows.push([
    "Personal activo por dia",
    ...weekDateKeys.map((dateKey) => activeTotals.get(dateKey) || 0),
    totalWorkedDays,
  ]);

  return rows;
}

function applyWorksheetLayout(worksheet, weekDateKeys) {
  const lastColumnIndex = 1 + weekDateKeys.length;

  worksheet["!cols"] = [
    { wch: 34 },
    ...weekDateKeys.map(() => ({ wch: 18 })),
    { wch: 16 },
  ];
  worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(lastColumnIndex)}1` };
  worksheet["!freeze"] = { xSplit: 1, ySplit: 1 };
}

async function buildScheduleWorkbook({ monthKey, branchCode, areaCode, roleCode, groupId, employeeIds = [], plannerScope }) {
  const monthKeys = [getPreviousMonthKey(monthKey), monthKey, getNextMonthKey(monthKey)];
  const query = { monthKey: { $in: monthKeys } };

  if (branchCode) query.branchCode = branchCode;
  if (areaCode) query.areaCode = areaCode;
  if (roleCode) query.roleCode = roleCode;
  if (employeeIds.length) query.employee = { $in: employeeIds };

  applyPlannerScopeToAssignmentQuery(query, plannerScope);

  const assignments = await ScheduleAssignment.find(query)
    .sort({ areaName: 1, employeeName: 1 })
    .lean();
  const weekOptions = getMonthWeekOptions(monthKey);
  const mergedAssignments = mergeApprovedAssignmentsByEmployee(assignments, monthKey, weekOptions, groupId);
  const areaGroups = buildAreaGroups(mergedAssignments, areaCode);
  const workbook = XLSX.utils.book_new();

  if (!areaGroups.length) {
    const emptySheet = XLSX.utils.aoa_to_sheet([
      ["Programacion semanal de horarios"],
      ["Mes", monthKey],
      [],
      ["No hay horarios guardados para el alcance seleccionado."],
    ]);

    emptySheet["!cols"] = [{ wch: 34 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(workbook, emptySheet, "Sin datos");
  }

  weekOptions.forEach((week) => {
    const weekDateKeys = getWeekDateKeys(week.weekStartKey);

    areaGroups.forEach((areaGroup) => {
      const rows = buildRowsForWeekArea({
        weekDateKeys,
        areaGroup,
      });
      const worksheet = XLSX.utils.aoa_to_sheet(rows);

      applyWorksheetLayout(worksheet, weekDateKeys);
      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        uniqueSheetName(workbook, `${week.label} ${areaGroup.areaName || areaGroup.areaCode}`),
      );
    });
  });

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export async function GET(request) {
  try {
    await connectToDatabase();
    const plannerScope = await resolvePlannerEmployeeScope();

    if (!plannerScope.isAuthenticated) {
      return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
    }

    if (!hasAccessPermission(plannerScope.user, "planner.schedules.export")) {
      return NextResponse.json({ error: "No tienes permiso para exportar la planificación." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const { monthKey } = parseMonthKey(searchParams.get("month"));
    const branchCode = String(searchParams.get("branchCode") || "").trim().toUpperCase();
    const areaCode = String(searchParams.get("areaCode") || "").trim();
    const roleCode = String(searchParams.get("roleCode") || "").trim();
    const groupId = String(searchParams.get("groupId") || "").trim();
    const employeeIds = String(searchParams.get("employeeIds") || "")
      .split(",")
      .map((employeeId) => employeeId.trim())
      .filter(Boolean);

    if (groupId) {
      assertWorkGroupInPlannerScope(groupId, plannerScope);
    }

    const excel = await buildScheduleWorkbook({ monthKey, branchCode, areaCode, roleCode, groupId, employeeIds, plannerScope });

    return new Response(excel, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="horarios-semanales-${monthKey}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo descargar el horario en Excel." },
      { status: 400 },
    );
  }
}
