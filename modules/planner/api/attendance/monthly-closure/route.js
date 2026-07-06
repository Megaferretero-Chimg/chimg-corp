import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { calculatePayrollAdditionalRate } from "@/modules/planner/lib/payroll/rates";
import { parseMonthKey } from "@/modules/planner/lib/planning/holidays";
import { Employee } from "@/modules/company/models";
import { MonthlyAttendanceClosure } from "@/modules/planner/models";

function currentMonthKey() {
  return formatEcuadorMonthKey();
}

const MIN_MONTHLY_CLOSURE_MONTH_KEY = "2026-05";

function monthKeysFromMinimumUntilCurrent() {
  const { year: currentYear, monthIndex: currentMonthIndex } = parseMonthKey(currentMonthKey());
  const { year: minimumYear, monthIndex: minimumMonthIndex } = parseMonthKey(MIN_MONTHLY_CLOSURE_MONTH_KEY);
  const totalMonths = Math.max(0, (currentYear - minimumYear) * 12 + (currentMonthIndex - minimumMonthIndex) + 1);

  return Array.from({ length: totalMonths }, (_, index) => {
    const date = new Date(currentYear, currentMonthIndex - index, 1);
    const nextYear = date.getFullYear();
    const nextMonth = String(date.getMonth() + 1).padStart(2, "0");

    return `${nextYear}-${nextMonth}`;
  });
}

function minutesLabel(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const rest = value % 60;

  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function moneyLabel(value) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function supplementaryAmount(row = {}) {
  return ((Number(row.supplementaryMinutes) || 0) / 60) *
    calculatePayrollAdditionalRate(row.hourlyRate, SUPPLEMENTARY_SURCHARGE_MULTIPLIER);
}

function extraordinaryAmount(row = {}) {
  return ((Number(row.extraordinaryMinutes) || 0) / 60) *
    calculatePayrollAdditionalRate(row.hourlyRate, EXTRAORDINARY_SURCHARGE_MULTIPLIER);
}

function payrollLateMinutes(row = {}) {
  return Number(row.lateMinutes) || 0;
}

const SUPPLEMENTARY_SURCHARGE_MULTIPLIER = 1.5;
const EXTRAORDINARY_SURCHARGE_MULTIPLIER = 2;

function parseBooleanOption(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;

  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function parseEmployeeIdList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeClosure(closure) {
  if (!closure) return null;

  const rowDocs = closure.rows || [];
  const totals = {
    ...(closure.totals || {}),
    lateMinutes: rowDocs.reduce((total, row) => total + payrollLateMinutes(row), 0),
  };

  return {
    id: closure._id.toString(),
    monthKey: closure.monthKey,
    version: Number(closure.version) || 1,
    isLatest: closure.isLatest !== false,
    status: closure.status || "closed",
    completeBaseHours: closure.completeBaseHours !== false,
    closedBy: closure.closedBy || "admin",
    closedAt: closure.closedAt,
    totals: {
      ...totals,
      regularWorkedLabel: minutesLabel(totals.regularWorkedMinutes),
      supplementaryLabel: minutesLabel(totals.supplementaryMinutes),
      extraordinaryLabel: minutesLabel(totals.extraordinaryMinutes),
      supplementaryAmountLabel: moneyLabel(rowDocs.reduce((total, row) => total + supplementaryAmount(row), 0)),
      extraordinaryAmountLabel: moneyLabel(rowDocs.reduce((total, row) => total + extraordinaryAmount(row), 0)),
      lateLabel: minutesLabel(totals.lateMinutes),
      salaryTotalLabel: moneyLabel(totals.salaryTotal),
    },
    rows: rowDocs.map((row) => ({
      employeeId: row.employee?.toString?.() || "",
      employeeName: row.employeeName || "",
      employeeDni: row.employeeDni || "",
      branchCode: row.branchCode || "",
      branchName: row.branchName || "",
      areaCode: row.areaCode || "",
      areaName: row.areaName || "",
      roleCode: row.roleCode || "",
      roleName: row.roleName || "",
      plannedDays: Number(row.plannedDays) || 0,
      daysWithPunches: Number(row.daysWithPunches) || 0,
      missingPunchDays: Number(row.missingPunchDays) || 0,
      unplannedWorkDays: Number(row.unplannedWorkDays) || 0,
      lateDays: Number(row.lateDays) || 0,
      regularWorkedMinutes: Number(row.regularWorkedMinutes) || 0,
      regularTargetMinutes: Number(row.regularTargetMinutes) || 0,
      supplementaryMinutes: Number(row.supplementaryMinutes) || 0,
      plannedSupplementaryMinutes: Number(row.plannedSupplementaryMinutes) || 0,
      detectedSupplementaryMinutes: Number(row.detectedSupplementaryMinutes) || 0,
      extraordinaryMinutes: Number(row.extraordinaryMinutes) || 0,
      plannedExtraordinaryMinutes: Number(row.plannedExtraordinaryMinutes) || 0,
      detectedExtraordinaryMinutes: Number(row.detectedExtraordinaryMinutes) || 0,
      supplementaryAmount: supplementaryAmount(row),
      extraordinaryAmount: extraordinaryAmount(row),
      holidayExtraordinaryMinutes: Number(row.holidayExtraordinaryMinutes) || 0,
      lateMinutes: payrollLateMinutes(row),
      salaryTotal: Number(row.salaryTotal) || 0,
      baseCompletionMinutes: Number(row.baseCompletionMinutes) || 0,
      baseCompletionFromSupplementaryMinutes: Number(row.baseCompletionFromSupplementaryMinutes) || 0,
      baseCompletionFromExtraordinaryMinutes: Number(row.baseCompletionFromExtraordinaryMinutes) || 0,
      regularWorkedLabel: minutesLabel(row.regularWorkedMinutes),
      regularTargetLabel: minutesLabel(row.regularTargetMinutes),
      supplementaryLabel: minutesLabel(row.supplementaryMinutes),
      plannedSupplementaryLabel: minutesLabel(row.plannedSupplementaryMinutes),
      detectedSupplementaryLabel: minutesLabel(row.detectedSupplementaryMinutes),
      extraordinaryLabel: minutesLabel(row.extraordinaryMinutes),
      plannedExtraordinaryLabel: minutesLabel(row.plannedExtraordinaryMinutes),
      detectedExtraordinaryLabel: minutesLabel(row.detectedExtraordinaryMinutes),
      supplementaryAmountLabel: moneyLabel(supplementaryAmount(row)),
      extraordinaryAmountLabel: moneyLabel(extraordinaryAmount(row)),
      lateLabel: minutesLabel(payrollLateMinutes(row)),
      salaryTotalLabel: moneyLabel(row.salaryTotal),
      baseCompletionLabel: minutesLabel(row.baseCompletionMinutes),
    })),
  };
}

function serializePreview(snapshot) {
  return {
    completeBaseHours: snapshot.completeBaseHours !== false,
    rows: snapshot.rows.map((row) => ({
      ...row,
      regularWorkedLabel: minutesLabel(row.regularWorkedMinutes),
      regularTargetLabel: minutesLabel(row.regularTargetMinutes),
      supplementaryLabel: minutesLabel(row.supplementaryMinutes),
      plannedSupplementaryLabel: minutesLabel(row.plannedSupplementaryMinutes),
      detectedSupplementaryLabel: minutesLabel(row.detectedSupplementaryMinutes),
      extraordinaryLabel: minutesLabel(row.extraordinaryMinutes),
      plannedExtraordinaryLabel: minutesLabel(row.plannedExtraordinaryMinutes),
      detectedExtraordinaryLabel: minutesLabel(row.detectedExtraordinaryMinutes),
      supplementaryAmountLabel: moneyLabel(supplementaryAmount(row)),
      extraordinaryAmountLabel: moneyLabel(extraordinaryAmount(row)),
      lateLabel: minutesLabel(row.lateMinutes),
      salaryTotalLabel: moneyLabel(row.salaryTotal),
      baseCompletionLabel: minutesLabel(row.baseCompletionMinutes),
    })),
    totals: {
      ...snapshot.totals,
      regularWorkedLabel: minutesLabel(snapshot.totals.regularWorkedMinutes),
      regularTargetLabel: minutesLabel(snapshot.totals.regularTargetMinutes),
      supplementaryLabel: minutesLabel(snapshot.totals.supplementaryMinutes),
      plannedSupplementaryLabel: minutesLabel(snapshot.totals.plannedSupplementaryMinutes),
      detectedSupplementaryLabel: minutesLabel(snapshot.totals.detectedSupplementaryMinutes),
      extraordinaryLabel: minutesLabel(snapshot.totals.extraordinaryMinutes),
      plannedExtraordinaryLabel: minutesLabel(snapshot.totals.plannedExtraordinaryMinutes),
      detectedExtraordinaryLabel: minutesLabel(snapshot.totals.detectedExtraordinaryMinutes),
      supplementaryAmountLabel: moneyLabel(snapshot.totals.supplementaryAmount),
      extraordinaryAmountLabel: moneyLabel(snapshot.totals.extraordinaryAmount),
      lateLabel: minutesLabel(snapshot.totals.lateMinutes),
      salaryTotalLabel: moneyLabel(snapshot.totals.salaryTotal),
      baseCompletionLabel: minutesLabel(snapshot.totals.baseCompletionMinutes),
    },
  };
}

function serializeClosureMonth(monthKey, closure = null) {
  const totals = closure?.totals || {};

  return {
    monthKey,
    isClosed: Boolean(closure),
    version: closure ? Number(closure.version) || 1 : null,
    closedBy: closure?.closedBy || "",
    closedAt: closure?.closedAt || null,
    employees: Number(totals.employees) || 0,
    regularWorkedLabel: closure ? minutesLabel(totals.regularWorkedMinutes) : "--",
    regularTargetLabel: closure ? minutesLabel(totals.regularTargetMinutes) : "--",
    supplementaryLabel: closure ? minutesLabel(totals.supplementaryMinutes) : "--",
    extraordinaryLabel: closure ? minutesLabel(totals.extraordinaryMinutes) : "--",
    lateLabel: closure ? minutesLabel(totals.lateMinutes) : "--",
    salaryTotalLabel: closure ? moneyLabel(totals.salaryTotal) : "--",
  };
}

function approvedSupplementaryMinutes(days = []) {
  return days.reduce((total, day) => {
    return total + (Number(day.supplementaryMinutes) || 0);
  }, 0);
}

function approvedExtraordinaryMinutes(days = []) {
  return days.reduce((total, day) => {
    return total + (Number(day.extraordinaryMinutes) || 0);
  }, 0);
}

function holidayExtraordinaryMinutes(days = []) {
  return days.reduce((total, day) => {
    if (day.dayType !== "holiday") return total;

    return total + (Number(day.extraordinaryMinutes) || 0);
  }, 0);
}

function snapshotRows(comparisonRows) {
  return comparisonRows.map((row) => {
    const days = row.days || [];

    return {
      employeeId: row.employee.id,
      employee: row.employee.id,
      employeeName: row.employee.fullName,
      employeeDni: formatEmployeeDni(row.employee.dni),
      branchCode: row.employee.branchCode,
      branchName: row.employee.branchName,
      areaCode: row.employee.areaCode,
      areaName: row.employee.areaName,
      roleCode: row.employee.roleCode,
      roleName: row.employee.roleName,
      isActive: row.employee.isActive !== false,
      terminationDate: row.employee.terminationDate || "",
      plannedDays: row.summary.plannedDays,
      daysWithPunches: row.summary.daysWithPunches,
      missingPunchDays: row.summary.missingPunchDays,
      unplannedWorkDays: row.summary.unplannedWorkDays,
      lateDays: row.summary.lateDays,
      regularWorkedMinutes: row.summary.regularWorkedMinutes,
      regularTargetMinutes: row.summary.regularTargetMinutes,
      supplementaryMinutes: approvedSupplementaryMinutes(days),
      plannedSupplementaryMinutes: Number(row.summary.plannedSupplementaryMinutes) || 0,
      detectedSupplementaryMinutes: Number(row.summary.detectedSupplementaryMinutes) || 0,
      extraordinaryMinutes: approvedExtraordinaryMinutes(days),
      plannedExtraordinaryMinutes: Number(row.summary.plannedExtraordinaryMinutes) || 0,
      detectedExtraordinaryMinutes: Number(row.summary.detectedExtraordinaryMinutes) || 0,
      holidayExtraordinaryMinutes: holidayExtraordinaryMinutes(days),
      lateMinutes: row.summary.lateMinutes,
      salaryTotal: Number(row.summary.salaryProjected) || 0,
      salaryBase: Number(row.summary.salaryExpectedRaw ?? row.summary.salaryExpectedValue ?? row.summary.salaryExpected) || Number(row.employee.salary) || 0,
      hourlyRate: Number(row.summary.hourlyRateRaw) || 0,
      baseCompletionMinutes: 0,
      baseCompletionFromSupplementaryMinutes: 0,
      baseCompletionFromExtraordinaryMinutes: 0,
    };
  });
}

function completeBaseHoursFromAdditional(rows = [], employeeIds = null) {
  const selectedEmployeeIds = Array.isArray(employeeIds) ? new Set(employeeIds) : null;

  return rows.map((row) => {
    if (selectedEmployeeIds && !selectedEmployeeIds.has(getRowEmployeeId(row))) {
      return row;
    }

    const regularTargetMinutes = Math.max(0, Number(row.regularTargetMinutes) || 0);
    const regularWorkedMinutes = Math.max(0, Number(row.regularWorkedMinutes) || 0);
    let missingRegularMinutes = Math.max(0, regularTargetMinutes - regularWorkedMinutes);
    const fromSupplementaryMinutes = Math.min(Math.max(0, Number(row.supplementaryMinutes) || 0), missingRegularMinutes);
    missingRegularMinutes -= fromSupplementaryMinutes;
    const fromExtraordinaryMinutes = Math.min(Math.max(0, Number(row.extraordinaryMinutes) || 0), missingRegularMinutes);
    const baseCompletionMinutes = fromSupplementaryMinutes + fromExtraordinaryMinutes;
    const nextSupplementaryMinutes = Math.max(0, (Number(row.supplementaryMinutes) || 0) - fromSupplementaryMinutes);
    const nextExtraordinaryMinutes = Math.max(0, (Number(row.extraordinaryMinutes) || 0) - fromExtraordinaryMinutes);
    const nextHolidayExtraordinaryMinutes = Math.max(
      0,
      (Number(row.holidayExtraordinaryMinutes) || 0) - Math.min(Number(row.holidayExtraordinaryMinutes) || 0, fromExtraordinaryMinutes),
    );
    const salaryBase = Number(row.salaryBase) || 0;
    const hourlyRate = Number(row.hourlyRate) || 0;
    const salaryTotal = salaryBase +
      (nextSupplementaryMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, SUPPLEMENTARY_SURCHARGE_MULTIPLIER) +
      (nextExtraordinaryMinutes / 60) * calculatePayrollAdditionalRate(hourlyRate, EXTRAORDINARY_SURCHARGE_MULTIPLIER);

    return {
      ...row,
      regularWorkedMinutes: regularWorkedMinutes + baseCompletionMinutes,
      supplementaryMinutes: nextSupplementaryMinutes,
      extraordinaryMinutes: nextExtraordinaryMinutes,
      holidayExtraordinaryMinutes: nextHolidayExtraordinaryMinutes,
      salaryTotal,
      baseCompletionMinutes,
      baseCompletionFromSupplementaryMinutes: fromSupplementaryMinutes,
      baseCompletionFromExtraordinaryMinutes: fromExtraordinaryMinutes,
    };
  });
}

function sumTotals(rows) {
  return rows.reduce(
    (totals, row) => {
      totals.employees += 1;
      totals.plannedDays += row.plannedDays;
      totals.daysWithPunches += row.daysWithPunches;
      totals.missingPunchDays += row.missingPunchDays;
      totals.unplannedWorkDays += row.unplannedWorkDays;
      totals.lateDays += row.lateDays;
      totals.regularWorkedMinutes += row.regularWorkedMinutes;
      totals.regularTargetMinutes += row.regularTargetMinutes;
      totals.supplementaryMinutes += row.supplementaryMinutes;
      totals.plannedSupplementaryMinutes += row.plannedSupplementaryMinutes;
      totals.detectedSupplementaryMinutes += row.detectedSupplementaryMinutes;
      totals.extraordinaryMinutes += row.extraordinaryMinutes;
      totals.plannedExtraordinaryMinutes += row.plannedExtraordinaryMinutes;
      totals.detectedExtraordinaryMinutes += row.detectedExtraordinaryMinutes;
      totals.supplementaryAmount += supplementaryAmount(row);
      totals.extraordinaryAmount += extraordinaryAmount(row);
      totals.holidayExtraordinaryMinutes += row.holidayExtraordinaryMinutes;
      totals.lateMinutes += row.lateMinutes;
      totals.salaryTotal += row.salaryTotal;
      totals.baseCompletionMinutes += row.baseCompletionMinutes || 0;
      totals.baseCompletionFromSupplementaryMinutes += row.baseCompletionFromSupplementaryMinutes || 0;
      totals.baseCompletionFromExtraordinaryMinutes += row.baseCompletionFromExtraordinaryMinutes || 0;
      return totals;
    },
    {
      employees: 0,
      plannedDays: 0,
      daysWithPunches: 0,
      missingPunchDays: 0,
      unplannedWorkDays: 0,
      lateDays: 0,
      regularWorkedMinutes: 0,
      regularTargetMinutes: 0,
      supplementaryMinutes: 0,
      plannedSupplementaryMinutes: 0,
      detectedSupplementaryMinutes: 0,
      extraordinaryMinutes: 0,
      plannedExtraordinaryMinutes: 0,
      detectedExtraordinaryMinutes: 0,
      supplementaryAmount: 0,
      extraordinaryAmount: 0,
      holidayExtraordinaryMinutes: 0,
      lateMinutes: 0,
      salaryTotal: 0,
      baseCompletionMinutes: 0,
      baseCompletionFromSupplementaryMinutes: 0,
      baseCompletionFromExtraordinaryMinutes: 0,
    },
  );
}

function formatPayrollMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(value / 60);
  const rest = value % 60;

  return `${hours}.${String(rest).padStart(2, "0")}`;
}

function decimalHours(minutes) {
  return Math.round(((Number(minutes) || 0) / 60) * 100) / 100;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function escapeCsvCell(value) {
  const text = String(value ?? "");

  if (!/[;"\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function monthRangeFromKey(monthKey) {
  const { year, monthIndex } = parseMonthKey(monthKey);

  return {
    monthStart: new Date(year, monthIndex, 1),
    nextMonthStart: new Date(year, monthIndex + 1, 1),
  };
}

function wasEmployeeInPayrollDuringMonth(employee, monthStart) {
  if (!employee) return false;
  if ((employee.employmentRelation || "nomina") !== "nomina") return false;
  if (employee.isActive !== false) return true;
  if (!employee.terminationDate) return false;

  return new Date(employee.terminationDate) >= monthStart;
}

function getRowEmployeeId(row) {
  return row.employee?.toString?.() || row.employeeId || "";
}

function formatEmployeeDni(value) {
  return String(value || "").trim();
}

async function buildPayrollCsv(rows, monthKey) {
  const { monthStart } = monthRangeFromKey(monthKey);
  const employeeIds = [...new Set(rows.map(getRowEmployeeId).filter(Boolean))];
  const employees = employeeIds.length
    ? await Employee.find({ _id: { $in: employeeIds } }).select({
        dni: 1,
        employmentRelation: 1,
        isActive: 1,
        terminationDate: 1,
      }).lean()
    : [];
  const employeesById = new Map(employees.map((employee) => [employee._id.toString(), employee]));
  const lines = [
    ["Cedula", "HorasSuplementarias", "HorasExtraordinarias", "HorasNocturnas", "", "", ""],
    ...rows
      .slice()
      .sort((left, right) => String(left.employeeName || "").localeCompare(String(right.employeeName || ""), "es"))
      .filter((row) => wasEmployeeInPayrollDuringMonth(employeesById.get(getRowEmployeeId(row)), monthStart))
      .map((row) => {
        const employeeId = getRowEmployeeId(row);
        const employee = employeesById.get(employeeId);

        return [
          formatEmployeeDni(employee?.dni),
          formatPayrollMinutes(row.supplementaryMinutes),
          formatPayrollMinutes(row.extraordinaryMinutes),
          formatPayrollMinutes(0),
          "",
          "",
          row.employeeName || "",
        ];
      }),
  ];

  return `\uFEFF${lines.map((line) => line.map(escapeCsvCell).join(";")).join("\r\n")}\r\n`;
}

async function buildPayrollExcel(rows, monthKey) {
  const { monthStart } = monthRangeFromKey(monthKey);
  const employeeIds = [...new Set(rows.map(getRowEmployeeId).filter(Boolean))];
  const employees = employeeIds.length
    ? await Employee.find({ _id: { $in: employeeIds } }).select({
        dni: 1,
        employmentRelation: 1,
        isActive: 1,
        terminationDate: 1,
      }).lean()
    : [];
  const employeesById = new Map(employees.map((employee) => [employee._id.toString(), employee]));
  const bodyRows = rows
    .slice()
    .sort((left, right) => String(left.employeeName || "").localeCompare(String(right.employeeName || ""), "es"))
    .filter((row) => wasEmployeeInPayrollDuringMonth(employeesById.get(getRowEmployeeId(row)), monthStart))
    .map((row) => {
      const employee = employeesById.get(getRowEmployeeId(row));

      return [
        formatEmployeeDni(employee?.dni),
        formatPayrollMinutes(row.supplementaryMinutes),
        formatPayrollMinutes(row.extraordinaryMinutes),
        formatPayrollMinutes(0),
        "",
        "",
        row.employeeName || "",
      ];
    });
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Cedula", "HorasSuplementarias", "HorasExtraordinarias", "HorasNocturnas", "", "", ""],
    ...bodyRows,
  ]);

  worksheet["!cols"] = [
    { wch: 16 },
    { wch: 22 },
    { wch: 24 },
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 34 },
  ];

  bodyRows.forEach((_, index) => {
    const cellAddress = `A${index + 2}`;

    if (worksheet[cellAddress]) {
      worksheet[cellAddress].t = "s";
      worksheet[cellAddress].z = "@";
    }
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Nomina");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

async function buildDetailedExcel(rows, monthKey, closure = null) {
  const employeeIds = [...new Set(rows.map(getRowEmployeeId).filter(Boolean))];
  const employees = employeeIds.length
    ? await Employee.find({ _id: { $in: employeeIds } }).select({ dni: 1 }).lean()
    : [];
  const employeesById = new Map(employees.map((employee) => [employee._id.toString(), employee]));
  const sortedRows = rows
    .slice()
    .sort((left, right) => String(left.employeeName || "").localeCompare(String(right.employeeName || ""), "es"));
  const totals = sumTotals(sortedRows);
  const workbook = XLSX.utils.book_new();
  const summaryRows = [
    ["Cierre mensual", monthKey],
    ["Copia", closure ? `v${Number(closure.version) || 1}` : "Cálculo actual"],
    ["Fecha de cierre", closure?.closedAt ? new Date(closure.closedAt).toLocaleString("es-EC") : ""],
    [],
    ["Métrica", "Horas", "Valor"],
    ["Laborables", decimalHours(totals.regularWorkedMinutes), ""],
    ["Laborables del mes", decimalHours(totals.regularTargetMinutes), ""],
    ["Suplementarias cierre", decimalHours(totals.supplementaryMinutes), roundMoney(totals.supplementaryAmount)],
    ["Extraordinarias cierre", decimalHours(totals.extraordinaryMinutes), roundMoney(totals.extraordinaryAmount)],
    ["Atrasos", decimalHours(totals.lateMinutes), ""],
    ["Sueldos total", "", roundMoney(totals.salaryTotal)],
    ["Empleados", totals.employees, ""],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 30 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen");

  const detailRows = sortedRows.map((row) => {
    const employeeId = getRowEmployeeId(row);
    const employee = employeesById.get(employeeId);

    return {
      Empleado: row.employeeName || "",
      Cedula: formatEmployeeDni(employee?.dni),
      Sucursal: row.branchName || row.branchCode || "",
      Area: row.areaName || row.areaCode || "",
      Rol: row.roleName || row.roleCode || "",
      "Laborables mes": decimalHours(row.regularTargetMinutes),
      "Laborables trabajadas": decimalHours(row.regularWorkedMinutes),
      "Laborables completadas": decimalHours(row.baseCompletionMinutes),
      "HS planificadas": decimalHours(row.plannedSupplementaryMinutes),
      "HS registradas": decimalHours(row.detectedSupplementaryMinutes),
      "HS cierre": decimalHours(row.supplementaryMinutes),
      "HE planificadas": decimalHours(row.plannedExtraordinaryMinutes),
      "HE registradas": decimalHours(row.detectedExtraordinaryMinutes),
      "HE cierre": decimalHours(row.extraordinaryMinutes),
      "Cantidad atrasos": Number(row.lateDays) || 0,
      "Tiempo atraso": decimalHours(payrollLateMinutes(row)),
      "Sueldo base": roundMoney(row.salaryBase),
      "Valor hora": roundMoney(row.hourlyRate),
      "Sueldo suplementarias": roundMoney(supplementaryAmount(row)),
      "Sueldo extraordinarias": roundMoney(extraordinaryAmount(row)),
      "Sueldo total": roundMoney(row.salaryTotal),
    };
  });
  const detailSheet = XLSX.utils.json_to_sheet(detailRows);
  detailRows.forEach((_, index) => {
    const cellAddress = `B${index + 2}`;

    if (detailSheet[cellAddress]) {
      detailSheet[cellAddress].t = "s";
      detailSheet[cellAddress].z = "@";
    }
  });
  detailSheet["!cols"] = [
    { wch: 34 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
    ...Array.from({ length: 16 }, () => ({ wch: 16 })),
  ];
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Detalle empleados");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

async function ensureMonthlyClosureIndexes() {
  const collection = MonthlyAttendanceClosure.collection;
  const indexes = await collection.indexes();
  const legacyMonthIndex = indexes.find((index) =>
    index.name === "monthKey_1" &&
    index.unique &&
    Object.keys(index.key || {}).length === 1 &&
    index.key.monthKey === 1
  );

  if (legacyMonthIndex) {
    await collection.dropIndex(legacyMonthIndex.name);
  }

  await collection.createIndex({ monthKey: 1, version: 1 }, { unique: true, name: "monthKey_1_version_1" });
  await collection.createIndex({ monthKey: 1, isLatest: 1 }, { name: "monthKey_1_isLatest_1" });
}

async function buildComparisonSnapshot(request, monthKey, options = {}) {
  const url = new URL("/api/planner/attendance/comparison", request.url);
  url.searchParams.set("month", monthKey);

  const response = await fetch(url, {
    headers: {
      cookie: request.headers.get("cookie") || "",
    },
    cache: "no-store",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "No se pudo calcular el cierre del mes.");
  }

  const baseRows = snapshotRows(payload.rows || []);
  const rows = options.completeBaseHours !== false
    ? completeBaseHoursFromAdditional(baseRows, options.baseCompletionEmployeeIds)
    : baseRows;

  return {
    rows,
    totals: sumTotals(rows),
    completeBaseHours: options.completeBaseHours !== false,
  };
}

export async function GET(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    await ensureMonthlyClosureIndexes();

    const wantsMonthList = request.nextUrl.searchParams.get("list") === "months";

    if (wantsMonthList) {
      const closedDocs = await MonthlyAttendanceClosure.find({})
        .sort({ monthKey: -1, version: -1, closedAt: -1 })
        .lean();
      const latestByMonth = new Map();

      closedDocs.forEach((closure) => {
        if (latestByMonth.has(closure.monthKey)) return;
        latestByMonth.set(closure.monthKey, closure);
      });

      const monthKeys = [...new Set([...monthKeysFromMinimumUntilCurrent(), ...latestByMonth.keys()])]
        .filter((monthKey) => monthKey >= MIN_MONTHLY_CLOSURE_MONTH_KEY)
        .sort((left, right) => right.localeCompare(left));

      return NextResponse.json({
        months: monthKeys.map((monthKey) => serializeClosureMonth(monthKey, latestByMonth.get(monthKey) || null)),
      });
    }

    const monthKey = parseMonthKey(request.nextUrl.searchParams.get("month") || currentMonthKey()).monthKey;
    const mode = String(request.nextUrl.searchParams.get("mode") || "").trim();
    const closureId = String(request.nextUrl.searchParams.get("closureId") || "").trim();
    const wantsLive = mode === "live";
    const exportType = request.nextUrl.searchParams.get("export");
    const wantsPayrollCsv = exportType === "payroll-csv";
    const wantsPayrollExcel = exportType === "payroll-xlsx";
    const wantsDetailedExcel = exportType === "detailed-xlsx";
    const completeBaseHours = parseBooleanOption(request.nextUrl.searchParams.get("completeBaseHours"), true);
    const baseCompletionEmployeeIds = parseEmployeeIdList(request.nextUrl.searchParams.get("baseCompletionEmployeeIds"));
    const closures = await MonthlyAttendanceClosure.find({ monthKey })
      .sort({ version: -1, closedAt: -1 })
      .lean();
    const closure = closureId
      ? closures.find((item) => item._id.toString() === closureId) || null
      : closures.find((item) => item.isLatest !== false) || closures[0] || null;
    const snapshot = wantsLive || !closure
      ? await buildComparisonSnapshot(request, monthKey, {
        completeBaseHours,
        baseCompletionEmployeeIds: baseCompletionEmployeeIds.length ? baseCompletionEmployeeIds : null,
      })
      : null;

    if (wantsPayrollCsv) {
      const rows = snapshot?.rows || closure?.rows || [];
      const csv = await buildPayrollCsv(rows, monthKey);

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="cierre-mensual-${monthKey}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (wantsPayrollExcel) {
      const rows = snapshot?.rows || closure?.rows || [];
      const excel = await buildPayrollExcel(rows, monthKey);

      return new Response(excel, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="formato-nomina-${monthKey}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (wantsDetailedExcel) {
      const rows = snapshot?.rows || closure?.rows || [];
      const excel = await buildDetailedExcel(rows, monthKey, closure);

      return new Response(excel, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="cierre-mensual-detallado-${monthKey}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({
      monthKey,
      isClosed: Boolean(closure),
      mode: wantsLive ? "live" : "saved",
      closure: serializeClosure(closure),
      closures: closures.map((item) => ({
        id: item._id.toString(),
        version: Number(item.version) || 1,
        isLatest: item.isLatest !== false,
        completeBaseHours: item.completeBaseHours !== false,
        closedBy: item.closedBy || "admin",
        closedAt: item.closedAt,
      })),
      preview: snapshot ? serializePreview(snapshot) : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo cargar el cierre del mes." },
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
    await ensureMonthlyClosureIndexes();

    const body = await request.json().catch(() => ({}));
    const monthKey = parseMonthKey(body.month || currentMonthKey()).monthKey;
    const completeBaseHours = parseBooleanOption(body.completeBaseHours, true);
    const baseCompletionEmployeeIds = parseEmployeeIdList(body.baseCompletionEmployeeIds);
    const latest = await MonthlyAttendanceClosure.findOne({ monthKey })
      .sort({ version: -1, closedAt: -1 })
      .lean();
    const version = Number(latest?.version || 0) + 1;

    const snapshot = await buildComparisonSnapshot(request, monthKey, {
      completeBaseHours,
      baseCompletionEmployeeIds: baseCompletionEmployeeIds.length ? baseCompletionEmployeeIds : null,
    });
    const actor = await resolveAuditActor();
    await MonthlyAttendanceClosure.updateMany({ monthKey, isLatest: { $ne: false } }, { $set: { isLatest: false } });
    const closure = await MonthlyAttendanceClosure.create({
      monthKey,
      version,
      isLatest: true,
      completeBaseHours,
      rows: snapshot.rows,
      totals: snapshot.totals,
      closedBy: actor,
      closedAt: new Date(),
    });

    await createAuditLog({
      actor,
      action: "attendanceMonthlyClosure.create",
      entityType: "monthlyAttendanceClosure",
      entityId: closure._id.toString(),
      entityLabel: monthKey,
      route: "/api/planner/attendance/monthly-closure",
      details: {
        monthKey,
        version,
        previousVersion: Number(latest?.version) || null,
        employees: snapshot.totals.employees,
        regularWorkedMinutes: snapshot.totals.regularWorkedMinutes,
        regularTargetMinutes: snapshot.totals.regularTargetMinutes,
        plannedSupplementaryMinutes: snapshot.totals.plannedSupplementaryMinutes,
        detectedSupplementaryMinutes: snapshot.totals.detectedSupplementaryMinutes,
        supplementaryMinutes: snapshot.totals.supplementaryMinutes,
        plannedExtraordinaryMinutes: snapshot.totals.plannedExtraordinaryMinutes,
        detectedExtraordinaryMinutes: snapshot.totals.detectedExtraordinaryMinutes,
        extraordinaryMinutes: snapshot.totals.extraordinaryMinutes,
        holidayExtraordinaryMinutes: snapshot.totals.holidayExtraordinaryMinutes,
        baseCompletionMinutes: snapshot.totals.baseCompletionMinutes,
        completeBaseHours,
        baseCompletionEmployeeIds,
        lateMinutes: snapshot.totals.lateMinutes,
        salaryTotal: snapshot.totals.salaryTotal,
      },
    });

    return NextResponse.json({
      message: "Cierre mensual guardado.",
      isClosed: true,
      closure: serializeClosure(closure.toObject()),
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo guardar el cierre mensual." },
      { status: 400 },
    );
  }
}
