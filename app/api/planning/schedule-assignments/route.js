import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { buildEmployeeActiveInMonthQuery } from "@/lib/employees";
import { parseMonthKey } from "@/lib/planning/holidays";
import {
  buildAssignmentPayload,
  getNextMonthKey,
  getMonthWeekOptions,
  getPreviousMonthKey,
  serializeScheduleAssignment,
  sortTemplatesByVariant,
} from "@/lib/planning/scheduleAssignments";
import BaseScheduleTemplate from "@/models/BaseScheduleTemplate";
import Employee from "@/models/Employee";
import Holiday from "@/models/Holiday";
import OperationalException from "@/models/OperationalException";
import ScheduleAssignment from "@/models/ScheduleAssignment";

const VARIABLE_SCHEDULE_AREA_CODES = new Set(["ALM", "BOD"]);

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

  if (note === "SALCEDO") {
    return {
      ...basePayload,
      type: "outside_work",
      scope: "outside_work",
      destination: "SALCEDO",
      countsAsWorkedTime: true,
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

export async function GET(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

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
      query.employee = employeeId;
    }

    const assignments = await ScheduleAssignment.find(query)
      .sort({ employeeName: 1 })
      .lean();

    return NextResponse.json({
      assignments: mergeAssignmentsByEmployee(assignments, monthKey).map(serializeScheduleAssignment),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron cargar las asignaciones." },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const body = await request.json();
    const { monthKey } = parseMonthKey(body?.monthKey);
    const action = String(body?.action || "").trim();

    if (action === "operational-save") {
      const employeeDays = Array.isArray(body?.employeeDays) ? body.employeeDays : [];
      const employeeIds = employeeDays
        .map((entry) => String(entry?.employeeId || "").trim())
        .filter(Boolean);
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
      const [employees, holidays, currentAssignments, importedExceptions] = await Promise.all([
        Employee.find({ _id: { $in: employeeIds } }).lean(),
        Holiday.find({ dateKey: { $in: submittedDateKeys } }).lean(),
        ScheduleAssignment.find({ monthKey: { $in: targetMonthKeys }, employee: { $in: employeeIds } }).lean(),
        OperationalException.find({
          employee: { $in: employeeIds },
          dateKey: { $in: submittedDateKeys },
          registeredBy: "IMPORTACION HORARIOS",
        }).select({ employee: 1, dateKey: 1, status: 1 }).lean(),
      ]);
      const employeesById = new Map(employees.map((employee) => [employee._id.toString(), employee]));
      const reviewedImportedExceptionKeys = new Set(
        importedExceptions
          .filter((exception) => exception.status === "resolved")
          .map((exception) => `${exception.employee?.toString?.() || ""}|${exception.dateKey}`),
      );
      const currentByEmployee = new Map(
        currentAssignments.map((assignment) => [
          `${assignment.monthKey}|${assignment.employee?.toString?.() || ""}`,
          assignment,
        ]),
      );
      const holidayNamesByDate = new Map(holidays.map((holiday) => [holiday.dateKey, holiday.name]));
      const operations = [];
      const exceptionOperations = [];
      const exceptionCleanupKeys = new Set();
      const savedEmployeeIds = new Set();

      employeeDays.forEach((entry) => {
        const employeeId = String(entry?.employeeId || "").trim();
        const employee = employeesById.get(employeeId);

        if (!employee || !VARIABLE_SCHEDULE_AREA_CODES.has(String(employee.areaCode || "").toUpperCase())) {
          return;
        }

        const daysByMonth = new Map();

        (Array.isArray(entry?.days) ? entry.days : []).forEach((day) => {
          const normalized = normalizeOperationalDay(day, holidayNamesByDate);

          if (normalized) {
            const dayMonthKey = normalized.dateKey.slice(0, 7);
            const autoException = buildAutoExceptionPayload({ employee, day: normalized });
            const clearKey = `${employee._id.toString()}|${normalized.dateKey}`;
            const shouldClearScheduleDay = clearScheduleTargetKeys.has(`${employeeId}|${normalized.dateKey}`)
              && normalized.dayType === "off_day"
              && normalized.operationalJustification !== true;

            if (!daysByMonth.has(dayMonthKey)) daysByMonth.set(dayMonthKey, []);
            daysByMonth.get(dayMonthKey).push(normalized);

            if (shouldClearScheduleDay) {
              exceptionCleanupKeys.add(clearKey);
            }

            if (autoException && !reviewedImportedExceptionKeys.has(`${employee._id.toString()}|${normalized.dateKey}`)) {
              exceptionOperations.push({
                updateOne: {
                  filter: {
                    employee: employee._id,
                    dateKey: normalized.dateKey,
                    registeredBy: "IMPORTACION HORARIOS",
                    status: "open",
                  },
                  update: { $set: autoException },
                  upsert: true,
                },
              });
            }
          }
        });

        daysByMonth.forEach((monthDays, targetMonthKey) => {
          savedEmployeeIds.add(employeeId);
          const currentAssignment = currentByEmployee.get(`${targetMonthKey}|${employeeId}`);
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
                  areaCode: employee.areaCode || "",
                  areaName: employee.areaName || "",
                  roleCode: employee.roleCode || "",
                  roleName: employee.roleName || "",
                  template: currentAssignment?.template || null,
                  templateName: "PROGRAMACION DE HORARIOS",
                  rotationGroup: "OPERATIVO_VARIABLE",
                  generatedDays,
                  weeklyPlan: [],
                  notes: "Programacion de horarios armada sin plantillas por semana.",
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

      exceptionCleanupKeys.forEach((key) => {
        const [employeeIdForCleanup, dateKey] = key.split("|");
        const employee = employeesById.get(employeeIdForCleanup);

        if (!employee || !dateKey) return;

        exceptionOperations.unshift({
          deleteOne: {
            filter: {
              employee: employee._id,
              dateKey,
              registeredBy: "IMPORTACION HORARIOS",
              status: "open",
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
      const assignments = await ScheduleAssignment.find({ monthKey: { $in: assignmentMonthKeys } })
        .sort({ employeeName: 1 })
        .lean();

      return NextResponse.json({
        message: `Programacion de horarios guardada para ${savedEmployeeIds.size} empleados.`,
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
        employeeQuery.areaCode = VARIABLE_SCHEDULE_AREA_CODES.has(areaCode) ? areaCode : "__fixed_schedule_area__";
      } else {
        employeeQuery.areaCode = { $in: [...VARIABLE_SCHEDULE_AREA_CODES] };
      }

      if (roleCode) {
        employeeQuery.roleCode = roleCode;
      }

      const [employees, templates, holidays, previousAssignments, currentAssignments] = await Promise.all([
        Employee.find(employeeQuery).sort({ branchName: 1, areaName: 1, roleName: 1, fullName: 1 }).lean(),
        BaseScheduleTemplate.find({ isActive: { $ne: false } }).lean(),
        Holiday.find({ dateKey: { $regex: `^${monthKey}-` } }).lean(),
        ScheduleAssignment.find({ monthKey: getPreviousMonthKey(monthKey) }).lean(),
        ScheduleAssignment.find({ monthKey }).select({ employee: 1 }).lean(),
      ]);
      const weekOptions = getMonthWeekOptions(monthKey);
      const previousByEmployee = new Map(
        previousAssignments.map((assignment) => [assignment.employee?.toString?.() || "", assignment]),
      );
      const currentEmployeeIds = new Set(currentAssignments.map((assignment) => assignment.employee?.toString?.() || ""));
      const templatesByRole = templates.reduce((map, template) => {
        const areaCodeForTemplate = String(template.areaCode || "").trim();
        const roleCodeForTemplate = String(template.roleCode || "").trim();
        const key = roleCodeForTemplate
          ? `${areaCodeForTemplate}|${roleCodeForTemplate}`
          : `${areaCodeForTemplate}|__AREA__`;

        if (!map.has(key)) {
          map.set(key, []);
        }

        map.get(key).push(template);
        return map;
      }, new Map());
      const employeesByBranchRole = employees.reduce((map, employee) => {
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
        const [, areaCodeForGroup = "", roleCodeForGroup = ""] = branchRoleKey.split("|");
        const roleKey = `${areaCodeForGroup}|${roleCodeForGroup}`;
        const areaKey = `${areaCodeForGroup}|__AREA__`;
        const roleTemplates = sortTemplatesByVariant([
          ...(templatesByRole.get(roleKey) || []),
          ...(templatesByRole.get(areaKey) || []),
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
          areaCode: template.areaCode,
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
