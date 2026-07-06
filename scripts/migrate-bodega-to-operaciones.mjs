import mongoose from "mongoose";

const LEGACY_AREA_CODE = "BOD";
const LEGACY_AREA_NAME = "BODEGA";
const TARGET_AREA_CODE = "OPER";
const TARGET_AREA_NAME = "OPERACIONES";

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function updateMany(collection, filter, update, options = {}) {
  const result = await collection.updateMany(filter, update, options);

  return {
    matched: result.matchedCount ?? result.n ?? 0,
    modified: result.modifiedCount ?? result.nModified ?? 0,
  };
}

async function main() {
  await mongoose.connect(requireEnv("MONGODB_URI"));

  const db = mongoose.connection.db;
  const areas = db.collection("areas");
  const roles = db.collection("roles");
  const employees = db.collection("employees");
  const organizationNodes = db.collection("organizationnodes");
  const baseScheduleTemplates = db.collection("basescheduletemplates");
  const scheduleAssignments = db.collection("scheduleassignments");
  const laborRuleConfigs = db.collection("laborruleconfigs");
  const dailyAttendances = db.collection("dailyattendances");
  const operationalExceptions = db.collection("operationalexceptions");
  const vacationRequests = db.collection("vacationrequests");

  await areas.updateOne(
    { code: TARGET_AREA_CODE },
    {
      $set: {
        code: TARGET_AREA_CODE,
        name: TARGET_AREA_NAME,
        description: "Operaciones de bodega, despacho, transporte, tecnicos y jefatura logistica.",
        isActive: true,
      },
      $setOnInsert: {
        branchCodes: [],
        branchNames: [],
        createdAt: new Date(),
      },
      $currentDate: { updatedAt: true },
    },
    { upsert: true },
  );

  const updates = {};

  updates.roles = await updateMany(
    roles,
    { areaCode: LEGACY_AREA_CODE },
    { $set: { areaCode: TARGET_AREA_CODE, areaName: TARGET_AREA_NAME }, $currentDate: { updatedAt: true } },
  );

  updates.employeesPrimary = await updateMany(
    employees,
    { areaCode: LEGACY_AREA_CODE },
    {
      $set: {
        areaCode: TARGET_AREA_CODE,
        areaName: TARGET_AREA_NAME,
        department: TARGET_AREA_NAME,
      },
      $currentDate: { updatedAt: true },
    },
  );

  updates.employeesAssignments = await updateMany(
    employees,
    { "roleAssignments.areaCode": LEGACY_AREA_CODE },
    {
      $set: {
        "roleAssignments.$[assignment].areaCode": TARGET_AREA_CODE,
        "roleAssignments.$[assignment].areaName": TARGET_AREA_NAME,
      },
      $currentDate: { updatedAt: true },
    },
    { arrayFilters: [{ "assignment.areaCode": LEGACY_AREA_CODE }] },
  );

  updates.organizationNodes = await updateMany(
    organizationNodes,
    { areaCode: LEGACY_AREA_CODE },
    {
      $set: {
        areaCode: TARGET_AREA_CODE,
        areaName: TARGET_AREA_NAME,
      },
      $currentDate: { updatedAt: true },
    },
  );

  updates.organizationAreaNode = await updateMany(
    organizationNodes,
    { nodeType: "area", areaCode: TARGET_AREA_CODE, title: LEGACY_AREA_NAME },
    {
      $set: {
        title: TARGET_AREA_NAME,
        subtitle: "Area funcional",
        areaName: TARGET_AREA_NAME,
      },
      $currentDate: { updatedAt: true },
    },
  );

  updates.templates = await updateMany(
    baseScheduleTemplates,
    { areaCode: LEGACY_AREA_CODE },
    {
      $set: {
        areaCode: TARGET_AREA_CODE,
        areaName: TARGET_AREA_NAME,
      },
      $currentDate: { updatedAt: true },
    },
  );

  updates.scheduleAssignments = await updateMany(
    scheduleAssignments,
    { areaCode: LEGACY_AREA_CODE },
    {
      $set: {
        areaCode: TARGET_AREA_CODE,
        areaName: TARGET_AREA_NAME,
      },
      $currentDate: { updatedAt: true },
    },
  );

  updates.scheduleAssignmentDays = await updateMany(
    scheduleAssignments,
    { "generatedDays.areaCode": LEGACY_AREA_CODE },
    {
      $set: {
        "generatedDays.$[day].areaCode": TARGET_AREA_CODE,
        "generatedDays.$[day].areaName": TARGET_AREA_NAME,
      },
      $currentDate: { updatedAt: true },
    },
    { arrayFilters: [{ "day.areaCode": LEGACY_AREA_CODE }] },
  );

  updates.laborRules = await updateMany(
    laborRuleConfigs,
    { areaCode: LEGACY_AREA_CODE },
    {
      $set: {
        areaCode: TARGET_AREA_CODE,
        areaName: TARGET_AREA_NAME,
      },
      $currentDate: { updatedAt: true },
    },
  );

  updates.dailyAttendances = await updateMany(
    dailyAttendances,
    { areaCode: LEGACY_AREA_CODE },
    {
      $set: {
        areaCode: TARGET_AREA_CODE,
        areaName: TARGET_AREA_NAME,
      },
      $currentDate: { updatedAt: true },
    },
  );

  updates.exceptions = await updateMany(
    operationalExceptions,
    { areaName: LEGACY_AREA_NAME },
    {
      $set: { areaName: TARGET_AREA_NAME },
      $currentDate: { updatedAt: true },
    },
  );

  updates.vacations = await updateMany(
    vacationRequests,
    { areaName: LEGACY_AREA_NAME },
    {
      $set: { areaName: TARGET_AREA_NAME },
      $currentDate: { updatedAt: true },
    },
  );

  const remaining = {
    roles: await roles.countDocuments({ areaCode: LEGACY_AREA_CODE }),
    employees: await employees.countDocuments({ areaCode: LEGACY_AREA_CODE }),
    employeeAssignments: await employees.countDocuments({ "roleAssignments.areaCode": LEGACY_AREA_CODE }),
    organizationNodes: await organizationNodes.countDocuments({ areaCode: LEGACY_AREA_CODE }),
    templates: await baseScheduleTemplates.countDocuments({ areaCode: LEGACY_AREA_CODE }),
    scheduleAssignments: await scheduleAssignments.countDocuments({ areaCode: LEGACY_AREA_CODE }),
    scheduleAssignmentDays: await scheduleAssignments.countDocuments({ "generatedDays.areaCode": LEGACY_AREA_CODE }),
    laborRules: await laborRuleConfigs.countDocuments({ areaCode: LEGACY_AREA_CODE }),
    dailyAttendances: await dailyAttendances.countDocuments({ areaCode: LEGACY_AREA_CODE }),
  };

  const hasRemainingLegacyReferences = Object.values(remaining).some((count) => count > 0);

  if (!hasRemainingLegacyReferences) {
    const deleteResult = await areas.deleteOne({ code: LEGACY_AREA_CODE });
    updates.deletedLegacyBodegaArea = {
      deleted: deleteResult.deletedCount || 0,
    };
  } else {
    updates.keptLegacyBodegaArea = {
      reason: "Hay referencias legacy pendientes; no se elimina el area BODEGA.",
    };
  }

  console.log(JSON.stringify({ updates, remaining }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
