import * as XLSX from "xlsx";
import {
  eachDayOfInterval,
  endOfMonth,
  isValid,
  parse,
  parseISO,
  startOfMonth,
} from "date-fns";

import {
  getEcuadorParts,
  makeEcuadorDate,
  normalizeToEcuadorDate,
  setEcuadorTime,
  startOfEcuadorDay,
} from "@/lib/datetime/ecuador";
import { dedupePunchesByMinute } from "@/modules/planner/lib/attendance/punchIdentity";

const MONTH_INDEXES = {
  enero: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  septiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function normalizeEmployeePunches(employee) {
  return {
    ...employee,
    punches: dedupePunchesByMinute(employee.punches || []),
  };
}

function isTargetPeriod(month, year) {
  return Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year);
}

function punchMatchesPeriod(punchedAt, period) {
  if (!isTargetPeriod(period.month, period.year)) {
    return true;
  }

  const parts = getEcuadorParts(punchedAt);

  return parts?.month === period.month && parts?.year === period.year;
}

function resolveResultPeriod(result, requestedPeriod) {
  if (isTargetPeriod(requestedPeriod.month, requestedPeriod.year)) {
    return {
      ...result,
      month: requestedPeriod.month,
      year: requestedPeriod.year,
    };
  }

  return result;
}

function filterParsedResultToPeriod(result, requestedPeriod) {
  const resolvedResult = resolveResultPeriod(result, requestedPeriod);

  if (!isTargetPeriod(requestedPeriod.month, requestedPeriod.year)) {
    return resolvedResult;
  }

  const employees = (resolvedResult.employees || [])
    .map((employee) =>
      normalizeEmployeePunches({
        ...employee,
        punches: (employee.punches || []).filter((punch) =>
          punchMatchesPeriod(punch.punchedAt, requestedPeriod),
        ),
      }),
    )
    .filter((employee) => employee.punches.length > 0);
  const totalPunches = employees.reduce((sum, employee) => sum + employee.punches.length, 0);
  const skippedPunches = Math.max(0, (resolvedResult.totalPunches || 0) - totalPunches);
  const logs = [...(resolvedResult.logs || [])];

  if (skippedPunches > 0) {
    logs.push(
      `Se omitieron ${skippedPunches} picadas fuera del periodo seleccionado ${String(requestedPeriod.month).padStart(2, "0")}/${requestedPeriod.year}.`,
    );
  }

  if (!employees.length) {
    logs.push("No se detectaron picadas dentro del periodo seleccionado.");
  }

  return {
    ...resolvedResult,
    employees,
    logs,
    totalPunches,
  };
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function sheetToMatrix(sheet) {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
  const rows = [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row = [];

    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[address];

      row.push({
        address,
        rowIndex,
        columnIndex,
        value: cell?.v ?? null,
        text: cell ? String(XLSX.utils.format_cell(cell) || "").trim() : "",
        type: cell?.t || null,
        format: cell?.z || "",
      });
    }

    rows.push(row);
  }

  return rows;
}

function findValueNextToLabel(row, labelMatcher) {
  for (let index = 0; index < row.length; index += 1) {
    const label = normalizeText(row[index].text);

    if (!labelMatcher(label)) {
      continue;
    }

    for (let offset = 1; offset <= row.length - index; offset += 1) {
      const candidate = row[index + offset];
      const candidateText = candidate?.text?.trim();

      if (candidateText) {
        return candidateText;
      }
    }
  }

  return "";
}

function isSummaryRow(row) {
  const joined = normalizeText(row.map((cell) => cell.text).filter(Boolean).join(" | "));

  return (
    joined.includes("tiempo total") ||
    joined.includes("horas totales") ||
    (joined.includes("entrada") && joined.includes("salida"))
  );
}

function extractEmployeeMeta(blockRows) {
  const meta = {
    biometricCode: "",
    name: "",
    department: "",
  };

  for (const row of blockRows.slice(0, 5)) {
    if (!meta.biometricCode) {
      meta.biometricCode = findValueNextToLabel(
        row,
        (label) =>
          /^(id|codigo|code|emp id|employee id|no\.)$/.test(label) ||
          label.includes("biometric") ||
          label.includes("reloj"),
      );
    }

    if (!meta.name) {
      meta.name = findValueNextToLabel(
        row,
        (label) =>
          label === "nombre" ||
          label === "name" ||
          label.includes("employee name") ||
          label.includes("empleado"),
      );
    }

    if (!meta.department) {
      meta.department = findValueNextToLabel(
        row,
        (label) =>
          label === "departamento" ||
          label === "department" ||
          label.includes("area"),
      );
    }
  }

  if (!meta.biometricCode) {
    const rowText = blockRows
      .slice(0, 3)
      .flat()
      .map((cell) => cell.text)
      .join(" ");
    const codeMatch = rowText.match(/\b\d{3,}\b/);

    if (codeMatch) {
      meta.biometricCode = codeMatch[0];
    }
  }

  return meta;
}

function looksLikeEmployeeRow(row) {
  const text = row.map((cell) => normalizeText(cell.text)).filter(Boolean);
  const joined = text.join(" | ");

  const hasId = /(id|codigo|code|biometric|reloj)/.test(joined);
  const hasName = /(nombre|name|empleado|employee)/.test(joined);

  return hasId && hasName;
}

function inferPeriodContext(rows, sheetName, fileName) {
  const haystack = `${sheetName} ${fileName} ${rows
    .slice(0, 8)
    .flat()
    .map((cell) => cell.text)
    .join(" ")}`;

  const normalized = normalizeText(haystack);
  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  const monthEntry = Object.entries(MONTH_INDEXES).find(([token]) =>
    normalized.includes(token),
  );

  return {
    year: yearMatch ? Number(yearMatch[1]) : null,
    month: monthEntry ? monthEntry[1] : null,
  };
}

function classifyCell(cell) {
  const text = cell.text?.trim();
  const value = cell.value;

  if (!text && value == null) {
    return { kind: "empty", rawText: "" };
  }

  if (value instanceof Date && isValid(value)) {
    const normalizedDate = normalizeToEcuadorDate(value);
    const hasTime =
      value.getHours() !== 0 || value.getMinutes() !== 0 || value.getSeconds() !== 0;

    return {
      kind: hasTime ? "datetime" : "date",
      date: hasTime ? normalizedDate : startOfEcuadorDay(normalizedDate),
      rawText: text,
    };
  }

  if (typeof value === "number") {
    const parsedCode = XLSX.SSF.parse_date_code(value);

    if (parsedCode) {
      const builtDate = makeEcuadorDate(
        parsedCode.y || 1899,
        Math.max((parsedCode.m || 1) - 1, 0),
        parsedCode.d || 1,
        parsedCode.H || 0,
        parsedCode.M || 0,
        Math.floor(parsedCode.S || 0),
      );
      const hasCalendarDate = parsedCode.y && parsedCode.y > 1900;
      const hasTime =
        (parsedCode.H || 0) > 0 || (parsedCode.M || 0) > 0 || (parsedCode.S || 0) > 0;

      if (hasCalendarDate && hasTime) {
        return { kind: "datetime", date: builtDate, rawText: text || String(value) };
      }

      if (hasCalendarDate) {
        return {
          kind: "date",
          date: startOfEcuadorDay(builtDate),
          rawText: text || String(value),
        };
      }

      if (hasTime || value < 1) {
        return { kind: "time", time: text || formatExcelTime(value), rawText: text || String(value) };
      }
    }
  }

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
    return { kind: "time", time: text.slice(0, 5), rawText: text };
  }

  const combinedDateTime = tryParseDateTime(text);

  if (combinedDateTime) {
    const normalizedDate = normalizeToEcuadorDate(combinedDateTime);
    const hasTime =
      combinedDateTime.getHours() !== 0 ||
      combinedDateTime.getMinutes() !== 0 ||
      combinedDateTime.getSeconds() !== 0;

    return {
      kind: hasTime ? "datetime" : "date",
      date: hasTime ? normalizedDate : startOfEcuadorDay(normalizedDate),
      rawText: text,
    };
  }

  return { kind: "text", rawText: text };
}

function formatExcelTime(serialValue) {
  const totalMinutes = Math.round(((serialValue % 1) * 24 * 60) % (24 * 60));
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function tryParseDateTime(value) {
  if (!value) {
    return null;
  }

  const formats = [
    "dd/MM/yyyy HH:mm:ss",
    "dd/MM/yyyy HH:mm",
    "MM/dd/yyyy HH:mm:ss",
    "MM/dd/yyyy HH:mm",
    "yyyy-MM-dd HH:mm:ss",
    "yyyy-MM-dd HH:mm",
    "dd-MM-yyyy HH:mm",
    "dd/MM/yyyy",
    "MM/dd/yyyy",
    "yyyy-MM-dd",
    "dd-MM-yyyy",
  ];

  for (const dateFormat of formats) {
    const parsed = parse(value, dateFormat, new Date());

    if (isValid(parsed)) {
      return parsed;
    }
  }

  const isoParsed = parseISO(value);
  return isValid(isoParsed) ? isoParsed : null;
}

function parseLocalEcuadorDateTime(value) {
  const text = String(value || "").trim();
  const match = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes, seconds = "0"] = match;

  return makeEcuadorDate(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );
}

function parseDelimitedLine(line, delimiter = ",") {
  const cells = [];
  let current = "";
  let isQuoted = false;

  for (const character of String(line || "")) {
    if (character === "\"") {
      isQuoted = !isQuoted;
      continue;
    }

    if (character === delimiter && !isQuoted) {
      cells.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseDayMonthDateTime(datePart, timePart) {
  const [day, month, year] = String(datePart || "").split("/").map(Number);
  const [hours, minutes, seconds = 0] = String(timePart || "").split(":").map(Number);

  if (!day || !month || !year || Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  return makeEcuadorDate(year, month - 1, day, hours, minutes, seconds, 0);
}

function groupTextPunch(groupMap, key, payload) {
  if (!groupMap.has(key)) {
    groupMap.set(key, {
      biometricCode: payload.biometricCode,
      name: payload.name,
      department: payload.department || "",
      punches: [],
    });
  }

  const group = groupMap.get(key);

  if (payload.name && (!group.name || group.name === group.biometricCode)) {
    group.name = payload.name;
  }

  if (payload.department && !group.department) {
    group.department = payload.department;
  }

  group.punches.push({
    punchedAt: payload.punchedAt,
    rawValue: payload.rawValue,
  });
}

function parseInOutHorizontalCsv({ buffer, fileName, branchCode, branchName, month: targetMonth, year: targetYear }) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseDelimitedLine(lines[0] || ",");
  const indexByHeader = new Map(headers.map((header, index) => [normalizeText(header), index]));
  const codeIndex = indexByHeader.get("no.");
  const nameIndex = indexByHeader.get("name");
  const departmentIndex = indexByHeader.get("department");
  const dateTimeIndex = indexByHeader.get("date/time");
  const groups = new Map();
  const logs = [];
  let month = null;
  let year = null;

  if (codeIndex == null || dateTimeIndex == null) {
    logs.push("No se encontraron las columnas No. y Date/Time del reporte horizontal.");
  }

  for (const line of lines.slice(1)) {
    const columns = parseDelimitedLine(line);
    const biometricCode = String(columns[codeIndex] || "").trim();
    const fullName = String(columns[nameIndex] || biometricCode || "").trim();
    const department = String(columns[departmentIndex] || "").trim();
    const [datePart, timePart] = String(columns[dateTimeIndex] || "").trim().split(/\s+/);
    const punchedAt = parseDayMonthDateTime(datePart, timePart);

    if (!biometricCode || !punchedAt) {
      continue;
    }

    month ||= punchedAt.getMonth() + 1;
    year ||= punchedAt.getFullYear();

    groupTextPunch(groups, biometricCode, {
      biometricCode,
      name: fullName,
      department,
      punchedAt,
      rawValue: columns[dateTimeIndex] || "",
    });
  }

  const employees = [...groups.values()].map(normalizeEmployeePunches);

  const parsedResult = {
    sheetName: fileName,
    branchCode,
    branchName,
    month,
    year,
    employees,
    logs,
    totalPunches: employees.reduce((sum, employee) => sum + employee.punches.length, 0),
  };

  return filterParsedResultToPeriod(parsedResult, { month: targetMonth, year: targetYear });
}

function parseAttlogDat({ buffer, fileName, branchCode, branchName, month: targetMonth, year: targetYear }) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const groups = new Map();
  const logs = [];
  let month = null;
  let year = null;

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const biometricCode = String(Number(parts[0]) || parts[0] || "").trim();
    const punchedAt =
      parts[1] && parts[2] ? parseLocalEcuadorDateTime(`${parts[1]} ${parts[2]}`) : null;

    if (!biometricCode || !punchedAt) {
      continue;
    }

    month ||= punchedAt.getMonth() + 1;
    year ||= punchedAt.getFullYear();

    groupTextPunch(groups, biometricCode, {
      biometricCode,
      name: biometricCode,
      punchedAt,
      rawValue: `${parts[1]} ${parts[2]}`,
    });
  }

  const employees = [...groups.values()].map(normalizeEmployeePunches);

  if (!employees.length) {
    logs.push("No se detectaron picadas en el archivo attlog.");
  }

  const parsedResult = {
    sheetName: fileName,
    branchCode,
    branchName,
    month,
    year,
    employees,
    logs,
    totalPunches: employees.reduce((sum, employee) => sum + employee.punches.length, 0),
  };

  return filterParsedResultToPeriod(parsedResult, { month: targetMonth, year: targetYear });
}

function buildDayNumberAnchors(blockRows, period) {
  const anchors = new Map();

  if (!period.month || !period.year) {
    return anchors;
  }

  const validDays = eachDayOfInterval({
    start: startOfMonth(new Date(period.year, period.month - 1, 1)),
    end: endOfMonth(new Date(period.year, period.month - 1, 1)),
  }).map((date) => date.getDate());

  for (const row of blockRows) {
    for (const cell of row) {
      const numeric = Number(cell.text);

      if (!Number.isInteger(numeric) || !validDays.includes(numeric)) {
        continue;
      }

      if (!anchors.has(cell.columnIndex)) {
        anchors.set(
          cell.columnIndex,
          makeEcuadorDate(period.year, period.month - 1, numeric, 0, 0, 0, 0),
        );
      }
    }
  }

  return anchors;
}

function extractPunchesFromBlock(blockRows, period, logs, employeeLabel) {
  const columnDateAnchors = new Map();
  const dayNumberAnchors = buildDayNumberAnchors(blockRows, period);
  const punches = [];
  const seenTimestamps = new Set();

  for (const row of blockRows) {
    if (isSummaryRow(row)) {
      continue;
    }

    for (const cell of row) {
      const classified = classifyCell(cell);

      if (classified.kind === "date") {
        if (!columnDateAnchors.has(cell.columnIndex)) {
          columnDateAnchors.set(cell.columnIndex, startOfEcuadorDay(classified.date));
        }
        continue;
      }

      if (classified.kind === "datetime") {
        const stamp = classified.date.toISOString();

        if (!seenTimestamps.has(stamp)) {
          punches.push({
            punchedAt: classified.date,
            rawValue: classified.rawText || stamp,
          });
          seenTimestamps.add(stamp);
        }
      }
    }
  }

  for (const row of blockRows) {
    if (isSummaryRow(row)) {
      continue;
    }

    for (const cell of row) {
      const classified = classifyCell(cell);

      if (classified.kind !== "time") {
        continue;
      }

      const anchor =
        columnDateAnchors.get(cell.columnIndex) ||
        dayNumberAnchors.get(cell.columnIndex) ||
        columnDateAnchors.get(cell.columnIndex - 1) ||
        dayNumberAnchors.get(cell.columnIndex - 1) ||
        columnDateAnchors.get(cell.columnIndex + 1) ||
        dayNumberAnchors.get(cell.columnIndex + 1);

      if (!anchor) {
        logs.push(
          `No se encontró fecha ancla para la hora "${classified.time}" en ${employeeLabel} (${cell.address}).`,
        );
        continue;
      }

      const [hours, minutes] = classified.time.split(":").map(Number);
      const punchedAt = setEcuadorTime(anchor, {
        hours,
        minutes,
        seconds: 0,
        milliseconds: 0,
      });
      const stamp = punchedAt.toISOString();

      if (!seenTimestamps.has(stamp)) {
        punches.push({
          punchedAt,
          rawValue: classified.rawText || classified.time,
        });
        seenTimestamps.add(stamp);
      }
    }
  }

  return punches.sort(
    (left, right) => left.punchedAt.getTime() - right.punchedAt.getTime(),
  );
}

export default function parseAttendanceFile({
  buffer,
  fileName,
  branchCode = "",
  branchName = "",
  month = null,
  year = null,
}) {
  const normalizedFileName = String(fileName || "").toLowerCase();

  if (normalizedFileName.endsWith(".csv")) {
    return parseInOutHorizontalCsv({ buffer, fileName, branchCode, branchName, month, year });
  }

  if (normalizedFileName.endsWith(".dat")) {
    return parseAttlogDat({ buffer, fileName, branchCode, branchName, month, year });
  }

  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    dense: false,
  });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = sheetToMatrix(sheet);
  const inferredPeriod = inferPeriodContext(rows, sheetName, fileName);
  const period = {
    month: isTargetPeriod(month, year) ? month : inferredPeriod.month,
    year: isTargetPeriod(month, year) ? year : inferredPeriod.year,
  };
  const logs = [];
  const blocks = [];
  let currentBlock = [];

  rows.forEach((row, rowIndex) => {
    const isEmployeeRow = looksLikeEmployeeRow(row);

    if (isEmployeeRow && currentBlock.length) {
      blocks.push(currentBlock);
      currentBlock = [];
    }

    if (isEmployeeRow || currentBlock.length) {
      currentBlock.push(row);
    } else if (rowIndex === rows.length - 1 && currentBlock.length) {
      blocks.push(currentBlock);
      currentBlock = [];
    }
  });

  if (currentBlock.length) {
    blocks.push(currentBlock);
  }

  if (!blocks.length) {
    logs.push(
      "No se detectaron bloques de empleados con la heurística actual. Revisa el formato real del reporte para ajustar los labels.",
    );
  }

  const employees = blocks
    .map((blockRows, index) => {
      const metadata = extractEmployeeMeta(blockRows);
      const employeeLabel =
        metadata.name || metadata.biometricCode || `bloque ${index + 1}`;
      const punches = extractPunchesFromBlock(
        blockRows,
        period,
        logs,
        employeeLabel,
      );

      if (!metadata.biometricCode || !metadata.name) {
        logs.push(
          `El ${employeeLabel} no tiene metadata completa; se intentará guardar con los valores detectados.`,
        );
      }

      return {
        biometricCode: metadata.biometricCode || `UNMAPPED-${index + 1}`,
        name: metadata.name || `Empleado detectado ${index + 1}`,
        department: metadata.department || "",
        punches,
      };
    })
    .map(normalizeEmployeePunches)
    .filter((employee) => employee.punches.length > 0 || employee.biometricCode);

  const totalPunches = employees.reduce(
    (sum, employee) => sum + employee.punches.length,
    0,
  );

  const parsedResult = {
    sheetName,
    branchCode,
    branchName,
    month: period.month,
    year: period.year,
    employees,
    logs,
    totalPunches,
  };

  return filterParsedResultToPeriod(parsedResult, { month, year });
}
