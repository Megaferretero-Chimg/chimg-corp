import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { resolveMonthlyBaseHours } from "@/lib/payroll/monthlyBaseHours";
import { parseMonthKey } from "@/lib/planning/holidays";
import Employee from "@/models/Employee";
import LaborRuleConfig from "@/models/LaborRuleConfig";
import ScheduleAssignment from "@/models/ScheduleAssignment";

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

function makeGroup(label = "Sin clasificar") {
  return {
    key: "",
    label: label || "Sin clasificar",
    employees: 0,
    baseCost: 0,
    supplementaryCost: 0,
    extraordinaryCost: 0,
    totalCost: 0,
    supplementaryHours: 0,
    extraordinaryHours: 0,
  };
}

function addToGroup(map, key, label, row) {
  const groupKey = key || "SIN";

  if (!map.has(groupKey)) {
    map.set(groupKey, { ...makeGroup(label), key: groupKey });
  }

  const group = map.get(groupKey);

  group.employees += 1;
  group.baseCost += row.baseCost;
  group.supplementaryCost += row.supplementaryCost;
  group.extraordinaryCost += row.extraordinaryCost;
  group.totalCost += row.totalCost;
  group.supplementaryHours += row.supplementaryHours;
  group.extraordinaryHours += row.extraordinaryHours;
}

function serializeGroup(group) {
  return {
    ...group,
    baseCost: money(group.baseCost),
    supplementaryCost: money(group.supplementaryCost),
    extraordinaryCost: money(group.extraordinaryCost),
    totalCost: money(group.totalCost),
    supplementaryHours: money(group.supplementaryHours),
    extraordinaryHours: money(group.extraordinaryHours),
  };
}

export async function GET(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const { searchParams } = new URL(request.url);
    const { monthKey, year, monthIndex } = parseMonthKey(searchParams.get("month"));
    const branchCode = String(searchParams.get("branchCode") || "").trim().toUpperCase();
    const areaCode = String(searchParams.get("areaCode") || "").trim();
    const roleCode = String(searchParams.get("roleCode") || "").trim();
    const query = { monthKey };

    if (branchCode) {
      query.branchCode = branchCode;
    }

    if (areaCode) {
      query.areaCode = areaCode;
    }

    if (roleCode) {
      query.roleCode = roleCode;
    }

    const [assignments, allMonthAssignments, rules] = await Promise.all([
      ScheduleAssignment.find(query).sort({ branchName: 1, areaName: 1, roleName: 1, employeeName: 1 }).lean(),
      ScheduleAssignment.find({ monthKey }).select({
        branchCode: 1,
        branchName: 1,
        areaCode: 1,
        areaName: 1,
        roleCode: 1,
        roleName: 1,
      }).lean(),
      LaborRuleConfig.findOne({ key: "default" }).lean(),
    ]);
    const employeeIds = assignments.map((assignment) => assignment.employee).filter(Boolean);
    const employees = employeeIds.length
      ? await Employee.find({ _id: { $in: employeeIds } }).select({ salary: 1, isActive: 1, terminationDate: 1 }).lean()
      : [];
    const employeesById = new Map(employees.map((employee) => [employee._id.toString(), employee]));
    const monthlyBase = await resolveMonthlyBaseHours({
      monthKey,
      year,
      monthIndex,
      dailyBaseHours: Number(rules?.dailyBaseHours) || 8,
    });
    const hourlyDivisor = monthlyBase.hourlyDivisor;
    const supplementaryMultiplier = 0.5;
    const extraordinaryMultiplier = 1;
    const rows = assignments.map((assignment) => {
      const employee = employeesById.get(assignment.employee?.toString?.() || "");
      const salary = Number(employee?.salary) || 0;
      const hourlyRate = salary / hourlyDivisor;
      const totals = (assignment.generatedDays || []).reduce(
        (accumulator, day) => {
          if (day.dayType === "workday") {
            accumulator.workdays += 1;
            accumulator.supplementaryMinutes += Number(day.authorizedExtraMinutes) || 0;
          }

          if (day.dayType === "weekend_overtime") {
            accumulator.extraordinaryDays += 1;
            accumulator.extraordinaryMinutes += Math.max(
              minutesBetween(day.startTime, day.endTime) - (Number(day.lunchDurationMinutes) || 0),
              0,
            );
          }

          if (day.dayType === "holiday") {
            accumulator.holidays += 1;
          }

          return accumulator;
        },
        {
          workdays: 0,
          holidays: 0,
          extraordinaryDays: 0,
          supplementaryMinutes: 0,
          extraordinaryMinutes: 0,
        },
      );
      const supplementaryHours = totals.supplementaryMinutes / 60;
      const extraordinaryHours = totals.extraordinaryMinutes / 60;
      const baseCost = salary;
      const supplementaryCost = supplementaryHours * hourlyRate * supplementaryMultiplier;
      const extraordinaryCost = extraordinaryHours * hourlyRate * extraordinaryMultiplier;

      return {
        employeeId: assignment.employee?.toString?.() || "",
        employeeName: assignment.employeeName || "",
        branchCode: assignment.branchCode || "",
        branchName: assignment.branchName || assignment.branchCode || "Sin sucursal",
        areaCode: assignment.areaCode || "",
        areaName: assignment.areaName || "Sin area",
        roleCode: assignment.roleCode || "",
        roleName: assignment.roleName || "Sin rol",
        isActive: employee?.isActive !== false,
        terminationDate: employee?.terminationDate ? employee.terminationDate.toISOString().slice(0, 10) : "",
        salary: money(salary),
        hourlyRate: money(hourlyRate),
        workdays: totals.workdays,
        holidays: totals.holidays,
        extraordinaryDays: totals.extraordinaryDays,
        supplementaryHours: money(supplementaryHours),
        extraordinaryHours: money(extraordinaryHours),
        baseCost: money(baseCost),
        supplementaryCost: money(supplementaryCost),
        extraordinaryCost: money(extraordinaryCost),
        totalCost: money(baseCost + supplementaryCost + extraordinaryCost),
      };
    });
    const branchGroups = new Map();
    const areaGroups = new Map();
    const roleGroups = new Map();
    const totals = rows.reduce(
      (summary, row) => {
        summary.employees += 1;
        summary.baseCost += row.baseCost;
        summary.supplementaryCost += row.supplementaryCost;
        summary.extraordinaryCost += row.extraordinaryCost;
        summary.totalCost += row.totalCost;
        summary.supplementaryHours += row.supplementaryHours;
        summary.extraordinaryHours += row.extraordinaryHours;
        summary.extraordinaryDays += row.extraordinaryDays;
        summary.workdays += row.workdays;

        addToGroup(branchGroups, row.branchCode, row.branchName, row);
        addToGroup(areaGroups, row.areaCode, row.areaName, row);
        addToGroup(roleGroups, `${row.areaCode || "SIN"}:${row.roleCode || "SIN"}`, row.roleName, row);

        return summary;
      },
      {
        employees: 0,
        baseCost: 0,
        supplementaryCost: 0,
        extraordinaryCost: 0,
        totalCost: 0,
        supplementaryHours: 0,
        extraordinaryHours: 0,
        extraordinaryDays: 0,
        workdays: 0,
      },
    );
    const options = allMonthAssignments.reduce(
      (result, row) => {
        const rowBranchCode = row.branchCode || "";
        const rowAreaCode = row.areaCode || "";
        const rowRoleCode = row.roleCode || "";

        if (rowBranchCode) {
          result.branches.set(rowBranchCode, row.branchName || rowBranchCode);
        }

        if (!branchCode || rowBranchCode === branchCode) {
          if (rowAreaCode) {
            result.areas.set(rowAreaCode, row.areaName || rowAreaCode);
          }

          if (!areaCode || rowAreaCode === areaCode) {
            if (rowRoleCode) {
              result.roles.set(rowRoleCode, row.roleName || rowRoleCode);
            }
          }
        }

        return result;
      },
      { branches: new Map(), areas: new Map(), roles: new Map() },
    );

    return NextResponse.json({
      monthKey,
      rules: {
        hourlyDivisor,
        laborableDays: monthlyBase.laborableDays,
        dailyBaseHours: monthlyBase.dailyBaseHours,
        holidayDateKeys: monthlyBase.holidayDateKeys,
        supplementaryMultiplier,
        extraordinaryMultiplier,
      },
      summary: serializeGroup(totals),
      groups: {
        branches: [...branchGroups.values()].map(serializeGroup),
        areas: [...areaGroups.values()].map(serializeGroup),
        roles: [...roleGroups.values()].map(serializeGroup),
      },
      rows,
      options: {
        branches: [...options.branches.entries()]
          .map(([code, name]) => ({ code, name }))
          .sort((left, right) => left.name.localeCompare(right.name, "es")),
        areas: [...options.areas.entries()]
          .map(([code, name]) => ({ code, name }))
          .sort((left, right) => left.name.localeCompare(right.name, "es")),
        roles: [...options.roles.entries()]
          .map(([code, name]) => ({ code, name }))
          .sort((left, right) => left.name.localeCompare(right.name, "es")),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo calcular el costo planificado." },
      { status: 400 },
    );
  }
}
