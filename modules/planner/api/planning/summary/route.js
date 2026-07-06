import { NextResponse } from "next/server";

import connectToDatabase from "@/lib/db/mongodb";
import { buildEmployeeActiveInMonthQuery } from "@/modules/company/submodules/people/lib/employees";
import {
  applyPlannerScopeToAssignmentQuery,
  applyPlannerScopeToEmployeeQuery,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import {
  ECUADOR_DAILY_BASE_HOURS,
  EXTRAORDINARY_SURCHARGE_MULTIPLIER,
  SUPPLEMENTARY_SURCHARGE_MULTIPLIER,
} from "@/modules/planner/lib/payroll/laborConstants";
import { resolveMonthlyBaseHours } from "@/modules/planner/lib/payroll/monthlyBaseHours";
import { calculatePayrollHourlyRate } from "@/modules/planner/lib/payroll/rates";
import { parseMonthKey } from "@/modules/planner/lib/planning/holidays";
import { Employee } from "@/modules/company/models";
import { ScheduleAssignment } from "@/modules/planner/models";

function minutesBetween(startTime = "", endTime = "") {
  const [startHour, startMinute] = String(startTime || "").split(":").map(Number);
  const [endHour, endMinute] = String(endTime || "").split(":").map(Number);

  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) {
    return 0;
  }

  return Math.max((endHour * 60 + endMinute) - (startHour * 60 + startMinute), 0);
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function hours(minutes) {
  return money((Number(minutes) || 0) / 60);
}

function emptySummary() {
  return {
    employees: 0,
    baseSalary: 0,
    supplementaryHours: 0,
    extraordinaryHours: 0,
    supplementaryCost: 0,
    extraordinaryCost: 0,
    variableCost: 0,
    estimatedSalary: 0,
    withSchedule: 0,
  };
}

function addRowToSummary(summary, row) {
  summary.employees += 1;
  summary.baseSalary += Number(row.salary) || 0;
  summary.supplementaryHours += Number(row.supplementaryHours) || 0;
  summary.extraordinaryHours += Number(row.extraordinaryHours) || 0;
  summary.supplementaryCost += Number(row.supplementaryCost) || 0;
  summary.extraordinaryCost += Number(row.extraordinaryCost) || 0;
  summary.variableCost += Number(row.variableCost) || 0;
  summary.estimatedSalary += Number(row.estimatedSalary) || 0;
  summary.withSchedule += row.hasSchedule ? 1 : 0;
  return summary;
}

function employeeMatchesArea(employee, areaCode) {
  if (!areaCode) return true;
  if (employee.areaCode === areaCode) return true;

  return (employee.roleAssignments || []).some((assignment) => assignment.areaCode === areaCode);
}

function employeeMatchesRole(employee, roleCode) {
  if (!roleCode) return true;
  if (employee.roleCode === roleCode) return true;

  return (employee.roleAssignments || []).some((assignment) => assignment.code === roleCode);
}

function resolveEmployeeStructure(employee, { areaCode = "", roleCode = "" } = {}) {
  const assignmentMatch = (employee.roleAssignments || []).find((assignment) => {
    const matchesArea = !areaCode || assignment.areaCode === areaCode;
    const matchesRole = !roleCode || assignment.code === roleCode;

    return matchesArea && matchesRole;
  });

  if (assignmentMatch) {
    return {
      areaCode: assignmentMatch.areaCode || employee.areaCode || "",
      areaName: assignmentMatch.areaName || employee.areaName || assignmentMatch.areaCode || "Sin area",
      roleCode: assignmentMatch.code || employee.roleCode || "",
      roleName: assignmentMatch.name || employee.roleName || assignmentMatch.code || "Sin rol",
    };
  }

  return {
    areaCode: employee.areaCode || "",
    areaName: employee.areaName || "Sin area",
    roleCode: employee.roleCode || "",
    roleName: employee.roleName || "Sin rol",
  };
}

function buildOptions(employees = [], { branchCode = "", areaCode = "" } = {}) {
  return employees.reduce(
    (options, employee) => {
      if (employee.branchCode) {
        options.branches.set(employee.branchCode, employee.branchName || employee.branch || employee.branchCode);
      }

      if (!branchCode || employee.branchCode === branchCode) {
        if (employee.areaCode) {
          options.areas.set(employee.areaCode, employee.areaName || employee.areaCode);
        }

        (employee.roleAssignments || []).forEach((assignment) => {
          if (assignment.areaCode) {
            options.areas.set(assignment.areaCode, assignment.areaName || assignment.areaCode);
          }
        });
      }

      if ((!branchCode || employee.branchCode === branchCode) && employeeMatchesArea(employee, areaCode)) {
        if (employee.roleCode) {
          options.roles.set(employee.roleCode, employee.roleName || employee.roleCode);
        }

        (employee.roleAssignments || []).forEach((assignment) => {
          if (assignment.code && (!areaCode || assignment.areaCode === areaCode)) {
            options.roles.set(assignment.code, assignment.name || assignment.code);
          }
        });
      }

      return options;
    },
    { branches: new Map(), areas: new Map(), roles: new Map() },
  );
}

function serializeOptions(map) {
  return [...map.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "es"));
}

function summarizeAssignment(assignment) {
  return (assignment?.generatedDays || []).reduce(
    (summary, day) => {
      if (day.dayType === "workday") {
        summary.workdays += 1;
        summary.supplementaryMinutes += Number(day.authorizedExtraMinutes) || 0;
      }

      if (day.dayType === "weekend_overtime") {
        summary.extraordinaryDays += 1;
        summary.extraordinaryMinutes += Math.max(
          minutesBetween(day.startTime, day.endTime) - (Number(day.lunchDurationMinutes) || 0),
          0,
        );
      }

      return summary;
    },
    {
      workdays: 0,
      extraordinaryDays: 0,
      supplementaryMinutes: 0,
      extraordinaryMinutes: 0,
    },
  );
}

export async function GET(request) {
  try {
    await connectToDatabase();
    const plannerScope = await resolvePlannerEmployeeScope();

    if (!plannerScope.isAuthenticated) {
      return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const { monthKey, year, monthIndex } = parseMonthKey(searchParams.get("month"));
    const branchCode = String(searchParams.get("branchCode") || "").trim().toUpperCase();
    const areaCode = String(searchParams.get("areaCode") || "").trim();
    const roleCode = String(searchParams.get("roleCode") || "").trim();
    const monthStart = new Date(`${monthKey}-01T00:00:00.000Z`);
    const employeeQuery = buildEmployeeActiveInMonthQuery(monthStart);

    if (branchCode) {
      employeeQuery.branchCode = branchCode;
    }

    const allActiveEmployeeQuery = buildEmployeeActiveInMonthQuery(monthStart);

    applyPlannerScopeToEmployeeQuery(allActiveEmployeeQuery, plannerScope);
    applyPlannerScopeToEmployeeQuery(employeeQuery, plannerScope);

    const assignmentQuery = { monthKey };

    applyPlannerScopeToAssignmentQuery(assignmentQuery, plannerScope);

    const [allActiveEmployees, employees, assignments] = await Promise.all([
      Employee.find(allActiveEmployeeQuery)
        .select({
          fullName: 1,
          branchCode: 1,
          branchName: 1,
          branch: 1,
          areaCode: 1,
          areaName: 1,
          roleCode: 1,
          roleName: 1,
          roleAssignments: 1,
        })
        .sort({ fullName: 1 })
        .lean(),
      Employee.find(employeeQuery)
        .select({
          fullName: 1,
          dni: 1,
          salary: 1,
          branchCode: 1,
          branchName: 1,
          branch: 1,
          areaCode: 1,
          areaName: 1,
          roleCode: 1,
          roleName: 1,
          roleAssignments: 1,
        })
        .sort({ fullName: 1 })
        .lean(),
      ScheduleAssignment.find(assignmentQuery).lean(),
    ]);
    const filteredEmployees = employees.filter((employee) =>
      employeeMatchesArea(employee, areaCode) && employeeMatchesRole(employee, roleCode),
    );
    const employeeIds = new Set(filteredEmployees.map((employee) => employee._id.toString()));
    const assignmentByEmployee = new Map(
      assignments
        .filter((assignment) => employeeIds.has(assignment.employee?.toString?.() || ""))
        .map((assignment) => [assignment.employee.toString(), assignment]),
    );
    const monthlyBase = await resolveMonthlyBaseHours({
      monthKey,
      year,
      monthIndex,
      dailyBaseHours: ECUADOR_DAILY_BASE_HOURS,
    });
    const hourlyDivisor = monthlyBase.hourlyDivisor;
    const supplementaryMultiplier = SUPPLEMENTARY_SURCHARGE_MULTIPLIER;
    const extraordinaryMultiplier = EXTRAORDINARY_SURCHARGE_MULTIPLIER;
    const rows = filteredEmployees.map((employee) => {
      const employeeId = employee._id.toString();
      const assignment = assignmentByEmployee.get(employeeId);
      const scheduleSummary = summarizeAssignment(assignment);
      const salary = Number(employee.salary) || 0;
      const hourlyRate = calculatePayrollHourlyRate(salary, hourlyDivisor);
      const supplementaryHours = hours(scheduleSummary.supplementaryMinutes);
      const extraordinaryHours = hours(scheduleSummary.extraordinaryMinutes);
      const supplementaryCost = supplementaryHours * hourlyRate * supplementaryMultiplier;
      const extraordinaryCost = extraordinaryHours * hourlyRate * extraordinaryMultiplier;
      const variableCost = supplementaryCost + extraordinaryCost;
      const structure = resolveEmployeeStructure(employee, { areaCode, roleCode });

      return {
        employeeId,
        employeeName: employee.fullName || "",
        employeeDni: employee.dni || "",
        branchCode: employee.branchCode || "",
        branchName: employee.branchName || employee.branch || employee.branchCode || "Sin sucursal",
        areaCode: structure.areaCode,
        areaName: structure.areaName,
        roleCode: structure.roleCode,
        roleName: structure.roleName,
        salary: money(salary),
        supplementaryHours,
        extraordinaryHours,
        supplementaryCost: money(supplementaryCost),
        extraordinaryCost: money(extraordinaryCost),
        variableCost: money(variableCost),
        estimatedSalary: money(salary + variableCost),
        workdays: scheduleSummary.workdays,
        extraordinaryDays: scheduleSummary.extraordinaryDays,
        hasSchedule: Boolean(assignment),
        statusLabel: assignment ? "Horario planificado" : "Sueldo base",
      };
    });
    const summary = rows.reduce((totals, row) => addRowToSummary(totals, row), emptySummary());
    const options = buildOptions(allActiveEmployees, { branchCode, areaCode });

    return NextResponse.json({
      monthKey,
      rules: {
        hourlyDivisor,
        laborableDays: monthlyBase.laborableDays,
        dailyBaseHours: monthlyBase.dailyBaseHours,
      },
      summary: {
        ...summary,
        baseSalary: money(summary.baseSalary),
        supplementaryHours: money(summary.supplementaryHours),
        extraordinaryHours: money(summary.extraordinaryHours),
        supplementaryCost: money(summary.supplementaryCost),
        extraordinaryCost: money(summary.extraordinaryCost),
        variableCost: money(summary.variableCost),
        estimatedSalary: money(summary.estimatedSalary),
      },
      rows,
      options: {
        branches: serializeOptions(options.branches),
        areas: serializeOptions(options.areas),
        roles: serializeOptions(options.roles),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo cargar el resumen de planificacion." },
      { status: 400 },
    );
  }
}
