import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { buildEmployeeActiveInMonthQuery, isEmployeeActiveOnDate } from "@/modules/company/submodules/people/lib/employees";
import {
  applyPlannerScopeToAssignmentQuery,
  applyPlannerScopeToEmployeeQuery,
  assertEmployeesInPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import { parseMonthKey } from "@/modules/planner/lib/planning/holidays";
import {
  buildAssignmentPayload,
  buildGeneratedDays,
  getNextMonthKey,
  getMonthWeekOptions,
  getPreviousMonthKey,
  serializeScheduleAssignment,
  sortTemplatesByVariant,
} from "@/modules/planner/lib/planning/scheduleAssignments";
import { BaseScheduleTemplate } from "@/modules/planner/models";
import { Employee, Role } from "@/modules/company/models";
import { Holiday } from "@/modules/planner/models";
import { OperationalException } from "@/modules/planner/models";
import { ScheduleAssignment } from "@/modules/planner/models";

const DAY_LABELS = new Map([
  [0, "Domingo"],
  [1, "Lunes"],
  [2, "Martes"],
  [3, "Miercoles"],
  [4, "Jueves"],
  [5, "Viernes"],
  [6, "Sabado"],
]);

function getDayOfWeek(dateKey) {
  return new Date(`${dateKey}T12:00:00`).getDay();
}

function parseTimeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return null;

  const [hours, minutes] = String(value).split(":").map(Number);
  return (hours * 60) + minutes;
}

function calculateNetScheduleMinutes(row) {
  const start = parseTimeToMinutes(row?.startTime);
  const end = parseTimeToMinutes(row?.endTime);

  if (start === null || end === null || end <= start) return 0;

  return Math.max(0, end - start - (Number(row?.lunchDurationMinutes) || 0));
}

function hasScheduledTemplateRow(row) {
  return ["workday", "weekend_overtime"].includes(row?.dayType) && row?.startTime && row?.endTime;
}

function resolveTemplateOverrideDay(templateDay, template, dateKey) {
  const dayOfWeek = getDayOfWeek(dateKey);

  if (templateDay?.dayType === "holiday") return templateDay;
  if (hasScheduledTemplateRow(templateDay)) {
    const dayType = [0, 6].includes(dayOfWeek) ? "weekend_overtime" : templateDay.dayType;
    const netMinutes = calculateNetScheduleMinutes(templateDay);

    return {
      ...templateDay,
      dayType,
      authorizedExtraMinutes: dayType === "weekend_overtime" ? netMinutes : Number(templateDay.authorizedExtraMinutes) || 0,
    };
  }

  const fallbackRow = [1, 2, 3, 4, 5, 6, 0]
    .map((weekday) => (template?.weeklyRows || []).find((row) => row.dayOfWeek === weekday))
    .find(hasScheduledTemplateRow);

  if (!fallbackRow) return templateDay;

  const dayType = [0, 6].includes(dayOfWeek) ? "weekend_overtime" : fallbackRow.dayType;
  const netMinutes = calculateNetScheduleMinutes(fallbackRow);

  return {
    ...templateDay,
    dayType,
    startTime: fallbackRow.startTime || "",
    lunchDurationMinutes: Number(fallbackRow.lunchDurationMinutes) || 0,
    lunchStartTime: fallbackRow.lunchStartTime || "",
    lunchEndTime: fallbackRow.lunchEndTime || "",
    endTime: fallbackRow.endTime || "",
    authorizedExtraMinutes: dayType === "weekend_overtime" ? netMinutes : Number(fallbackRow.authorizedExtraMinutes) || 0,
  };
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function normalizeOperationalDay(day, holidayNamesByDate) {
  const dateKey = String(day?.dateKey || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }

  const dayOfWeek = getDayOfWeek(dateKey);
  const holidayName = holidayNamesByDate.get(dateKey);
  const requestedType = String(day?.dayType || "off_day").trim();
  const isWorkday = requestedType === "workday" || requestedType === "weekend_overtime";
  const isVacation = requestedType === "vacation";
  const operationalNote = String(day?.operationalNote || "").trim().toUpperCase();
  const operationalJustification = Boolean(day?.operationalJustification && operationalNote);

  if (holidayName) {
    return {
      dateKey,
      dayOfWeek,
      label: DAY_LABELS.get(dayOfWeek) || "",
      dayType: "holiday",
      startTime: "",
      lunchDurationMinutes: 0,
      lunchStartTime: "",
      lunchEndTime: "",
      endTime: "",
      authorizedExtraMinutes: 0,
      areaCode: String(day?.areaCode || "").trim(),
      areaName: String(day?.areaName || "").trim().toUpperCase(),
      roleCode: String(day?.roleCode || "").trim(),
      roleName: String(day?.roleName || "").trim().toUpperCase(),
      operationalNote,
      operationalJustification,
      source: "holiday",
    };
  }

  return {
    dateKey,
    dayOfWeek,
    label: DAY_LABELS.get(dayOfWeek) || "",
    dayType: isWorkday ? requestedType : (isVacation ? "vacation" : "off_day"),
    startTime: isWorkday ? String(day?.startTime || "").trim() : "",
    lunchDurationMinutes: isWorkday ? Math.max(0, Number(day?.lunchDurationMinutes) || 0) : 0,
    lunchStartTime: isWorkday ? String(day?.lunchStartTime || "").trim() : "",
    lunchEndTime: isWorkday ? String(day?.lunchEndTime || "").trim() : "",
    endTime: isWorkday ? String(day?.endTime || "").trim() : "",
    authorizedExtraMinutes: isWorkday ? Math.max(0, Number(day?.authorizedExtraMinutes) || 0) : 0,
    areaCode: String(day?.areaCode || "").trim(),
    areaName: String(day?.areaName || "").trim().toUpperCase(),
    roleCode: String(day?.roleCode || "").trim(),
    roleName: String(day?.roleName || "").trim().toUpperCase(),
    operationalNote,
    operationalJustification,
    source: "operational",
  };
}

function buildAutoExceptionPayload({ employee, day }) {
  const note = String(day?.operationalNote || "").trim().toUpperCase();

  if (!note || day?.operationalJustification !== true) {
    return null;
  }

  const basePayload = {
    employee: employee._id,
    employeeName: employee.fullName || "",
    employeeDni: employee.dni || "",
    branchName: employee.branchName || employee.branch || "",
    areaName: employee.areaName || "",
    roleName: day.roleName || employee.roleName || "",
    date: new Date(`${day.dateKey}T12:00:00.000Z`),
    dateKey: day.dateKey,
    endDate: null,
    endDateKey: "",
    startTime: "",
    endTime: "",
    registeredBy: "IMPORTACION HORARIOS",
    authorizedBy: "",
    resolution: "pending",
    resolutionNotes: "",
    notes: `IMPORTADO DESDE HORARIO: ${note}`,
    status: "open",
  };

  if (note === "PERMISO") {
    return {
      ...basePayload,
      type: "permission",
      scope: "full_day",
      destination: "",
      countsAsWorkedTime: false,
      allowSupplementaryTime: false,
    };
  }

  return {
    ...basePayload,
    type: "other",
    scope: "other",
    destination: note,
    countsAsWorkedTime: false,
    allowSupplementaryTime: false,
  };
}

function buildAutoExceptionSignature(payload) {
  return [
    payload.employee?.toString?.() || "",
    payload.type,
    payload.scope,
    payload.destination || "",
    payload.plannedStartTime || "",
    payload.plannedLunchStartTime || "",
    payload.plannedLunchEndTime || "",
    payload.plannedEndTime || "",
    Number(payload.plannedLunchDurationMinutes) || 0,
    payload.attendanceMode || "",
    payload.payMode || "",
    payload.countsAsWorkedTime ? "worked" : "not_worked",
    payload.allowSupplementaryTime ? "supplementary" : "regular",
    payload.notes || "",
  ].join("|");
}

function buildGroupedAutoExceptionOperations(candidates = []) {
  const groupsByEmployeeSignature = new Map();

  candidates.forEach((candidate) => {
    const payload = candidate?.payload;

    if (!payload?.employee || !payload.dateKey) return;

    const key = buildAutoExceptionSignature(payload);

    if (!groupsByEmployeeSignature.has(key)) {
      groupsByEmployeeSignature.set(key, []);
    }

    groupsByEmployeeSignature.get(key).push(payload);
  });

  const operations = [];

  groupsByEmployeeSignature.forEach((payloads) => {
    const orderedPayloads = [...payloads].sort((left, right) =>
      String(left.dateKey).localeCompare(String(right.dateKey)),
    );
    const ranges = [];

    orderedPayloads.forEach((payload) => {
      const currentRange = ranges.at(-1);

      if (!currentRange || payload.dateKey !== addDaysToDateKey(currentRange.endDateKey, 1)) {
        ranges.push({
          startPayload: payload,
          endDateKey: payload.dateKey,
        });
        return;
      }

      currentRange.endDateKey = payload.dateKey;
    });

    ranges.forEach((range) => {
      const isDateRange = range.endDateKey !== range.startPayload.dateKey;
      const payload = {
        ...range.startPayload,
        scope: isDateRange ? "date_range" : range.startPayload.scope,
        endDate: isDateRange ? new Date(`${range.endDateKey}T12:00:00.000Z`) : null,
        endDateKey: isDateRange ? range.endDateKey : "",
      };

      operations.push({
        updateOne: {
          filter: {
            employee: payload.employee,
            dateKey: payload.dateKey,
            registeredBy: "IMPORTACION HORARIOS",
            status: { $ne: "void" },
          },
          update: { $set: payload },
          upsert: true,
        },
      });
    });
  });

  return operations;
}

function employeeCanUseTemplate(employee, template) {
  const employeeRoleCode = String(employee?.roleCode || "").trim();
  const templateRoleCode = String(template?.roleCode || "").trim();

  if (!templateRoleCode) {
    return true;
  }

  if (employeeRoleCode === templateRoleCode) {
    return true;
  }

  return (employee?.roleAssignments || []).some((assignment) =>
    String(assignment?.code || "").trim() === templateRoleCode,
  );
}

function mergeAssignmentsByEmployee(assignments, requestedMonthKey) {
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
    const generatedDaysByDate = new Map();

    employeeAssignments
      .sort((left, right) => String(left.monthKey || "").localeCompare(String(right.monthKey || "")))
      .forEach((assignment) => {
        (assignment.generatedDays || []).forEach((day) => {
          if (day?.dateKey) generatedDaysByDate.set(day.dateKey, day);
        });
      });

    return {
      ...primary,
      monthKey: requestedMonthKey || primary.monthKey,
      generatedDays: [...generatedDaysByDate.values()]
        .sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey))),
    };
  });
}

function buildRoleScheduleTemplate(role, templatesById = new Map()) {
  if (role?.scheduleMode !== "fixed") return null;

  const templateId = role?.fixedScheduleTemplate?.toString?.() || String(role?.fixedScheduleTemplate || "");
  const sourceTemplate = templateId ? templatesById.get(templateId) : null;
  const snapshotRows = Array.isArray(role.fixedScheduleWeeklyRows) ? role.fixedScheduleWeeklyRows : [];
  const weeklyRows = snapshotRows.length ? snapshotRows : sourceTemplate?.weeklyRows || [];

  if (!weeklyRows.length) return null;

  return {
    ...(sourceTemplate || {}),
    _id: sourceTemplate?._id || role.fixedScheduleTemplate || undefined,
    name: role.fixedScheduleTemplateName || sourceTemplate?.name || "HORARIO COPIADO",
    areaCode: role.areaCode || role.fixedScheduleAreaCode || sourceTemplate?.areaCode || "",
    areaName: role.areaName || role.fixedScheduleAreaName || sourceTemplate?.areaName || "",
    roleCode: role.fixedScheduleRoleCode || sourceTemplate?.roleCode || role.code || "",
    roleName: role.fixedScheduleRoleName || sourceTemplate?.roleName || role.name || "",
    rotationGroup: role.fixedScheduleRotationGroup || sourceTemplate?.rotationGroup || "",
    weeklyRows,
  };
}

function buildFixedRoleAssignments({ employees = [], rolesByCode = new Map(), templatesById = new Map(), monthKeys = [], holidays = [] }) {
  const holidaysByMonth = new Map();
  const assignments = [];

  holidays.forEach((holiday) => {
    const key = String(holiday.dateKey || "").slice(0, 7);

    if (!holidaysByMonth.has(key)) {
      holidaysByMonth.set(key, []);
    }

    holidaysByMonth.get(key).push(holiday);
  });

  employees.forEach((employee) => {
    const role = rolesByCode.get(String(employee.roleCode || "").trim().toUpperCase());
    const template = buildRoleScheduleTemplate(role, templatesById);

    if (!template) {
      return;
    }

    monthKeys.forEach((assignmentMonthKey) => {
      assignments.push(buildAssignmentPayload({
        employee,
        template,
        monthKey: assignmentMonthKey,
        holidays: holidaysByMonth.get(assignmentMonthKey) || [],
        notes: "Horario fijo generado desde configuracion por cargo.",
      }));
    });
  });

  return assignments;
}

export async function GET(request) {
  try {
    await connectToDatabase();
    const plannerScope = await resolvePlannerEmployeeScope();

    if (!plannerScope.isAuthenticated) {
      return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const { monthKey } = parseMonthKey(searchParams.get("month"));
    const branchCode = String(searchParams.get("branchCode") || "").trim().toUpperCase();
    const areaCode = String(searchParams.get("areaCode") || "").trim();
    const roleCode = String(searchParams.get("roleCode") || "").trim();
    const employeeId = String(searchParams.get("employeeId") || "").trim();
    const monthKeys = [getPreviousMonthKey(monthKey), monthKey, getNextMonthKey(monthKey)];
    const query = { monthKey: { $in: monthKeys } };

    if (branchCode) {
      query.branchCode = branchCode;
    }

    if (areaCode) {
      query.areaCode = areaCode;
    }

    if (roleCode) {
      query.roleCode = roleCode;
    }

    if (employeeId) {
      assertEmployeesInPlannerScope([employeeId], plannerScope);
      query.employee = employeeId;
    }

    if (!employeeId) {
      applyPlannerScopeToAssignmentQuery(query, plannerScope);
    }

    const [assignments, roles] = await Promise.all([
      ScheduleAssignment.find(query)
        .sort({ employeeName: 1 })
        .lean(),
      Role.find({}).lean(),
    ]);
    const rolesByCode = new Map(
      roles.map((role) => [String(role.code || "").trim().toUpperCase(), role]),
    );
    const fixedTemplateIds = [
      ...new Set(
        roles
          .filter((role) => role.scheduleMode === "fixed" && role.fixedScheduleTemplate)
          .map((role) => role.fixedScheduleTemplate.toString()),
      ),
    ];
    const fixedEmployeeQuery = buildEmployeeActiveInMonthQuery(monthKey);

    if (branchCode) {
      fixedEmployeeQuery.branchCode = branchCode;
    }

    if (areaCode) {
      fixedEmployeeQuery.areaCode = areaCode;
    }

    if (roleCode) {
      fixedEmployeeQuery.roleCode = roleCode;
    }

    if (employeeId) {
      fixedEmployeeQuery._id = employeeId;
    }

    if (!employeeId) {
      applyPlannerScopeToEmployeeQuery(fixedEmployeeQuery, plannerScope);
    }

    const [fixedEmployees, fixedTemplates, fixedHolidays] = await Promise.all([
      Employee.find(fixedEmployeeQuery).lean(),
      fixedTemplateIds.length
        ? BaseScheduleTemplate.find({ _id: { $in: fixedTemplateIds }, isActive: { $ne: false } }).lean()
        : [],
      Holiday.find({ dateKey: { $regex: `^(${monthKeys.join("|")})` } }).lean(),
    ]);
    const templatesById = new Map(fixedTemplates.map((template) => [template._id.toString(), template]));
    const manualAssignmentKeys = new Set(
      assignments.map((assignment) => `${assignment.employee?.toString?.() || ""}|${assignment.monthKey}`),
    );
    const fixedAssignments = buildFixedRoleAssignments({
      employees: fixedEmployees,
      rolesByCode,
      templatesById,
      monthKeys,
      holidays: fixedHolidays,
    }).filter((assignment) => !manualAssignmentKeys.has(`${assignment.employee?.toString?.() || ""}|${assignment.monthKey}`));

    return NextResponse.json({
      assignments: mergeAssignmentsByEmployee([...fixedAssignments, ...assignments], monthKey)
        .map(serializeScheduleAssignment),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron cargar las asignaciones." },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  try {
    await connectToDatabase();
    const plannerScope = await resolvePlannerEmployeeScope();

    if (!plannerScope.isAuthenticated) {
      return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
    }

    const body = await request.json();
    const { monthKey } = parseMonthKey(body?.monthKey);
    const action = String(body?.action || "").trim();

    if (action === "update-day-schedule") {
      const employeeId = String(body?.employeeId || "").trim();
      const templateId = String(body?.templateId || "").trim();
      const dateKey = String(body?.dateKey || "").trim();

      if (!employeeId || !templateId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        throw new Error("Debes seleccionar empleado, fecha y plantilla.");
      }

      if (dateKey.slice(0, 7) !== monthKey) {
        throw new Error("La fecha seleccionada no pertenece al mes del reporte.");
      }

      assertEmployeesInPlannerScope([employeeId], plannerScope);

      const [employee, template, holidays, currentAssignment] = await Promise.all([
        Employee.findById(employeeId).lean(),
        BaseScheduleTemplate.findById(templateId).lean(),
        Holiday.find({ dateKey: { $regex: `^${monthKey}-` } }).lean(),
        ScheduleAssignment.findOne({ monthKey, employee: employeeId }).lean(),
      ]);

      if (!employee) {
        throw new Error("El empleado seleccionado no existe.");
      }

      if (!template || template.isActive === false) {
        throw new Error("La plantilla seleccionada no existe o esta inactiva.");
      }

      if (!employeeCanUseTemplate(employee, template)) {
        throw new Error("La plantilla seleccionada no corresponde al area o rol del empleado.");
      }

      const generatedTemplateDay = buildGeneratedDays(monthKey, template, holidays)
        .find((day) => day.dateKey === dateKey);
      const templateDay = resolveTemplateOverrideDay(generatedTemplateDay, template, dateKey);

      if (!templateDay) {
        throw new Error("No se pudo generar el horario para la fecha seleccionada.");
      }

      const dayOverride = {
        ...templateDay,
        template: template._id,
        templateName: template.name || "",
        areaCode: employee.areaCode || template.areaCode || "",
        areaName: employee.areaName || template.areaName || "",
        roleCode: template.roleCode || employee.roleCode || "",
        roleName: template.roleName || employee.roleName || "",
        source: templateDay.source === "holiday" ? "holiday" : "manual_override",
      };
      const existingDaysByDate = new Map(
        (currentAssignment?.generatedDays || []).map((day) => [day.dateKey, day]),
      );

      existingDaysByDate.set(dateKey, dayOverride);

      const generatedDays = [...existingDaysByDate.values()]
        .filter((day) => String(day.dateKey || "").startsWith(`${monthKey}-`))
        .sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey)));

      const assignment = await ScheduleAssignment.findOneAndUpdate(
        { monthKey, employee: employee._id },
        {
          $set: {
            monthKey,
            employee: employee._id,
            employeeName: employee.fullName || "",
            employeeDni: employee.dni || "",
            branchCode: employee.branchCode || "",
            branchName: employee.branchName || employee.branch || "",
            areaCode: employee.areaCode || "",
            areaName: employee.areaName || "",
            roleCode: employee.roleCode || "",
            roleName: employee.roleName || "",
            template: currentAssignment?.template || null,
            templateName: currentAssignment?.templateName || "AJUSTES DESDE REPORTE",
            rotationGroup: currentAssignment?.rotationGroup || "",
            generatedDays,
            weeklyPlan: currentAssignment?.weeklyPlan || [],
            notes: currentAssignment?.notes || "Ajustes puntuales registrados desde reporte de asistencia.",
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();

      return NextResponse.json({
        message: "Horario planificado actualizado correctamente.",
        assignment: serializeScheduleAssignment(assignment),
      });
    }

    if (action === "operational-save") {
      const employeeDays = Array.isArray(body?.employeeDays) ? body.employeeDays : [];
      const weekStartKey = String(body?.weekStartKey || "").trim();
      const employeeIds = employeeDays
        .map((entry) => String(entry?.employeeId || "").trim())
        .filter(Boolean);
      assertEmployeesInPlannerScope(employeeIds, plannerScope);
      const user = await getAuthenticatedUser();
      const savedBy = String(user?.employeeName || user?.username || user?.id || "SISTEMA").trim();
      const savedByUser = String(user?.id || user?.username || "").trim();

      const clearScheduleTargets = Array.isArray(body?.clearScheduleTargets) ? body.clearScheduleTargets : [];
      const clearScheduleTargetKeys = new Set(clearScheduleTargets
        .map((target) => `${String(target?.employeeId || "").trim()}|${String(target?.dateKey || "").trim()}`)
        .filter((key) => /\|(\d{4}-\d{2}-\d{2})$/.test(key)));
      const submittedDateKeys = employeeDays.flatMap((entry) =>
        (Array.isArray(entry?.days) ? entry.days : [])
          .map((day) => String(day?.dateKey || "").trim())
          .filter((dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey)),
      );
      const targetMonthKeys = [...new Set([monthKey, ...submittedDateKeys.map((dateKey) => dateKey.slice(0, 7))])];
      const employeeQuery = { _id: { $in: employeeIds } };

      applyPlannerScopeToEmployeeQuery(employeeQuery, plannerScope);

      const [employees, holidays, currentAssignments] = await Promise.all([
        Employee.find(employeeQuery).lean(),
        Holiday.find({ dateKey: { $in: submittedDateKeys } }).lean(),
        ScheduleAssignment.find({ monthKey: { $in: targetMonthKeys }, employee: { $in: employeeIds } }).lean(),
      ]);
      const employeesById = new Map(employees.map((employee) => [employee._id.toString(), employee]));
      const currentByEmployee = new Map(
        currentAssignments.map((assignment) => [
          `${assignment.monthKey}|${assignment.employee?.toString?.() || ""}`,
          assignment,
        ]),
      );
      const holidayNamesByDate = new Map(holidays.map((holiday) => [holiday.dateKey, holiday.name]));
      const operations = [];
      const exceptionOperations = [];
      const autoExceptionCandidates = [];
      const exceptionCleanupKeys = new Set();
      const savedEmployeeIds = new Set();

      employeeDays.forEach((entry) => {
        const employeeId = String(entry?.employeeId || "").trim();
        const employee = employeesById.get(employeeId);

        if (!employee) {
          return;
        }

        const daysByMonth = new Map();

        (Array.isArray(entry?.days) ? entry.days : []).forEach((day) => {
          const normalized = normalizeOperationalDay(day, holidayNamesByDate);

          if (normalized && isEmployeeActiveOnDate(employee, normalized.dateKey)) {
            const dayMonthKey = normalized.dateKey.slice(0, 7);
            const autoException = buildAutoExceptionPayload({ employee, day: normalized });
            const clearKey = `${employee._id.toString()}|${normalized.dateKey}`;
            const shouldReplaceScheduleDay = clearScheduleTargetKeys.has(`${employeeId}|${normalized.dateKey}`);
            const shouldClearScheduleDay = shouldReplaceScheduleDay
              && normalized.dayType === "off_day"
              && normalized.operationalJustification !== true;

            if (!daysByMonth.has(dayMonthKey)) daysByMonth.set(dayMonthKey, []);
            daysByMonth.get(dayMonthKey).push(normalized);

            if (shouldReplaceScheduleDay) {
              exceptionCleanupKeys.add(clearKey);
            }

            if (autoException) {
              autoExceptionCandidates.push({ employeeId, dateKey: normalized.dateKey, payload: autoException });
            }
          }
        });

        daysByMonth.forEach((monthDays, targetMonthKey) => {
          savedEmployeeIds.add(employeeId);
          const currentAssignment = currentByEmployee.get(`${targetMonthKey}|${employeeId}`);
          const primaryPlanningDay = monthDays.find((day) => day.areaCode || day.roleCode) || {};
          const existingDaysByDate = new Map(
            (currentAssignment?.generatedDays || []).map((day) => [day.dateKey, day]),
          );

          monthDays.forEach((day) => {
            if (
              clearScheduleTargetKeys.has(`${employeeId}|${day.dateKey}`)
              && day.dayType === "off_day"
              && day.operationalJustification !== true
            ) {
              existingDaysByDate.delete(day.dateKey);
              return;
            }

            existingDaysByDate.set(day.dateKey, day);
          });

          const generatedDays = [...existingDaysByDate.values()]
            .filter((day) => String(day.dateKey || "").startsWith(`${targetMonthKey}-`))
            .sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey)));
          const historyEntry = {
            weekStartKey,
            savedAt: new Date(),
            savedBy,
            savedByUser,
            generatedDays,
          };

          operations.push(generatedDays.length ? {
            updateOne: {
              filter: { monthKey: targetMonthKey, employee: employee._id },
              update: {
                $set: {
                  monthKey: targetMonthKey,
                  employee: employee._id,
                  employeeName: employee.fullName || "",
                  employeeDni: employee.dni || "",
                  branchCode: employee.branchCode || "",
                  branchName: employee.branchName || employee.branch || "",
                  areaCode: primaryPlanningDay.areaCode || employee.areaCode || "",
                  areaName: primaryPlanningDay.areaName || employee.areaName || "",
                  roleCode: primaryPlanningDay.roleCode || employee.roleCode || "",
                  roleName: primaryPlanningDay.roleName || employee.roleName || "",
                  template: currentAssignment?.template || null,
                  templateName: "PROGRAMACION DE HORARIOS",
                  rotationGroup: "OPERATIVO_VARIABLE",
                  generatedDays,
                  weeklyPlan: [],
                  notes: "Programacion de horarios armada sin plantillas por semana.",
                },
                $push: {
                  scheduleHistory: {
                    $each: [historyEntry],
                    $slice: -60,
                  },
                },
                $pull: {
                  planningApprovals: { weekStartKey },
                },
              },
              upsert: true,
            },
          } : {
            deleteOne: {
              filter: { monthKey: targetMonthKey, employee: employee._id },
            },
          });
        });
      });

      if (autoExceptionCandidates.length) {
        const importedExceptionDatesByEmployee = new Map();

        autoExceptionCandidates.forEach((candidate) => {
          if (!importedExceptionDatesByEmployee.has(candidate.employeeId)) {
            importedExceptionDatesByEmployee.set(candidate.employeeId, new Set());
          }

          importedExceptionDatesByEmployee.get(candidate.employeeId).add(candidate.dateKey);
        });

        importedExceptionDatesByEmployee.forEach((dateKeys, employeeIdForCleanup) => {
          const employee = employeesById.get(employeeIdForCleanup);

          if (!employee) return;

          const dateConditions = [...dateKeys].flatMap((dateKey) => [
            { dateKey },
            {
              dateKey: { $lte: dateKey },
              endDateKey: { $gte: dateKey },
            },
          ]);

          exceptionOperations.push({
            updateMany: {
              filter: {
                employee: employee._id,
                registeredBy: "IMPORTACION HORARIOS",
                status: { $ne: "void" },
                $or: dateConditions,
              },
              update: {
                $set: {
                  status: "void",
                  resolution: "no_action",
                  resolutionNotes: "Reemplazada por excepcion agrupada desde horarios.",
                },
              },
            },
          });
        });

        exceptionOperations.push(...buildGroupedAutoExceptionOperations(autoExceptionCandidates));
      }

      exceptionCleanupKeys.forEach((key) => {
        const [employeeIdForCleanup, dateKey] = key.split("|");
        const employee = employeesById.get(employeeIdForCleanup);

        if (!employee || !dateKey) return;

        exceptionOperations.unshift({
          updateMany: {
            filter: {
              employee: employee._id,
              status: { $ne: "void" },
              $or: [
                { dateKey },
                {
                  dateKey: { $lte: dateKey },
                  endDateKey: { $gte: dateKey },
                },
              ],
            },
            update: {
              $set: {
                status: "void",
                resolution: "no_action",
                resolutionNotes: "Anulada por limpieza de horarios semanal.",
              },
            },
          },
        });
      });

      if (operations.length) {
        await ScheduleAssignment.bulkWrite(operations);
      }

      if (exceptionOperations.length) {
        await OperationalException.bulkWrite(exceptionOperations);
      }

      const assignmentMonthKeys = [getPreviousMonthKey(monthKey), monthKey, getNextMonthKey(monthKey)];
      const assignmentQuery = { monthKey: { $in: assignmentMonthKeys } };

      applyPlannerScopeToAssignmentQuery(assignmentQuery, plannerScope);

      const assignments = await ScheduleAssignment.find(assignmentQuery)
        .sort({ employeeName: 1 })
        .lean();

      return NextResponse.json({
        message: `Programacion de horarios guardada para ${savedEmployeeIds.size} empleados.`,
        assignments: mergeAssignmentsByEmployee(assignments, monthKey).map(serializeScheduleAssignment),
      });
    }

    if (action === "approve-week") {
      const weekStartKey = String(body?.weekStartKey || "").trim();
      const employeeIds = (Array.isArray(body?.employeeIds) ? body.employeeIds : [])
        .map((employeeId) => String(employeeId || "").trim())
        .filter(Boolean);

      if (!weekStartKey || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartKey)) {
        throw new Error("Debes indicar la semana a aprobar.");
      }

      if (!employeeIds.length) {
        throw new Error("No hay empleados para aprobar.");
      }

      assertEmployeesInPlannerScope(employeeIds, plannerScope);

      const employeeQuery = { _id: { $in: employeeIds } };

      applyPlannerScopeToEmployeeQuery(employeeQuery, plannerScope);

      const [employees, user] = await Promise.all([
        Employee.find(employeeQuery).lean(),
        getAuthenticatedUser(),
      ]);
      const approvedBy = String(user?.employeeName || user?.username || user?.id || "SISTEMA").trim();
      const approvedByUser = String(user?.id || user?.username || "").trim();
      const approvedAt = new Date();
      const employeeObjectIds = employees.map((employee) => employee._id);

      await ScheduleAssignment.updateMany(
        { monthKey, employee: { $in: employeeObjectIds } },
        { $pull: { planningApprovals: { weekStartKey } } },
      );
      await ScheduleAssignment.updateMany(
        { monthKey, employee: { $in: employeeObjectIds } },
        {
          $push: {
            planningApprovals: {
              weekStartKey,
              approvedAt,
              approvedBy,
              approvedByUser,
            },
          },
        },
      );

      const assignmentMonthKeys = [getPreviousMonthKey(monthKey), monthKey, getNextMonthKey(monthKey)];
      const assignmentQuery = { monthKey: { $in: assignmentMonthKeys } };

      applyPlannerScopeToAssignmentQuery(assignmentQuery, plannerScope);

      const assignments = await ScheduleAssignment.find(assignmentQuery)
        .sort({ employeeName: 1 })
        .lean();

      return NextResponse.json({
        message: `Planificacion aprobada para ${employees.length} empleados.`,
        assignments: mergeAssignmentsByEmployee(assignments, monthKey).map(serializeScheduleAssignment),
      });
    }

    if (action === "generate") {
      const branchCode = String(body?.branchCode || "").trim().toUpperCase();
      const areaCode = String(body?.areaCode || "").trim();
      const roleCode = String(body?.roleCode || "").trim();
      const monthStart = new Date(`${monthKey}-01T00:00:00.000Z`);
      const employeeQuery = buildEmployeeActiveInMonthQuery(monthStart);

      if (branchCode) {
        employeeQuery.branchCode = branchCode;
      }

      if (areaCode) {
        employeeQuery.areaCode = areaCode;
      }

      if (roleCode) {
        employeeQuery.roleCode = roleCode;
      }

      applyPlannerScopeToEmployeeQuery(employeeQuery, plannerScope);

      const [employees, roles, templates, holidays, previousAssignments, currentAssignments] = await Promise.all([
        Employee.find(employeeQuery).sort({ branchName: 1, areaName: 1, roleName: 1, fullName: 1 }).lean(),
        Role.find({}).lean(),
        BaseScheduleTemplate.find({ isActive: { $ne: false } }).lean(),
        Holiday.find({ dateKey: { $regex: `^${monthKey}-` } }).lean(),
        ScheduleAssignment.find({ monthKey: getPreviousMonthKey(monthKey) }).lean(),
        ScheduleAssignment.find({ monthKey }).select({ employee: 1 }).lean(),
      ]);
      const rolesByCode = new Map(
        roles.map((role) => [String(role.code || "").trim().toUpperCase(), role]),
      );
      const variableEmployees = employees.filter((employee) =>
        rolesByCode.get(String(employee.roleCode || "").trim().toUpperCase())?.scheduleMode !== "fixed",
      );
      const weekOptions = getMonthWeekOptions(monthKey);
      const previousByEmployee = new Map(
        previousAssignments.map((assignment) => [assignment.employee?.toString?.() || "", assignment]),
      );
      const currentEmployeeIds = new Set(currentAssignments.map((assignment) => assignment.employee?.toString?.() || ""));
      const templatesByRole = templates.reduce((map, template) => {
        const roleCodeForTemplate = String(template.roleCode || "").trim();
        const key = roleCodeForTemplate || "__GLOBAL__";

        if (!map.has(key)) {
          map.set(key, []);
        }

        map.get(key).push(template);
        return map;
      }, new Map());
      const employeesByBranchRole = variableEmployees.reduce((map, employee) => {
        const key = `${employee.branchCode || ""}|${employee.areaCode || ""}|${employee.roleCode || ""}`;

        if (!map.has(key)) {
          map.set(key, []);
        }

        map.get(key).push(employee);
        return map;
      }, new Map());
      const operations = [];
      const skipped = [];

      function hashText(value) {
        return [...String(value || "")].reduce((hash, char) => hash + char.charCodeAt(0), 0);
      }

      for (const [branchRoleKey, roleEmployees] of employeesByBranchRole.entries()) {
        const [, , roleCodeForGroup = ""] = branchRoleKey.split("|");
        const roleTemplates = sortTemplatesByVariant([
          ...(templatesByRole.get(roleCodeForGroup) || []),
          ...(templatesByRole.get("__GLOBAL__") || []),
        ]);

        if (!roleTemplates.length) {
          skipped.push(...roleEmployees.map((employee) => employee.fullName));
          continue;
        }

        roleEmployees.forEach((employee, employeeIndex) => {
          if (currentEmployeeIds.has(employee._id.toString())) {
            return;
          }

          const previousPlan = previousByEmployee.get(employee._id.toString())?.weeklyPlan || [];
          const previousLastTemplateId = previousPlan.at(-1)?.template?.toString?.() || "";
          const previousIndex = roleTemplates.findIndex(
            (template) => template._id.toString() === previousLastTemplateId,
          );
          const startOffset = previousIndex >= 0
            ? previousIndex + 1
            : hashText(`${monthKey}|${branchRoleKey}|${employee._id}`) + employeeIndex;
          const weeklyPlan = weekOptions.map((week, weekIndex) => ({
            ...week,
            templateDoc: roleTemplates[(startOffset + weekIndex) % roleTemplates.length],
          }));
          const payload = buildAssignmentPayload({
            employee,
            template: weeklyPlan[0]?.templateDoc,
            monthKey,
            holidays,
            weeklyPlan,
            notes: "Generado automaticamente por rotacion semanal.",
          });

          operations.push({
            updateOne: {
              filter: { monthKey, employee: employee._id },
              update: { $setOnInsert: payload },
              upsert: true,
            },
          });
        });
      }

      if (operations.length) {
        await ScheduleAssignment.bulkWrite(operations);
      }

      const assignmentQuery = { monthKey };

      if (branchCode) {
        assignmentQuery.branchCode = branchCode;
      }

      applyPlannerScopeToAssignmentQuery(assignmentQuery, plannerScope);

      const assignments = await ScheduleAssignment.find(assignmentQuery)
        .sort({ employeeName: 1 })
        .lean();

      return NextResponse.json({
        message: operations.length
          ? `Horarios generados para ${operations.length} empleados.${skipped.length ? ` ${skipped.length} sin plantilla.` : ""}`
          : `No habia empleados pendientes para generar.${skipped.length ? ` ${skipped.length} sin plantilla.` : ""}`,
        assignments: assignments.map(serializeScheduleAssignment),
        skipped,
      });
    }

    const employeeId = String(body?.employeeId || "").trim();
    const weeklyPlanInput = Array.isArray(body?.weeklyPlan) ? body.weeklyPlan : [];
    const templateId = String(body?.templateId || weeklyPlanInput[0]?.templateId || "").trim();

    if (!employeeId || !templateId) {
      throw new Error("Debes seleccionar empleado y plantilla.");
    }

    assertEmployeesInPlannerScope([employeeId], plannerScope);

    const weeklyTemplateIds = weeklyPlanInput
      .map((week) => String(week?.templateId || "").trim())
      .filter(Boolean);
    const [employee, template, holidays, weeklyTemplates] = await Promise.all([
      Employee.findById(employeeId).lean(),
      BaseScheduleTemplate.findById(templateId).lean(),
      Holiday.find({ dateKey: { $regex: `^${monthKey}-` } }).lean(),
      weeklyTemplateIds.length
        ? BaseScheduleTemplate.find({ _id: { $in: weeklyTemplateIds }, isActive: { $ne: false } }).lean()
        : [],
    ]);

    if (!employee) {
      throw new Error("El empleado seleccionado no existe.");
    }

    if (!template) {
      throw new Error("La plantilla seleccionada no existe.");
    }

    const templatesById = new Map(weeklyTemplates.map((item) => [item._id.toString(), item]));
    const weeklyPlan = weeklyPlanInput
      .map((week) => ({
        weekStartKey: String(week?.weekStartKey || "").trim(),
        label: String(week?.label || "").trim(),
        templateDoc: templatesById.get(String(week?.templateId || "").trim()),
      }))
      .filter((week) => week.weekStartKey && week.templateDoc);

    const rotationTemplates = template.rotationGroup
      ? await BaseScheduleTemplate.find({
          roleCode: template.roleCode,
          rotationGroup: template.rotationGroup,
          isActive: true,
        }).lean()
      : [template];

    const payload = buildAssignmentPayload({
      employee,
      template,
      monthKey,
      holidays,
      rotationTemplates,
      weeklyPlan,
      notes: body?.notes,
    });
    const assignment = await ScheduleAssignment.findOneAndUpdate(
      { monthKey, employee: employee._id },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();

    return NextResponse.json({
      message: "Horario asignado correctamente.",
      assignment: serializeScheduleAssignment(assignment),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo guardar la asignacion de horario." },
      { status: 400 },
    );
  }
}
