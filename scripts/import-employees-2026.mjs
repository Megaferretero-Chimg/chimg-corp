import process from "node:process";

import mongoose from "mongoose";
import xlsx from "xlsx";

import Employee from "../models/Employee.js";
import Branch from "../models/Branch.js";
import Area from "../models/Area.js";
import Role from "../models/Role.js";

const DEFAULT_INPUT = "/Users/faridruano/Downloads/LISTA DE EMPLEADOS 2026.xlsx";
const APPLY = process.argv.includes("--apply");
const INPUT = process.argv.find((arg) => arg.startsWith("--input="))?.slice("--input=".length) || DEFAULT_INPUT;

const branchByPlace = new Map([
  ["AMBATO", { code: "AMB", name: "MATRIZ", city: "Ambato" }],
  ["SALCEDO", { code: "SAL", name: "SALCEDO", city: "Salcedo" }],
]);

const areaByExcelValue = new Map([
  ["ADMINISTRATIVO", { code: "ADMIN", name: "ADMINISTRATIVA FINANCIERA" }],
  ["GERENCIA", { code: "ADMIN", name: "ADMINISTRATIVA FINANCIERA" }],
  ["BODEGA", { code: "OPER", name: "OPERACIONES" }],
  ["CARGA PESADA", { code: "OPER", name: "OPERACIONES" }],
  ["TECNICO", { code: "OPER", name: "OPERACIONES" }],
]);

const roleCodeByAreaAndName = new Map([
  ["ADMINISTRATIVA FINANCIERA|CARTERA", "CARTER"],
  ["ADMINISTRATIVA FINANCIERA|COMPRAS", "COMPR"],
  ["ADMINISTRATIVA FINANCIERA|CONTABILIDAD", "CONTA"],
  ["ADMINISTRATIVA FINANCIERA|GERENCIA", "GERGEN"],
  ["ADMINISTRATIVA FINANCIERA|GERENTE", "GERENT"],
  ["ADMINISTRATIVA FINANCIERA|JEFATURA", "JEFADM"],
  ["ADMINISTRATIVA FINANCIERA|MARKETING", "MARKET"],
  ["ADMINISTRATIVA FINANCIERA|PAGOS", "PAGOS"],
  ["COMERCIAL|CAJERO", "CAJERO"],
  ["COMERCIAL|JEFATURA", "JEFSUC"],
  ["COMERCIAL|VENDEDOR", "VENDED"],
  ["COMERCIAL|VENDEDOR FERRETERO", "VENDED"],
  ["COMERCIAL|VENDEDOR HOGAR", "VENDED"],
  ["COMERCIAL|VENDEDOR ACABADOS", "VENDED"],
  ["OPERACIONES|BODEGUERO", "BODEG"],
  ["OPERACIONES|CHOFER", "CHOFER"],
  ["OPERACIONES|JEFATURA", "JEFLOG"],
  ["OPERACIONES|TECNICO", "TECBOD"],
]);

const employeeMatchOverridesByDni = new Map([
  ["1804535654", { biometricCode: "71" }],
  ["1802942670", { biometricCode: "50" }],
  ["1803587870", { biometricCode: "22" }],
  ["1755195722", { biometricCode: "58" }],
  ["202238465", { biometricCode: "67" }],
  ["1804479606", { biometricCode: "65" }],
]);

const stripAccents = (value) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "");

function normalizeText(value) {
  return stripAccents(String(value || ""))
    .toUpperCase()
    .replace(/Ñ/g, "N")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDni(value) {
  return String(value || "").replace(/\D/g, "");
}

function parseSalary(value) {
  const normalized = String(value || "0").replace(",", ".").trim();
  const salary = Number(normalized);
  if (!Number.isFinite(salary) || salary < 0) {
    throw new Error(`Sueldo invalido: ${value}`);
  }
  return salary;
}

function tokenSet(value) {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}

function nameScore(excelName, dbName) {
  const excelTokens = tokenSet(excelName);
  const dbTokens = tokenSet(dbName);
  if (!excelTokens.size || !dbTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of dbTokens) {
    if (excelTokens.has(token)) {
      overlap += 1;
    }
  }

  const containment = overlap / dbTokens.size;
  const coverage = overlap / excelTokens.size;
  return Math.round((containment * 0.75 + coverage * 0.25) * 100);
}

function readRows() {
  const workbook = xlsx.readFile(INPUT);
  const sheet = workbook.Sheets.Hoja1 || workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  return rows
    .slice(1)
    .map((row, index) => {
      const rawArea = normalizeText(row[4]);
      const branch = branchByPlace.get(normalizeText(row[3]));
      const roleName = normalizeText(row[5]) || (rawArea === "TECNICO" ? "TECNICO" : "");
      const area = resolveImportedArea(rawArea, roleName);

      if (!row[1]) {
        return null;
      }

      if (!area) {
        throw new Error(`Area sin mapeo en fila ${index + 3}: ${row[4]}`);
      }

      if (!branch) {
        throw new Error(`Sucursal sin mapeo en fila ${index + 3}: ${row[3]}`);
      }

      const roleCode = roleCodeByAreaAndName.get(`${area.name}|${roleName}`);
      if (!roleCode) {
        throw new Error(`Cargo sin mapeo en fila ${index + 3}: ${area.name} / ${row[5]}`);
      }

      return {
        sourceRow: index + 2,
        sourceNumber: String(row[0] || "").trim(),
        fullName: normalizeText(row[1]),
        affiliation: String(row[2] || "").trim(),
        dni: normalizeDni(row[6]),
        salary: parseSalary(row[7]),
        branch,
        area,
        role: {
          code: roleCode,
          name: roleName,
          areaCode: area.code,
          areaName: area.name,
        },
      };
    })
    .filter(Boolean);
}

function resolveImportedArea(rawArea, roleName) {
  if (rawArea === "ALMACEN" || rawArea === "ALMACEN SALCEDO") {
    if (roleName === "CHOFER") {
      return { code: "OPER", name: "OPERACIONES" };
    }

    return { code: "COM", name: "COMERCIAL" };
  }

  return areaByExcelValue.get(rawArea);
}

function buildPayload(row, existing = {}) {
  return {
    documentType: existing.documentType || "cedula",
    dni: row.dni,
    biometricCode: existing.biometricCode || "",
    fullName: row.fullName,
    personalEmail: existing.personalEmail || "",
    address: existing.address || "",
    phone: existing.phone || "",
    employmentRelation: existing.employmentRelation || "nomina",
    salary: row.salary,
    birthDate: existing.birthDate || null,
    branchId: existing.branchId || "",
    branchCode: row.branch.code,
    branchName: row.branch.name,
    branch: row.branch.name,
    areaCode: row.area.code,
    areaName: row.area.name,
    roleCode: row.role.code,
    roleName: row.role.name,
    roleAssignments: [{ ...row.role, isPrimary: true }],
    department: row.area.name,
    isActive: existing.isActive !== false,
  };
}

async function ensureCatalogs(rows) {
  const requiredBranches = new Map(rows.map((row) => [row.branch.code, row.branch]));
  const requiredAreas = new Map(rows.map((row) => [row.area.code, row.area]));
  const requiredRoles = new Map(rows.map((row) => [row.role.code, row.role]));

  for (const branch of requiredBranches.values()) {
    if (APPLY) {
      await Branch.updateOne(
        { code: branch.code },
        { $set: { ...branch, isActive: true }, $setOnInsert: { address: "" } },
        { upsert: true },
      );
    }
  }

  for (const area of requiredAreas.values()) {
    if (APPLY) {
      await Area.updateOne(
        { code: area.code },
        { $set: { ...area, isActive: true }, $setOnInsert: { description: "" } },
        { upsert: true },
      );
    }
  }

  for (const role of requiredRoles.values()) {
    if (APPLY) {
      await Role.updateOne(
        { code: role.code },
        { $set: { ...role, isActive: true }, $setOnInsert: { description: "" } },
        { upsert: true },
      );
    }
  }

  return {
    branches: [...requiredBranches.values()],
    areas: [...requiredAreas.values()],
    roles: [...requiredRoles.values()],
  };
}

function findNameMatch(row, employeesWithoutDni) {
  const matches = employeesWithoutDni
    .map((employee) => ({
      employee,
      score: nameScore(row.fullName, employee.fullName),
    }))
    .filter((match) => match.score >= 58)
    .sort((a, b) => b.score - a.score);

  const [best, second] = matches;
  if (!best || (second && best.score - second.score < 8)) {
    return null;
  }

  return best;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI no esta definido.");
  }

  const rows = readRows();
  const dniCounts = rows.reduce((counts, row) => counts.set(row.dni, (counts.get(row.dni) || 0) + 1), new Map());
  const duplicatedDnis = [...dniCounts].filter(([dni, count]) => dni && count > 1);
  if (duplicatedDnis.length) {
    throw new Error(`Cedulas duplicadas en Excel: ${duplicatedDnis.map(([dni]) => dni).join(", ")}`);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const employees = await Employee.find({}).lean();
  const byDni = new Map(employees.filter((employee) => employee.dni).map((employee) => [employee.dni, employee]));
  const byBiometricCode = new Map(
    employees
      .filter((employee) => employee.biometricCode)
      .map((employee) => [employee.biometricCode, employee]),
  );
  const withoutDni = employees.filter((employee) => !employee.dni);
  const consumedIds = new Set();
  const plan = [];

  for (const row of rows) {
    const override = employeeMatchOverridesByDni.get(row.dni);
    let employee = override?.biometricCode
      ? byBiometricCode.get(override.biometricCode)
      : null;
    let matchType = employee ? "manual-biometric" : "";
    let score = employee ? 100 : 0;

    if (!employee) {
      employee = byDni.get(row.dni);
      matchType = employee ? "dni" : "";
      score = employee ? 100 : 0;
    }

    if (!employee) {
      const match = findNameMatch(row, withoutDni.filter((candidate) => !consumedIds.has(String(candidate._id))));
      if (match) {
        employee = match.employee;
        matchType = "name";
        score = match.score;
      }
    }

    if (employee) {
      consumedIds.add(String(employee._id));
      plan.push({ action: "update", matchType, score, row, employee, payload: buildPayload(row, employee) });
    } else {
      plan.push({ action: "create", matchType: "new", score: 0, row, employee: null, payload: buildPayload(row) });
    }
  }

  const ambiguous = rows
    .map((row) => {
      const candidates = withoutDni
        .map((employee) => ({ employee, score: nameScore(row.fullName, employee.fullName) }))
        .filter((candidate) => candidate.score >= 45)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      return { row, candidates };
    })
    .filter(({ row, candidates }) => candidates.length && !plan.some((item) => item.row === row && item.action === "update"));

  const catalogs = await ensureCatalogs(rows);

  if (APPLY) {
    for (const item of plan) {
      if (item.action === "update") {
        await Employee.updateOne({ _id: item.employee._id }, { $set: item.payload }, { runValidators: true });
      } else {
        await Employee.create(item.payload);
      }
    }
  }

  const summary = {
    mode: APPLY ? "apply" : "dry-run",
    input: INPUT,
    rows: rows.length,
    updates: plan.filter((item) => item.action === "update").length,
    creates: plan.filter((item) => item.action === "create").length,
    requiredCatalogs: catalogs,
    plan: plan.map((item) => ({
      action: item.action,
      matchType: item.matchType,
      score: item.score,
      dni: item.row.dni,
      excelName: item.row.fullName,
      existingName: item.employee?.fullName || "",
      biometricCode: item.employee?.biometricCode || "",
      branch: item.row.branch.name,
      area: item.row.area.name,
      role: item.row.role.name,
      salary: item.row.salary,
    })),
    possibleButUnusedNameCandidates: ambiguous.map(({ row, candidates }) => ({
      dni: row.dni,
      excelName: row.fullName,
      candidates: candidates.map(({ employee, score }) => ({
        score,
        existingName: employee.fullName,
        biometricCode: employee.biometricCode || "",
      })),
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
