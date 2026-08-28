import { differenceInCalendarDays, endOfMonth, format, startOfMonth } from "date-fns";
import * as XLSX from "xlsx";

import { parseDateKey, parseMonthKey } from "@/modules/planner/lib/planning/vacations";

const EXCEL_DATE_FORMAT = "yyyy-mm-dd";

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function vacationSearchText(vacation = {}) {
  return normalizeSearch([
    vacation.employeeName,
    vacation.employeeDni,
    vacation.branchName,
    vacation.areaName,
    vacation.roleName,
  ].filter(Boolean).join(" "));
}

function dateKeyToExcelDate(dateKey) {
  return parseDateKey(dateKey).date;
}

function setDateColumnFormat(worksheet, columnIndex, firstRow, lastRow) {
  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    const cell = worksheet[XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex })];

    if (cell) cell.z = EXCEL_DATE_FORMAT;
  }
}

function setIntegerColumnFormat(worksheet, columnIndex, firstRow, lastRow) {
  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    const cell = worksheet[XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex })];

    if (cell) cell.z = "#,##0";
  }
}

export function getVacationDaysInMonth(vacation, monthKey) {
  const monthDate = parseMonthKey(monthKey);

  if (!monthDate) return 0;

  const monthStartKey = format(startOfMonth(monthDate), "yyyy-MM-dd");
  const monthEndKey = format(endOfMonth(monthDate), "yyyy-MM-dd");
  const startDateKey = String(vacation?.startDateKey || "");
  const endDateKey = String(vacation?.endDateKey || "");
  const coveredStartKey = startDateKey > monthStartKey ? startDateKey : monthStartKey;
  const coveredEndKey = endDateKey < monthEndKey ? endDateKey : monthEndKey;

  if (!coveredStartKey || !coveredEndKey || coveredStartKey > coveredEndKey) return 0;

  return differenceInCalendarDays(
    parseDateKey(coveredEndKey).date,
    parseDateKey(coveredStartKey).date,
  ) + 1;
}

export function filterVacationsForReport(vacations = [], search = "") {
  const normalizedQuery = normalizeSearch(search);

  if (!normalizedQuery) return vacations;

  return vacations.filter((vacation) => vacationSearchText(vacation).includes(normalizedQuery));
}

export function buildVacationReportWorkbook({
  vacations = [],
  monthKey,
  filterLabel = "Todos los empleados",
  generatedAt = new Date(),
}) {
  const records = vacations.map((vacation) => ({
    ...vacation,
    daysInMonth: getVacationDaysInMonth(vacation, monthKey),
  }));
  const statusCounts = records.reduce((totals, vacation) => {
    totals[vacation.status] = (totals[vacation.status] || 0) + 1;
    return totals;
  }, {});
  const approvedRecords = records.filter((vacation) => vacation.status === "approved");
  const approvedEmployeeIds = new Set(approvedRecords.map((vacation) => vacation.employeeId).filter(Boolean));
  const approvedDaysInMonth = approvedRecords.reduce((total, vacation) => total + vacation.daysInMonth, 0);
  const branchSummary = new Map();

  records.forEach((vacation) => {
    const branchName = vacation.branchName || "Sin sucursal";
    const current = branchSummary.get(branchName) || {
      branchName,
      requests: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      approvedDays: 0,
      approvedEmployeeIds: new Set(),
    };

    current.requests += 1;
    current[vacation.status] = (current[vacation.status] || 0) + 1;

    if (vacation.status === "approved") {
      current.approvedDays += vacation.daysInMonth;
      if (vacation.employeeId) current.approvedEmployeeIds.add(vacation.employeeId);
    }

    branchSummary.set(branchName, current);
  });

  const summaryRows = [
    ["Resumen mensual de vacaciones"],
    ["Periodo", monthKey],
    ["Filtro", filterLabel],
    ["Generado", generatedAt],
    [],
    ["Indicador", "Valor"],
    ["Solicitudes", records.length],
    ["Pendientes", statusCounts.pending || 0],
    ["Aprobadas", statusCounts.approved || 0],
    ["Rechazadas", statusCounts.rejected || 0],
    ["Empleados con vacaciones aprobadas", approvedEmployeeIds.size],
    ["Dias aprobados dentro del mes", approvedDaysInMonth],
    [],
    ["Resumen por sucursal"],
    ["Sucursal", "Solicitudes", "Pendientes", "Aprobadas", "Rechazadas", "Empleados", "Dias aprobados en el mes"],
    ...[...branchSummary.values()]
      .sort((left, right) => left.branchName.localeCompare(right.branchName, "es"))
      .map((branch) => [
        branch.branchName,
        branch.requests,
        branch.pending,
        branch.approved,
        branch.rejected,
        branch.approvedEmployeeIds.size,
        branch.approvedDays,
      ]),
  ];
  const detailRows = [
    [
      "Empleado",
      "DNI",
      "Sucursal",
      "Area",
      "Cargo",
      "Fecha inicio",
      "Fecha fin",
      "Dias de la solicitud",
      "Dias dentro del mes",
      "Estado",
      "Solicitada por",
      "Revisada por",
      "Observaciones",
    ],
    ...records.map((vacation) => [
      vacation.employeeName || "",
      vacation.employeeDni || "",
      vacation.branchName || "",
      vacation.areaName || "",
      vacation.roleName || "",
      dateKeyToExcelDate(vacation.startDateKey),
      dateKeyToExcelDate(vacation.endDateKey),
      vacation.totalCalendarDays || 0,
      vacation.daysInMonth,
      vacation.statusLabel || "",
      vacation.requestedBy || "",
      vacation.reviewedBy || "",
      vacation.notes || "",
    ]),
  ];
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows, { cellDates: true });
  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows, { cellDates: true });

  summarySheet["!merges"] = [
    XLSX.utils.decode_range("A1:G1"),
    XLSX.utils.decode_range("A14:G14"),
  ];
  summarySheet["!cols"] = [
    { wch: 38 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 26 },
  ];
  summarySheet["!freeze"] = { ySplit: 6 };
  if (summarySheet.B4) summarySheet.B4.z = "yyyy-mm-dd hh:mm";
  setIntegerColumnFormat(summarySheet, 1, 6, 11);
  if (records.length) {
    const lastSummaryRow = 14 + branchSummary.size;
    setIntegerColumnFormat(summarySheet, 1, 15, lastSummaryRow);
    setIntegerColumnFormat(summarySheet, 2, 15, lastSummaryRow);
    setIntegerColumnFormat(summarySheet, 3, 15, lastSummaryRow);
    setIntegerColumnFormat(summarySheet, 4, 15, lastSummaryRow);
    setIntegerColumnFormat(summarySheet, 5, 15, lastSummaryRow);
    setIntegerColumnFormat(summarySheet, 6, 15, lastSummaryRow);
  }

  detailSheet["!cols"] = [
    { wch: 34 },
    { wch: 16 },
    { wch: 22 },
    { wch: 24 },
    { wch: 26 },
    { wch: 14 },
    { wch: 14 },
    { wch: 20 },
    { wch: 20 },
    { wch: 14 },
    { wch: 24 },
    { wch: 24 },
    { wch: 42 },
  ];
  detailSheet["!autofilter"] = { ref: `A1:M${Math.max(records.length + 1, 1)}` };
  detailSheet["!freeze"] = { ySplit: 1 };
  setDateColumnFormat(detailSheet, 5, 1, records.length);
  setDateColumnFormat(detailSheet, 6, 1, records.length);
  setIntegerColumnFormat(detailSheet, 7, 1, records.length);
  setIntegerColumnFormat(detailSheet, 8, 1, records.length);

  workbook.Props = {
    Title: `Resumen mensual de vacaciones ${monthKey}`,
    Subject: "Vacaciones programadas y solicitudes del periodo",
    Author: "Control de Asistencia",
    CreatedDate: generatedAt,
  };
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen");
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Detalle");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellDates: true });
}
