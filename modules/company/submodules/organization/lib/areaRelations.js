import { Employee, OrganizationNode, Role } from "@/modules/company/models";

import { normalizeOrganizationNodeCode } from "@/modules/company/submodules/organization/lib/structure";

function uniqueCodes(...codes) {
  return [...new Set(
    codes
      .map((code) => String(code || "").trim().toUpperCase())
      .filter(Boolean),
  )];
}

function scoreAreaNode(node, expectedCode) {
  let score = 0;

  if (node.isActive !== false) {
    score += 100;
  }

  if (node.parentId) {
    score += 25;
  }

  if (node.code === normalizeOrganizationNodeCode(`ORG_AREA_${expectedCode}`)) {
    score += 15;
  }

  if (node.code?.startsWith("ORG_AREA_")) {
    score += 10;
  }

  return score;
}

async function resolveAvailableAreaNodeCode(areaCode) {
  const baseCode = normalizeOrganizationNodeCode(`ORG_AREA_${areaCode}`);
  const existingCodes = new Set(
    (await OrganizationNode.find({}, { code: 1 }).lean()).map((node) => node.code),
  );

  if (!existingCodes.has(baseCode)) {
    return baseCode;
  }

  for (let index = 2; index <= 99; index += 1) {
    const candidate = normalizeOrganizationNodeCode(`${baseCode}_${index}`);

    if (!existingCodes.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("No se pudo generar un código único para el nodo del área.");
}

async function findPreferredAreaNode(area, previousAreaCode) {
  const linkedCodes = uniqueCodes(previousAreaCode, area.code);
  const areaNodes = await OrganizationNode.find({
    nodeType: "area",
    areaCode: { $in: linkedCodes },
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (!areaNodes.length) {
    return null;
  }

  return areaNodes.reduce((bestNode, node) => {
    const bestScore = scoreAreaNode(bestNode, area.code);
    const nodeScore = scoreAreaNode(node, area.code);

    return nodeScore > bestScore ? node : bestNode;
  }, areaNodes[0]);
}

export async function syncAreaRelations(area, { previousAreaCode } = {}) {
  const linkedCodes = uniqueCodes(previousAreaCode, area.code);
  const preferredAreaNode = await findPreferredAreaNode(area, previousAreaCode);

  await Promise.all([
    OrganizationNode.updateMany(
      {
        areaCode: { $in: linkedCodes },
        nodeType: { $ne: "area" },
      },
      {
        $set: {
          areaCode: area.code,
          areaName: area.name,
        },
      },
    ),
    Role.updateMany(
      { areaCode: { $in: linkedCodes } },
      {
        $set: {
          areaCode: area.code,
          areaName: area.name,
        },
      },
    ),
    Employee.updateMany(
      { areaCode: { $in: linkedCodes } },
      {
        $set: {
          areaCode: area.code,
          areaName: area.name,
          department: area.name,
        },
      },
    ),
    Employee.updateMany(
      { "roleAssignments.areaCode": { $in: linkedCodes } },
      {
        $set: {
          "roleAssignments.$[role].areaCode": area.code,
          "roleAssignments.$[role].areaName": area.name,
        },
      },
      {
        arrayFilters: [{ "role.areaCode": { $in: linkedCodes } }],
      },
    ),
  ]);

  if (preferredAreaNode) {
    await OrganizationNode.updateOne(
      { _id: preferredAreaNode._id },
      {
        $set: {
          title: area.name,
          subtitle: "Área funcional",
          nodeType: "area",
          areaCode: area.code,
          areaName: area.name,
          roleCode: "",
          roleName: "",
          notes: area.description || "",
          isActive: area.isActive !== false,
        },
      },
      { runValidators: true },
    );

    await OrganizationNode.updateMany(
      {
        nodeType: "area",
        areaCode: { $in: linkedCodes },
        _id: { $ne: preferredAreaNode._id },
      },
      {
        $set: {
          areaCode: area.code,
          areaName: area.name,
          title: area.name,
          notes: area.description || "",
          isActive: false,
        },
      },
    );

    return;
  }

  await OrganizationNode.create({
    code: await resolveAvailableAreaNodeCode(area.code),
    title: area.name,
    subtitle: "Área funcional",
    nodeType: "area",
    level: 1,
    parentId: "",
    parentTitle: "",
    areaCode: area.code,
    areaName: area.name,
    roleCode: "",
    roleName: "",
    responsibleEmployeeId: "",
    responsibleEmployeeName: "",
    sortOrder: 0,
    positionX: null,
    positionY: null,
    notes: area.description || "",
    isActive: area.isActive !== false,
  });
}
