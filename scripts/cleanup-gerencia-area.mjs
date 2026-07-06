import process from "node:process";

import mongoose from "mongoose";

const APPLY = process.argv.includes("--apply");
const LEGACY_AREA_CODE = "GER";
const LEGACY_AREA_NAME = "GERENCIA";
const TARGET_AREA = { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA" };
const GERENCIA_ROLE_CODES = new Set(["ASIADM", "GERGEN"]);

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

function isGerenciaRole(source = {}) {
  const roleCode = normalizeCode(source.roleCode || source.code);
  const roleName = normalizeName(source.roleName || source.name || source.title);

  return GERENCIA_ROLE_CODES.has(roleCode) || roleName.includes("GERENCIA") || roleName.includes("GERENTE GENERAL");
}

function targetRoleFrom(source = {}) {
  const sourceRoleCode = normalizeCode(source.roleCode || source.code);
  const roleCode = sourceRoleCode || "GERGEN";
  const roleName = sourceRoleCode
    ? normalizeName(source.roleName || source.name || source.title) || "GERENTE GENERAL"
    : "GERENTE GENERAL";

  return {
    ...TARGET_AREA,
    roleCode,
    roleName: roleCode === "GERGEN" && roleName === "GERENCIA" ? "GERENTE GENERAL" : roleName,
  };
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

async function updateOrganizationNodes(db) {
  const organizationNodes = db.collection("organizationnodes");
  const legacyAreaNodes = await organizationNodes.find({
    nodeType: "area",
    areaCode: LEGACY_AREA_CODE,
  }).project({ _id: 1 }).toArray();
  const legacyAreaNodeIds = legacyAreaNodes.map((node) => node._id.toString());
  const positionNodes = await organizationNodes.find({
    nodeType: { $ne: "area" },
    areaCode: LEGACY_AREA_CODE,
  }).toArray();

  if (APPLY) {
    await organizationNodes.updateMany(
      { nodeType: "area", areaCode: LEGACY_AREA_CODE },
      {
        $set: {
          isActive: false,
          notes: "Nodo desactivado: GERENCIA se gestiona como cargo, no como area organizativa.",
        },
        $currentDate: { updatedAt: true },
      },
    );

    for (const node of positionNodes) {
      const target = targetRoleFrom(node);
      const currentParentId = String(node.parentId || "");
      const parentIsLegacyArea = legacyAreaNodeIds.includes(currentParentId);

      await organizationNodes.updateOne(
        { _id: node._id },
        {
          $set: {
            areaCode: target.areaCode,
            areaName: target.areaName,
            roleCode: target.roleCode,
            roleName: target.roleName,
            ...(parentIsLegacyArea ? { parentId: "", parentTitle: "" } : {}),
          },
          $currentDate: { updatedAt: true },
        },
      );
    }
  }

  return {
    legacyAreaNodes: legacyAreaNodes.length,
    positionNodes: positionNodes.length,
    modified: APPLY ? legacyAreaNodes.length + positionNodes.length : 0,
    dryRun: !APPLY,
  };
}

async function updateTemplates(db) {
  const templates = db.collection("basescheduletemplates");
  const docs = await templates.find({ areaCode: LEGACY_AREA_CODE }).toArray();

  for (const doc of docs) {
    const target = targetRoleFrom(doc);
    const nextName = isGerenciaRole(doc)
      ? String(doc.name || "").replace(/GERENCIA/gi, "GERENTE GENERAL")
      : doc.name;

    if (APPLY) {
      await templates.updateOne(
        { _id: doc._id },
        {
          $set: {
            areaCode: target.areaCode,
            areaName: target.areaName,
            roleCode: target.roleCode,
            roleName: target.roleName,
            name: nextName,
            rotationGroup: String(doc.rotationGroup || "GER_BASE").replace(/^GER/, "ADMIN_GERGEN"),
          },
          $currentDate: { updatedAt: true },
        },
      );
    }
  }

  return {
    matched: docs.length,
    modified: APPLY ? docs.length : 0,
    dryRun: !APPLY,
  };
}

async function updateScheduleAssignments(db) {
  const scheduleAssignments = db.collection("scheduleassignments");
  const docs = await scheduleAssignments.find({
    $or: [
      { areaCode: LEGACY_AREA_CODE },
      { "generatedDays.areaCode": LEGACY_AREA_CODE },
    ],
  }).toArray();

  for (const doc of docs) {
    const target = targetRoleFrom(doc);
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

        const dayTarget = targetRoleFrom(day.roleCode ? day : doc);

        return {
          ...day,
          areaCode: dayTarget.areaCode,
          areaName: dayTarget.areaName,
          roleCode: dayTarget.roleCode,
          roleName: dayTarget.roleName,
        };
      });
    }

    if (APPLY) {
      await scheduleAssignments.updateOne({ _id: doc._id }, { $set: set });
    }
  }

  return {
    matched: docs.length,
    modified: APPLY ? docs.length : 0,
    dryRun: !APPLY,
  };
}

async function updateMonthlyClosures(db) {
  const closures = db.collection("monthlyattendanceclosures");
  const docs = await closures.find({ "rows.areaCode": LEGACY_AREA_CODE }).toArray();

  for (const doc of docs) {
    const rows = (doc.rows || []).map((row) => {
      if (normalizeCode(row.areaCode) !== LEGACY_AREA_CODE) {
        return row;
      }

      const target = targetRoleFrom(row);

      return {
        ...row,
        areaCode: target.areaCode,
        areaName: target.areaName,
        roleCode: target.roleCode,
        roleName: target.roleName,
      };
    });

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

async function updateEmployeeScopedAreaNames(db, collectionName) {
  return applyOrCount(
    db.collection(collectionName),
    { areaName: LEGACY_AREA_NAME },
    {
      $set: {
        areaName: TARGET_AREA.areaName,
      },
      $currentDate: { updatedAt: true },
    },
  );
}

async function main() {
  await mongoose.connect(requireEnv("MONGODB_URI"));
  const db = mongoose.connection.db;
  const updates = {};

  updates.roles = await applyOrCount(
    db.collection("roles"),
    { areaCode: LEGACY_AREA_CODE },
    {
      $set: {
        areaCode: TARGET_AREA.areaCode,
        areaName: TARGET_AREA.areaName,
      },
      $currentDate: { updatedAt: true },
    },
  );

  updates.employeesPrimary = await applyOrCount(
    db.collection("employees"),
    { areaCode: LEGACY_AREA_CODE },
    {
      $set: {
        areaCode: TARGET_AREA.areaCode,
        areaName: TARGET_AREA.areaName,
        department: TARGET_AREA.areaName,
      },
      $currentDate: { updatedAt: true },
    },
  );

  updates.employeesAssignments = await applyOrCount(
    db.collection("employees"),
    { "roleAssignments.areaCode": LEGACY_AREA_CODE },
    {
      $set: {
        "roleAssignments.$[assignment].areaCode": TARGET_AREA.areaCode,
        "roleAssignments.$[assignment].areaName": TARGET_AREA.areaName,
      },
      $currentDate: { updatedAt: true },
    },
    { arrayFilters: [{ "assignment.areaCode": LEGACY_AREA_CODE }] },
  );

  updates.organizationNodes = await updateOrganizationNodes(db);
  updates.templates = await updateTemplates(db);
  updates.scheduleAssignments = await updateScheduleAssignments(db);
  updates.monthlyClosures = await updateMonthlyClosures(db);

  updates.laborRulesLunch = await applyOrCount(
    db.collection("laborruleconfigs"),
    { "roleLunchRules.areaCode": LEGACY_AREA_CODE },
    {
      $set: {
        "roleLunchRules.$[rule].areaCode": TARGET_AREA.areaCode,
        "roleLunchRules.$[rule].areaName": TARGET_AREA.areaName,
      },
      $currentDate: { updatedAt: true },
    },
    { arrayFilters: [{ "rule.areaCode": LEGACY_AREA_CODE }] },
  );

  updates.laborRulesPayrollNeutral = await applyOrCount(
    db.collection("laborruleconfigs"),
    { "payrollNeutralRoleRules.areaCode": LEGACY_AREA_CODE },
    {
      $set: {
        "payrollNeutralRoleRules.$[rule].areaCode": TARGET_AREA.areaCode,
        "payrollNeutralRoleRules.$[rule].areaName": TARGET_AREA.areaName,
      },
      $currentDate: { updatedAt: true },
    },
    { arrayFilters: [{ "rule.areaCode": LEGACY_AREA_CODE }] },
  );

  updates.dailyAttendances = await applyOrCount(
    db.collection("dailyattendances"),
    { areaCode: LEGACY_AREA_CODE },
    {
      $set: {
        areaCode: TARGET_AREA.areaCode,
        areaName: TARGET_AREA.areaName,
      },
      $currentDate: { updatedAt: true },
    },
  );

  updates.operationalExceptions = await updateEmployeeScopedAreaNames(db, "operationalexceptions");
  updates.vacationRequests = await updateEmployeeScopedAreaNames(db, "vacationrequests");

  updates.areaDeactivated = await applyOrCount(
    db.collection("areas"),
    { code: LEGACY_AREA_CODE },
    {
      $set: {
        isActive: false,
        description: "Area desactivada: GERENCIA se gestiona como cargo dentro de ADMINISTRATIVA FINANCIERA.",
      },
      $currentDate: { updatedAt: true },
    },
  );

  const remaining = {
    activeArea: await db.collection("areas").countDocuments({ code: LEGACY_AREA_CODE, isActive: { $ne: false } }),
    activeRoles: await db.collection("roles").countDocuments({ areaCode: LEGACY_AREA_CODE, isActive: { $ne: false } }),
    activeEmployees: await db.collection("employees").countDocuments({ areaCode: LEGACY_AREA_CODE, isActive: { $ne: false } }),
    activeOrganizationNodes: await db.collection("organizationnodes").countDocuments({ areaCode: LEGACY_AREA_CODE, isActive: { $ne: false } }),
    templates: await db.collection("basescheduletemplates").countDocuments({ areaCode: LEGACY_AREA_CODE }),
    scheduleAssignments: await db.collection("scheduleassignments").countDocuments({ areaCode: LEGACY_AREA_CODE }),
    scheduleAssignmentDays: await db.collection("scheduleassignments").countDocuments({ "generatedDays.areaCode": LEGACY_AREA_CODE }),
    dailyAttendances: await db.collection("dailyattendances").countDocuments({ areaCode: LEGACY_AREA_CODE }),
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
