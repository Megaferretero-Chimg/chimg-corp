import mongoose from "mongoose";

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

function roleNameFromNode(node = {}) {
  return String(node.roleName || node.title || "").trim().toUpperCase();
}

function chooseRelation(currentRelation, nextRelation) {
  if (!currentRelation) {
    return nextRelation;
  }

  if (!currentRelation.supervisorRoleCode && nextRelation.supervisorRoleCode) {
    return nextRelation;
  }

  return currentRelation;
}

async function main() {
  await mongoose.connect(requireEnv("MONGODB_URI"));

  const db = mongoose.connection.db;
  const organizationNodes = db.collection("organizationnodes");
  const roles = db.collection("roles");

  const nodes = await organizationNodes
    .find({})
    .project({
      title: 1,
      nodeType: 1,
      roleCode: 1,
      roleName: 1,
      parentId: 1,
      parentTitle: 1,
    })
    .toArray();
  const nodesById = new Map(nodes.map((node) => [String(node._id), node]));
  const relationsByRoleCode = new Map();
  const conflicts = [];

  nodes
    .filter((node) => node.nodeType === "position" && normalizeCode(node.roleCode))
    .forEach((node) => {
      const roleCode = normalizeCode(node.roleCode);
      const parent = node.parentId ? nodesById.get(String(node.parentId)) : null;
      const supervisorRoleCode = parent?.nodeType === "position" ? normalizeCode(parent.roleCode) : "";
      const supervisorRoleName = supervisorRoleCode ? roleNameFromNode(parent) : "";
      const relation = {
        roleCode,
        roleName: roleNameFromNode(node),
        supervisorRoleCode,
        supervisorRoleName,
      };
      const currentRelation = relationsByRoleCode.get(roleCode);

      if (
        currentRelation?.supervisorRoleCode &&
        supervisorRoleCode &&
        currentRelation.supervisorRoleCode !== supervisorRoleCode
      ) {
        conflicts.push({
          roleCode,
          firstSupervisor: currentRelation.supervisorRoleCode,
          nextSupervisor: supervisorRoleCode,
        });
      }

      relationsByRoleCode.set(roleCode, chooseRelation(currentRelation, relation));
    });

  const operations = [...relationsByRoleCode.values()].map((relation) => ({
    updateOne: {
      filter: { code: relation.roleCode },
      update: {
        $set: {
          supervisorRoleCode: relation.supervisorRoleCode,
          supervisorRoleName: relation.supervisorRoleName,
        },
        $currentDate: { updatedAt: true },
      },
    },
  }));

  const result = operations.length ? await roles.bulkWrite(operations, { ordered: false }) : {};
  const updatedRoles = await roles
    .find({ code: { $in: [...relationsByRoleCode.keys()] } })
    .project({ code: 1, name: 1, supervisorRoleCode: 1, supervisorRoleName: 1 })
    .sort({ code: 1 })
    .toArray();

  console.log(JSON.stringify(
    {
      matched: result.matchedCount || 0,
      modified: result.modifiedCount || 0,
      relations: relationsByRoleCode.size,
      conflicts,
      supervisors: updatedRoles
        .filter((role) => role.supervisorRoleCode)
        .map((role) => ({
          code: role.code,
          name: role.name,
          supervisorRoleCode: role.supervisorRoleCode,
          supervisorRoleName: role.supervisorRoleName,
        })),
    },
    null,
    2,
  ));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
