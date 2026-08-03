import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import connectToDatabase from "@/lib/db/mongodb";
import { formatTime24 } from "@/lib/datetime/ecuador";
import { Employee } from "@/modules/company/models";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  applyPlannerScopeToAssignmentQuery,
  assertEmployeesInPlannerScope,
  assertWorkGroupInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import { parseMonthKey } from "@/modules/planner/lib/planning/holidays";
import {
  getMonthWeekOptions,
  getNextMonthKey,
  getPreviousMonthKey,
} from "@/modules/planner/lib/planning/scheduleAssignments";
import { APPROVED_VACATION_STATUS_QUERY } from "@/modules/planner/lib/planning/vacations";
import { PlanningWorkGroup, ScheduleAssignment, VacationRequest } from "@/modules/planner/models";

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

function mergeApprovedAssignmentsByEmployee(assignments, employees, requestedMonthKey, weekOptions, groupId) {
  const grouped = new Map();
  const employeesById = new Map(
    employees.map((employee) => [normalizeId(employee._id), employee]),
  );

  assignments.forEach((assignment) => {
    const employeeId = assignment.employee?.toString?.() || "";

    if (!employeeId) return;
    if (!grouped.has(employeeId)) grouped.set(employeeId, []);
    grouped.get(employeeId).push(assignment);
  });

  employeesById.forEach((_employee, employeeId) => {
    if (!grouped.has(employeeId)) grouped.set(employeeId, []);
  });

  return [...grouped.entries()].map(([employeeId, employeeAssignments]) => {
    const employee = employeesById.get(employeeId);
    const primaryAssignment =
      employeeAssignments.find((assignment) => assignment.monthKey === requestedMonthKey)
      || employeeAssignments[0];
    const primary = primaryAssignment || {
      employee: employee?._id,
      employeeName: employee?.fullName || "",
      branchCode: employee?.branchCode || "",
      branchName: employee?.branchName || employee?.branch || "",
      areaCode: employee?.areaCode || "",
      areaName: employee?.areaName || employee?.areaCode || "SIN AREA",
      roleCode: employee?.roleCode || "",
      roleName: employee?.roleName || "",
    };
    const approvedDaysByDate = new Map();
    const approvedWeekStartKeys = new Set();

    weekOptions.forEach((week) => {
      const weekDateKeySet = new Set(getWeekDateKeys(week.weekStartKey));

      employeeAssignments.forEach((assignment) => {
        const approvedHistory = findApprovedHistory(assignment, week.weekStartKey, groupId);

        if (approvedHistory) {
          approvedWeekStartKeys.add(week.weekStartKey);
        }

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
      approvedWeekStartKeys: [...approvedWeekStartKeys],
    };
  });
}

function buildRowsForWeek({ weekStartKey, weekDateKeys, assignments, vacationDateKeysByEmployee }) {
  const headerRow = [
    "Empleado",
    ...weekDateKeys.map((dateKey) => `${DAY_LABELS[getDayOfWeek(dateKey)]} ${dateKey.slice(8, 10)}`),
    "Dias trabajados",
  ];
  const rows = [headerRow];
  const activeTotals = new Map(weekDateKeys.map((dateKey) => [dateKey, 0]));
  let totalWorkedDays = 0;

  assignments.forEach((assignment) => {
    const employeeId = normalizeId(assignment.employee);
    const vacationDateKeys = vacationDateKeysByEmployee.get(employeeId) || new Set();
    const daysByDate = new Map((assignment.generatedDays || []).map((day) => [day.dateKey, day]));
    const weekDays = weekDateKeys.map((dateKey) => daysByDate.get(dateKey) || null);
    const isApprovedWeek = (assignment.approvedWeekStartKeys || []).includes(weekStartKey);
    const workedDays = weekDays.filter((day, index) =>
      !vacationDateKeys.has(weekDateKeys[index])
      && day
      && ["workday", "weekend_overtime"].includes(day.dayType),
    ).length;

    weekDays.forEach((day, index) => {
      if (
        !vacationDateKeys.has(weekDateKeys[index])
        && day
        && ["workday", "weekend_overtime"].includes(day.dayType)
      ) {
        activeTotals.set(weekDateKeys[index], (activeTotals.get(weekDateKeys[index]) || 0) + 1);
      }
    });
    totalWorkedDays += workedDays;

    rows.push([
      assignment.employeeName || "",
      ...weekDays.map((day, index) => {
        if (!isApprovedWeek) return "Descanso";
        if (vacationDateKeys.has(weekDateKeys[index])) return "Vacaciones";

        return formatDaySchedule(day);
      }),
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
    { wch: 42 },
    ...weekDateKeys.map(() => ({ wch: 30 })),
    { wch: 16 },
  ];
  worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(lastColumnIndex)}1` };
  worksheet["!freeze"] = { xSplit: 1, ySplit: 1 };
}

async function buildScheduleWorkbook({ monthKey, weekStartKey, branchCode, areaCode, roleCode, groupId, employeeIds = [], plannerScope }) {
  const monthKeys = [getPreviousMonthKey(monthKey), monthKey, getNextMonthKey(monthKey)];
  const query = { monthKey: { $in: monthKeys } };
  let workGroupMembersById = new Map();

  if (branchCode) query.branchCode = branchCode;
  if (areaCode) query.areaCode = areaCode;
  if (roleCode) query.roleCode = roleCode;
  if (employeeIds.length) {
    assertEmployeesInPlannerScope(employeeIds, plannerScope);
    query.employee = { $in: employeeIds };
  } else {
    applyPlannerScopeToAssignmentQuery(query, plannerScope);
  }

  if (groupId) {
    const workGroup = await PlanningWorkGroup.findById(groupId).lean();

    if (!workGroup) {
      throw new Error("El grupo de trabajo seleccionado no existe.");
    }

    const memberIds = new Set(
      (workGroup.members || []).map((member) => normalizeId(member.employee)),
    );
    workGroupMembersById = new Map(
      (workGroup.members || []).map((member) => [normalizeId(member.employee), member]),
    );
    const outOfGroupIds = employeeIds.filter((employeeId) => !memberIds.has(employeeId));

    if (outOfGroupIds.length) {
      throw new Error("Uno o más empleados ya no pertenecen al grupo de trabajo seleccionado.");
    }
  }

  const [assignments, employees] = await Promise.all([
    ScheduleAssignment.find(query)
      .sort({ areaName: 1, employeeName: 1 })
      .lean(),
    employeeIds.length
      ? Employee.find({ _id: { $in: employeeIds } }).select({
          fullName: 1,
          branchCode: 1,
          branchName: 1,
          branch: 1,
          areaCode: 1,
          areaName: 1,
          roleCode: 1,
          roleName: 1,
        }).lean()
      : [],
  ]);
  const employeeDocumentsById = new Map(
    employees.map((employee) => [normalizeId(employee._id), employee]),
  );
  const exportEmployees = employeeIds.map((employeeId) => {
    const employee = employeeDocumentsById.get(employeeId);
    const member = workGroupMembersById.get(employeeId);

    return {
      ...employee,
      _id: employee?._id || employeeId,
      fullName: employee?.fullName || member?.employeeName || "",
      areaCode: member?.areaCode || employee?.areaCode || "",
      areaName: member?.areaName || employee?.areaName || "",
      roleCode: member?.roleCode || employee?.roleCode || "",
      roleName: member?.roleName || employee?.roleName || "",
    };
  });
  const weekOptions = getMonthWeekOptions(monthKey);
  const selectedWeek = weekStartKey
    ? weekOptions.find((week) => week.weekStartKey === weekStartKey)
    : weekOptions[0];

  if (!selectedWeek) {
    throw new Error("La semana seleccionada no pertenece al mes de planificación.");
  }

  const mergedAssignments = mergeApprovedAssignmentsByEmployee(
    assignments,
    exportEmployees,
    monthKey,
    [selectedWeek],
    groupId,
  )
    .filter((assignment) => !areaCode || String(assignment.areaCode || "").trim() === areaCode)
    .sort((left, right) => String(left.employeeName || "").localeCompare(String(right.employeeName || ""), "es"));
  const workbook = XLSX.utils.book_new();

  if (!mergedAssignments.length) {
    const emptySheet = XLSX.utils.aoa_to_sheet([
      ["Programacion semanal de horarios"],
      ["Mes", monthKey],
      [],
      ["No hay horarios guardados para el alcance seleccionado."],
    ]);

    emptySheet["!cols"] = [{ wch: 34 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(workbook, emptySheet, "Sin datos");
  }

  if (mergedAssignments.length) {
    const weekDateKeys = getWeekDateKeys(selectedWeek.weekStartKey);
    const mergedEmployeeIds = mergedAssignments.map((assignment) => assignment.employee).filter(Boolean);
    const vacations = await VacationRequest.find({
      employee: { $in: mergedEmployeeIds },
      status: APPROVED_VACATION_STATUS_QUERY,
      startDateKey: { $lte: weekDateKeys.at(-1) },
      endDateKey: { $gte: weekDateKeys[0] },
    }).select({ employee: 1, startDateKey: 1, endDateKey: 1 }).lean();
    const vacationDateKeysByEmployee = new Map();

    vacations.forEach((vacation) => {
      const employeeId = normalizeId(vacation.employee);
      const dateKeys = vacationDateKeysByEmployee.get(employeeId) || new Set();

      weekDateKeys.forEach((dateKey) => {
        if (dateKey >= vacation.startDateKey && dateKey <= vacation.endDateKey) {
          dateKeys.add(dateKey);
        }
      });
      vacationDateKeysByEmployee.set(employeeId, dateKeys);
    });
    const rows = buildRowsForWeek({
      weekStartKey: selectedWeek.weekStartKey,
      weekDateKeys,
      assignments: mergedAssignments,
      vacationDateKeysByEmployee,
    });
    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    applyWorksheetLayout(worksheet, weekDateKeys);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Horario semanal");
  }

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
    const weekStartKey = String(searchParams.get("weekStartKey") || "").trim();
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

    const excel = await buildScheduleWorkbook({
      monthKey,
      weekStartKey,
      branchCode,
      areaCode,
      roleCode,
      groupId,
      employeeIds,
      plannerScope,
    });

    return new Response(excel, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="horario-semanal-${weekStartKey || monthKey}.xlsx"`,
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
