import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { isEmployeeDismissedInMonth } from "@/lib/employees";
import { resolveMonthlyBaseHours } from "@/lib/payroll/monthlyBaseHours";
import { parseMonthKey } from "@/lib/planning/holidays";
import Employee from "@/models/Employee";
import LaborRuleConfig from "@/models/LaborRuleConfig";
import MonthlyAttendanceClosure from "@/models/MonthlyAttendanceClosure";
import PayrollPayment from "@/models/PayrollPayment";

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function makeGroup(label = "Sin clasificar") {
  return {
    key: "",
    label: label || "Sin clasificar",
    employees: 0,
    normalCost: 0,
    supplementaryCost: 0,
    extraordinaryCost: 0,
    lateDeduction: 0,
    totalCost: 0,
    normalHours: 0,
    supplementaryHours: 0,
    extraordinaryHours: 0,
    lateHours: 0,
  };
}

function addToGroup(map, key, label, row) {
  const groupKey = key || "SIN";

  if (!map.has(groupKey)) {
    map.set(groupKey, { ...makeGroup(label), key: groupKey });
  }

  const group = map.get(groupKey);

  group.employees += 1;
  group.normalCost += row.normalCost;
  group.supplementaryCost += row.supplementaryCost;
  group.extraordinaryCost += row.extraordinaryCost;
  group.lateDeduction += row.lateDeduction;
  group.totalCost += row.totalCost;
  group.normalHours += row.normalHours;
  group.supplementaryHours += row.supplementaryHours;
  group.extraordinaryHours += row.extraordinaryHours;
  group.lateHours += row.lateHours;
}

function serializeGroup(group) {
  return {
    ...group,
    normalCost: money(group.normalCost),
    supplementaryCost: money(group.supplementaryCost),
    extraordinaryCost: money(group.extraordinaryCost),
    lateDeduction: money(group.lateDeduction),
    totalCost: money(group.totalCost),
    normalHours: money(group.normalHours),
    supplementaryHours: money(group.supplementaryHours),
    extraordinaryHours: money(group.extraordinaryHours),
    lateHours: money(group.lateHours),
  };
}

function buildOptions(rows, filters) {
  return rows.reduce(
    (result, row) => {
      if (row.branchCode) {
        result.branches.set(row.branchCode, row.branchName || row.branchCode);
      }

      if (!filters.branchCode || row.branchCode === filters.branchCode) {
        if (row.areaCode) {
          result.areas.set(row.areaCode, row.areaName || row.areaCode);
        }

        if (!filters.areaCode || row.areaCode === filters.areaCode) {
          if (row.roleCode) {
            result.roles.set(row.roleCode, row.roleName || row.roleCode);
          }
        }
      }

      return result;
    },
    { branches: new Map(), areas: new Map(), roles: new Map() },
  );
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
    const closure = await MonthlyAttendanceClosure.findOne({ monthKey, isLatest: { $ne: false } })
      .sort({ version: -1, closedAt: -1 })
      .lean();

    if (!closure) {
      return NextResponse.json(
        { error: "Primero guarda el cierre de mes de asistencia para calcular el costo ejecutado." },
        { status: 404 },
      );
    }

    const closureRows = closure.rows || [];
    const filteredRows = closureRows.filter((row) => {
      if (branchCode && row.branchCode !== branchCode) return false;
      if (areaCode && row.areaCode !== areaCode) return false;
      if (roleCode && row.roleCode !== roleCode) return false;
      return true;
    });
    const employeeIds = filteredRows.map((row) => row.employee).filter(Boolean);
    const [employees, rules, payments] = await Promise.all([
      employeeIds.length
        ? Employee.find({ _id: { $in: employeeIds } }).select({ salary: 1, isActive: 1, terminationDate: 1 }).lean()
        : [],
      LaborRuleConfig.findOne({ key: "default" }).lean(),
      employeeIds.length
        ? PayrollPayment.find({ monthKey, employee: { $in: employeeIds }, status: "paid" }).lean()
        : [],
    ]);
    const employeesById = new Map(employees.map((employee) => [employee._id.toString(), employee]));
    const paymentByEmployee = new Map(payments.map((payment) => [payment.employee?.toString?.() || "", payment]));
    const monthlyBase = await resolveMonthlyBaseHours({
      monthKey,
      year,
      monthIndex,
      dailyBaseHours: Number(rules?.dailyBaseHours) || 8,
    });
    const hourlyDivisor = monthlyBase.hourlyDivisor;
    const supplementaryMultiplier = 0.5;
    const extraordinaryMultiplier = 1;
    const rows = filteredRows.map((row) => {
      const employeeId = row.employee?.toString?.() || "";
      const employee = employeesById.get(employeeId);
      const salary = Number(employee?.salary) || 0;
      const hourlyRate = Number(row.hourlyRate) || salary / hourlyDivisor;
      const normalHours = (Number(row.regularWorkedMinutes) || 0) / 60;
      const supplementaryHours = (Number(row.supplementaryMinutes) || 0) / 60;
      const extraordinaryHours = (Number(row.extraordinaryMinutes) || 0) / 60;
      const lateHours = (Number(row.lateMinutes) || 0) / 60;
      const rowSalaryBase = Number(row.salaryBase);
      const hasClosedSalaryBase = row.salaryBase !== undefined && row.salaryBase !== null;
      const shouldUseClosedBase = isEmployeeDismissedInMonth(employee, monthKey);
      const normalCost = shouldUseClosedBase && hasClosedSalaryBase && Number.isFinite(rowSalaryBase)
        ? rowSalaryBase
        : salary;
      const supplementaryCost = supplementaryHours * hourlyRate * supplementaryMultiplier;
      const extraordinaryCost = extraordinaryHours * hourlyRate * extraordinaryMultiplier;
      const lateDeduction = lateHours * hourlyRate;
      const payment = paymentByEmployee.get(employeeId);

      return {
        employeeId,
        employeeName: row.employeeName || "",
        branchCode: row.branchCode || "",
        branchName: row.branchName || row.branchCode || "Sin sucursal",
        areaCode: row.areaCode || "",
        areaName: row.areaName || "Sin area",
        roleCode: row.roleCode || "",
        roleName: row.roleName || "Sin rol",
        isActive: employee?.isActive !== false,
        terminationDate: employee?.terminationDate ? employee.terminationDate.toISOString().slice(0, 10) : "",
        salary: money(salary),
        hourlyRate: money(hourlyRate),
        normalHours: money(normalHours),
        supplementaryHours: money(supplementaryHours),
        extraordinaryHours: money(extraordinaryHours),
        lateHours: money(lateHours),
        normalCost: money(normalCost),
        supplementaryCost: money(supplementaryCost),
        extraordinaryCost: money(extraordinaryCost),
        lateDeduction: money(lateDeduction),
        totalCost: money(normalCost + supplementaryCost + extraordinaryCost),
        payment: payment ? {
          isPaid: true,
          paymentMethod: payment.paymentMethod || "",
          amount: money(payment.amount),
          paidAt: payment.paidAt || null,
          paidBy: payment.paidBy || "",
        } : {
          isPaid: false,
        },
      };
    });
    const branchGroups = new Map();
    const areaGroups = new Map();
    const roleGroups = new Map();
    const totals = rows.reduce(
      (summary, row) => {
        summary.employees += 1;
        summary.normalCost += row.normalCost;
        summary.supplementaryCost += row.supplementaryCost;
        summary.extraordinaryCost += row.extraordinaryCost;
        summary.lateDeduction += row.lateDeduction;
        summary.totalCost += row.totalCost;
        summary.normalHours += row.normalHours;
        summary.supplementaryHours += row.supplementaryHours;
        summary.extraordinaryHours += row.extraordinaryHours;
        summary.lateHours += row.lateHours;

        addToGroup(branchGroups, row.branchCode, row.branchName, row);
        addToGroup(areaGroups, row.areaCode, row.areaName, row);
        addToGroup(roleGroups, `${row.areaCode || "SIN"}:${row.roleCode || "SIN"}`, row.roleName, row);

        return summary;
      },
      makeGroup("Total"),
    );
    const options = buildOptions(closureRows, { branchCode, areaCode });

    return NextResponse.json({
      monthKey,
      closure: {
        id: closure._id.toString(),
        version: Number(closure.version) || 1,
        closedAt: closure.closedAt,
        closedBy: closure.closedBy || "admin",
      },
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
      { error: error.message || "No se pudo calcular el costo ejecutado." },
      { status: 400 },
    );
  }
}
