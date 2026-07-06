import Area from "@/modules/company/models/Area";
import OrganizationNode from "@/modules/company/models/OrganizationNode";
import Role from "@/modules/company/models/Role";
import {
  normalizeOrganizationNodeCode,
} from "@/modules/company/submodules/organization/lib/structure";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeCode(value) {
  return normalizeOrganizationNodeCode(value).slice(0, 24);
}

export function deriveAreaCodeFromNode(node = {}) {
  const existingAreaCode = normalizeText(node.areaCode);

  if (existingAreaCode) {
    return existingAreaCode.toUpperCase();
  }

  return normalizeCode(String(node.code || node.title || "").replace(/^AREA[_-]?/i, ""));
}

export function deriveRoleCodeFromNode(node = {}) {
  const existingRoleCode = normalizeText(node.roleCode);

  if (existingRoleCode) {
    return existingRoleCode.toUpperCase();
  }

  return normalizeCode(String(node.code || node.title || "").replace(/^CARGO[_-]?/i, ""));
}

async function resolveAreaForPositionNode(node = {}) {
  const explicitAreaCode = normalizeText(node.areaCode).toUpperCase();

  if (explicitAreaCode) {
    return Area.findOne({ code: explicitAreaCode, isActive: { $ne: false } }).lean();
  }

  if (!node.parentId) {
    return null;
  }

  const parent = await OrganizationNode.findById(node.parentId).lean();
  const parentAreaCode = normalizeText(parent?.areaCode).toUpperCase();

  if (!parentAreaCode) {
    return null;
  }

  if (parent?.nodeType === "area") {
    const { area } = await upsertCatalogFromStructureNode(parent);

    if (area) {
      return area;
    }
  }

  return Area.findOne({ code: parentAreaCode, isActive: { $ne: false } }).lean();
}

export async function upsertCatalogFromStructureNode(node = {}) {
  if (node.nodeType === "area") {
    const areaCode = deriveAreaCodeFromNode(node);
    const areaName = normalizeText(node.title).toUpperCase();

    if (!areaCode || !areaName) {
      return { area: null, role: null };
    }

    const area = await Area.findOneAndUpdate(
      { code: areaCode },
      {
        $set: {
          code: areaCode,
          name: areaName,
          description: normalizeText(node.notes),
          isActive: node.isActive !== false,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );

    await OrganizationNode.updateMany(
      { areaCode: areaCode },
      { $set: { areaName: area.name } },
    );
    await Role.updateMany(
      { areaCode: areaCode },
      { $set: { areaName: area.name } },
    );

    return { area, role: null };
  }

  if (node.nodeType !== "position") {
    return { area: null, role: null };
  }

  const area = await resolveAreaForPositionNode(node);
  const roleCode = deriveRoleCodeFromNode(node);
  const roleName = normalizeText(node.title).toUpperCase();

  if (!area || !roleCode || !roleName) {
    return { area, role: null };
  }

  const parent = node.parentId ? await OrganizationNode.findById(node.parentId).lean() : null;
  const supervisorRoleCode = parent?.nodeType === "position" ? normalizeText(parent.roleCode).toUpperCase() : "";
  const supervisorRoleName = parent?.nodeType === "position" ? normalizeText(parent.roleName || parent.title).toUpperCase() : "";
  const role = await Role.findOneAndUpdate(
    { code: roleCode },
    {
      $set: {
        code: roleCode,
        name: roleName,
        areaCode: area.code,
        areaName: area.name,
        description: normalizeText(node.notes),
        supervisorRoleCode,
        supervisorRoleName,
        isActive: node.isActive !== false,
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  await OrganizationNode.updateMany(
    { roleCode: role.code },
    {
      $set: {
        roleName: role.name,
        areaCode: role.areaCode,
        areaName: role.areaName,
      },
    },
  );

  return { area, role };
}

export async function syncCatalogsFromActiveStructure() {
  const activeNodes = await OrganizationNode.find({ isActive: { $ne: false } })
    .sort({ level: 1, sortOrder: 1, title: 1 })
    .lean();
  const activeAreaCodes = new Set();
  const activeRoleCodes = new Set();
  let areasUpserted = 0;
  let rolesUpserted = 0;

  for (const node of activeNodes.filter((item) => item.nodeType === "area")) {
    const { area } = await upsertCatalogFromStructureNode(node);

    if (area?.code) {
      activeAreaCodes.add(area.code);
      areasUpserted += 1;
    }
  }

  for (const node of activeNodes.filter((item) => item.nodeType === "position")) {
    const { role } = await upsertCatalogFromStructureNode(node);

    if (role?.code) {
      activeRoleCodes.add(role.code);
      rolesUpserted += 1;
    }
  }

  const [areasDeactivated, rolesDeactivated] = await Promise.all([
    activeAreaCodes.size
      ? Area.updateMany(
          { code: { $nin: [...activeAreaCodes] }, isActive: { $ne: false } },
          { $set: { isActive: false } },
        )
      : Area.updateMany({ isActive: { $ne: false } }, { $set: { isActive: false } }),
    activeRoleCodes.size
      ? Role.updateMany(
          { code: { $nin: [...activeRoleCodes] }, isActive: { $ne: false } },
          { $set: { isActive: false } },
        )
      : Role.updateMany({ isActive: { $ne: false } }, { $set: { isActive: false } }),
  ]);

  return {
    areasUpserted,
    rolesUpserted,
    areasDeactivated: areasDeactivated.modifiedCount || 0,
    rolesDeactivated: rolesDeactivated.modifiedCount || 0,
  };
}

export async function activeStructureAreaCodes() {
  const areaCodes = await OrganizationNode.distinct("areaCode", {
    isActive: { $ne: false },
    nodeType: "area",
    areaCode: { $ne: "" },
  });

  return areaCodes.filter(Boolean);
}

export async function activeStructureRoleCodes() {
  const roleCodes = await OrganizationNode.distinct("roleCode", {
    isActive: { $ne: false },
    nodeType: "position",
    roleCode: { $ne: "" },
  });

  return roleCodes.filter(Boolean);
}
