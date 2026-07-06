import process from "node:process";

import mongoose from "mongoose";

const APPLY = process.argv.includes("--apply");
const LEGACY_AREA_CODE = "ALM";
const LEGACY_AREA_NAME = "ALMACEN";
const COMMERCIAL_AREA = { areaCode: "COM", areaName: "COMERCIAL" };
const OPERATIONS_AREA = { areaCode: "OPER", areaName: "OPERACIONES" };

const LEGACY_ROLE_MAP = new Map([
  ["CAJALM", { ...COMMERCIAL_AREA, roleCode: "CAJERO", roleName: "CAJERO" }],
  ["JEFALM", { ...COMMERCIAL_AREA, roleCode: "JEFSUC", roleName: "JEFE DE SUCURSAL" }],
  ["VENDALM", { ...COMMERCIAL_AREA, roleCode: "VENDED", roleName: "VENDEDOR" }],
  ["VENFER", { ...COMMERCIAL_AREA, roleCode: "VENDED", roleName: "VENDEDOR" }],
  ["VENHOG", { ...COMMERCIAL_AREA, roleCode: "VENDED", roleName: "VENDEDOR" }],
  ["VENACA", { ...COMMERCIAL_AREA, roleCode: "VENDED", roleName: "VENDEDOR" }],
  ["CHOALM", { ...OPERATIONS_AREA, roleCode: "CHOFER", roleName: "CHOFER" }],
]);

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeName(value) {
  return String(value || "").trim().toUpperCase();
}

function fallbackTarget(source = {}) {
  const roleCode = normalizeCode(source.roleCode);
  const roleName = normalizeName(source.roleName || source.name);

  if (LEGACY_ROLE_MAP.has(roleCode)) {
    return LEGACY_ROLE_MAP.get(roleCode);
  }

  if (roleName.includes("CHOFER")) {
    return { ...OPERATIONS_AREA, roleCode: "CHOFER", roleName: "CHOFER" };
  }

  if (roleName.includes("CAJER")) {
    return { ...COMMERCIAL_AREA, roleCode: "CAJERO", roleName: "CAJERO" };
  }

  if (roleName.includes("JEF")) {
    return { ...COMMERCIAL_AREA, roleCode: "JEFSUC", roleName: "JEFE DE SUCURSAL" };
  }

  return { ...COMMERCIAL_AREA, roleCode: "VENDED", roleName: "VENDEDOR" };
}

function targetFromEmployee(employee, source = {}) {
  if (employee?.areaCode && normalizeCode(employee.areaCode) !== LEGACY_AREA_CODE) {
    return {
      areaCode: normalizeCode(employee.areaCode),
      areaName: normalizeName(employee.areaName),
      roleCode: normalizeCode(employee.roleCode) || fallbackTarget(source).roleCode,
      roleName: normalizeName(employee.roleName) || fallbackTarget(source).roleName,
    };
  }

  return fallbackTarget(source);
}

function replaceLegacyTemplateText(value) {
  return String(value || "")
    .replace(/ALMCACEN/gi, "COMERCIAL")
    .replace(/ALMAC[EÉ]N/gi, "COMERCIAL")
    .replace(/ALMACEN/gi, "COMERCIAL")
    .trim();
}

async function applyOrCount(collection, filter, update, options = {}) {
  if (!APPLY) {
    return {
      matched: await collection.countDocuments(filter),
      modified: 0,
      dryRun: true,
    };
  }

  const result = await collection.updateMany(filter, update, options);

  return {
    matched: result.matchedCount ?? 0,
    modified: result.modifiedCount ?? 0,
    dryRun: false,
  };
}

async function updateScheduleAssignments(db) {
  const scheduleAssignments = db.collection("scheduleassignments");
  const employees = db.collection("employees");
  const docs = await scheduleAssignments.find({
    $or: [
      { areaCode: LEGACY_AREA_CODE },
      { "generatedDays.areaCode": LEGACY_AREA_CODE },
    ],
  }).toArray();
  const planned = [];

  for (const doc of docs) {
    const employee = doc.employee ? await employees.findOne({ _id: doc.employee }) : null;
    const target = targetFromEmployee(employee, doc);
    const set = {
      areaCode: target.areaCode,
      areaName: target.areaName,
      roleCode: target.roleCode,
      roleName: target.roleName,
      updatedAt: new Date(),
    };

    if (Array.isArray(doc.generatedDays)) {
      set.generatedDays = doc.generatedDays.map((day) => {
        if (normalizeCode(day.areaCode) !== LEGACY_AREA_CODE) {
          return day;
        }

        return {
          ...day,
          areaCode: target.areaCode,
          areaName: target.areaName,
          roleCode: target.roleCode,
          roleName: target.roleName,
        };
      });
    }

    planned.push({ _id: doc._id, employeeName: doc.employeeName, target });

    if (APPLY) {
      await scheduleAssignments.updateOne({ _id: doc._id }, { $set: set });
    }
  }

  return {
    matched: docs.length,
    modified: APPLY ? docs.length : 0,
    sample: planned.slice(0, 10),
    dryRun: !APPLY,
  };
}

async function updateTemplates(db) {
  const templates = db.collection("basescheduletemplates");
  const docs = await templates.find({ areaCode: LEGACY_AREA_CODE }).toArray();

  for (const doc of docs) {
    const target = fallbackTarget(doc);
    const update = {
      areaCode: COMMERCIAL_AREA.areaCode,
      areaName: COMMERCIAL_AREA.areaName,
      roleCode: target.areaCode === COMMERCIAL_AREA.areaCode ? target.roleCode : "",
      roleName: target.areaCode === COMMERCIAL_AREA.areaCode ? target.roleName : "",
      name: replaceLegacyTemplateText(doc.name),
      rotationGroup: String(doc.rotationGroup || "").replace(/^ALM_/, "COM_"),
      updatedAt: new Date(),
    };

    if (APPLY) {
      await templates.updateOne({ _id: doc._id }, { $set: update });
    }
  }

  return {
    matched: docs.length,
    modified: APPLY ? docs.length : 0,
    dryRun: !APPLY,
  };
}

async function updateEmployeeScopedAreaNames(db, collectionName) {
  const collection = db.collection(collectionName);
  const employees = db.collection("employees");
  const docs = await collection.find({ areaName: LEGACY_AREA_NAME }).toArray();
  const planned = [];

  for (const doc of docs) {
    const employee = doc.employee ? await employees.findOne({ _id: doc.employee }) : null;
    const target = targetFromEmployee(employee, doc);
    planned.push({ _id: doc._id, employeeName: doc.employeeName, target });

    if (APPLY) {
      await collection.updateOne(
        { _id: doc._id },
        {
          $set: {
            areaName: target.areaName,
            roleName: target.roleName,
            updatedAt: new Date(),
          },
        },
      );
    }
  }

  return {
    matched: docs.length,
    modified: APPLY ? docs.length : 0,
    sample: planned.slice(0, 10),
    dryRun: !APPLY,
  };
}

async function updateMonthlyClosures(db) {
  const closures = db.collection("monthlyattendanceclosures");
  const employees = db.collection("employees");
  const docs = await closures.find({ "rows.areaCode": LEGACY_AREA_CODE }).toArray();

  for (const doc of docs) {
    const rows = [];

    for (const row of doc.rows || []) {
      if (normalizeCode(row.areaCode) !== LEGACY_AREA_CODE) {
        rows.push(row);
        continue;
      }

      const employee = row.employee ? await employees.findOne({ _id: row.employee }) : null;
      const target = targetFromEmployee(employee, row);
      rows.push({
        ...row,
        areaCode: target.areaCode,
        areaName: target.areaName,
        roleCode: target.roleCode,
        roleName: target.roleName,
      });
    }

    if (APPLY) {
      await closures.updateOne({ _id: doc._id }, { $set: { rows, updatedAt: new Date() } });
    }
  }

  return {
    matched: docs.length,
    modified: APPLY ? docs.length : 0,
    dryRun: !APPLY,
  };
}

async function main() {
  await mongoose.connect(requireEnv("MONGODB_URI"));
  const db = mongoose.connection.db;

  const updates = {};

  updates.laborRulesAreaLunch = await applyOrCount(
    db.collection("laborruleconfigs"),
    { "areaLunchRules.areaCode": LEGACY_AREA_CODE },
    {
      $set: {
        "areaLunchRules.$[rule].areaCode": COMMERCIAL_AREA.areaCode,
        "areaLunchRules.$[rule].areaName": COMMERCIAL_AREA.areaName,
      },
      $currentDate: { updatedAt: true },
    },
    { arrayFilters: [{ "rule.areaCode": LEGACY_AREA_CODE }] },
  );

  updates.rolesDeactivated = await applyOrCount(
    db.collection("roles"),
    { areaCode: LEGACY_AREA_CODE },
    {
      $set: {
        isActive: false,
        description: "Rol legacy de ALMACEN desactivado; usar cargos de COMERCIAL u OPERACIONES.",
      },
      $currentDate: { updatedAt: true },
    },
  );

  updates.organizationNodesDeactivated = await applyOrCount(
    db.collection("organizationnodes"),
    { areaCode: LEGACY_AREA_CODE },
    {
      $set: {
        isActive: false,
        notes: "Nodo legacy de ALMACEN desactivado; no es area organizativa vigente.",
      },
      $currentDate: { updatedAt: true },
    },
  );

  updates.templates = await updateTemplates(db);
  updates.scheduleAssignments = await updateScheduleAssignments(db);
  updates.operationalExceptions = await updateEmployeeScopedAreaNames(db, "operationalexceptions");
  updates.vacationRequests = await updateEmployeeScopedAreaNames(db, "vacationrequests");
  updates.monthlyClosures = await updateMonthlyClosures(db);

  updates.areaDeactivated = await applyOrCount(
    db.collection("areas"),
    { code: LEGACY_AREA_CODE },
    {
      $set: {
        isActive: false,
        description: "Area legacy desactivada: ALMACEN se gestiona como contexto operativo de COMERCIAL, no como area organizativa.",
      },
      $currentDate: { updatedAt: true },
    },
  );

  const remaining = {
    areas: await db.collection("areas").countDocuments({ code: LEGACY_AREA_CODE, isActive: { $ne: false } }),
    roles: await db.collection("roles").countDocuments({ areaCode: LEGACY_AREA_CODE, isActive: { $ne: false } }),
    organizationNodes: await db.collection("organizationnodes").countDocuments({ areaCode: LEGACY_AREA_CODE, isActive: { $ne: false } }),
    templates: await db.collection("basescheduletemplates").countDocuments({ areaCode: LEGACY_AREA_CODE }),
    scheduleAssignments: await db.collection("scheduleassignments").countDocuments({ areaCode: LEGACY_AREA_CODE }),
    scheduleAssignmentDays: await db.collection("scheduleassignments").countDocuments({ "generatedDays.areaCode": LEGACY_AREA_CODE }),
    operationalExceptions: await db.collection("operationalexceptions").countDocuments({ areaName: LEGACY_AREA_NAME }),
    vacationRequests: await db.collection("vacationrequests").countDocuments({ areaName: LEGACY_AREA_NAME }),
    monthlyClosures: await db.collection("monthlyattendanceclosures").countDocuments({ "rows.areaCode": LEGACY_AREA_CODE }),
  };

  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", updates, remaining }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
