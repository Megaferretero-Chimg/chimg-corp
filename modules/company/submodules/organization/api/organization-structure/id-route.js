import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  inferOrganizationNodeLevel,
  normalizeOrganizationNodePayload,
  serializeOrganizationNode,
} from "@/modules/company/submodules/organization/lib/structure";
import {
  syncCatalogsFromActiveStructure,
  upsertCatalogFromStructureNode,
} from "@/modules/company/submodules/organization/lib/structureCatalogSync";
import { Area, Employee, OrganizationNode, Role } from "@/modules/company/models";

async function resolveReferences(body, currentNodeId = "") {
  const parentId = String(body?.parentId || "").trim();
  const areaCode = String(body?.areaCode || "").trim();
  const roleCode = String(body?.roleCode || "").trim();
  const responsibleEmployeeId = String(body?.responsibleEmployeeId || "").trim();

  const [parent, area, role, employee] = await Promise.all([
    parentId && parentId !== currentNodeId ? OrganizationNode.findById(parentId).lean() : null,
    areaCode ? Area.findOne({ code: areaCode }).lean() : null,
    roleCode ? Role.findOne({ code: roleCode }).lean() : null,
    responsibleEmployeeId ? Employee.findById(responsibleEmployeeId).lean() : null,
  ]);

  return { parent, area, role, employee };
}

async function assertNoCircularParent(nodeId, nextParentId) {
  if (!nextParentId) {
    return;
  }

  let cursorId = nextParentId;
  const visited = new Set();

  while (cursorId) {
    if (cursorId === nodeId) {
      throw new Error("No puedes conectar un nodo debajo de uno de sus propios descendientes.");
    }

    if (visited.has(cursorId)) {
      throw new Error("La estructura contiene una conexión circular.");
    }

    visited.add(cursorId);
    const parent = await OrganizationNode.findById(cursorId).select("parentId").lean();
    cursorId = parent?.parentId || "";
  }
}

async function updateDescendantLevels(rootNodeId, rootLevel) {
  const allNodes = await OrganizationNode.find({})
    .select("_id parentId level")
    .lean();
  const childrenByParentId = new Map();

  for (const node of allNodes) {
    if (!node.parentId) {
      continue;
    }

    const siblings = childrenByParentId.get(node.parentId) || [];
    siblings.push(node);
    childrenByParentId.set(node.parentId, siblings);
  }

  const operations = [];
  const queue = (childrenByParentId.get(rootNodeId) || []).map((node) => ({
    node,
    level: inferOrganizationNodeLevel({ level: rootLevel }),
  }));

  while (queue.length) {
    const { node, level } = queue.shift();
    const nodeId = node._id.toString();

    if (node.level !== level) {
      operations.push({
        updateOne: {
          filter: { _id: node._id },
          update: { $set: { level } },
        },
      });
    }

    for (const child of childrenByParentId.get(nodeId) || []) {
      queue.push({
        node: child,
        level: inferOrganizationNodeLevel({ level }),
      });
    }
  }

  if (operations.length) {
    await OrganizationNode.collection.bulkWrite(operations);
  }
}

async function updateNodeRelationship(existingNode, body, nodeId) {
  const parentId = String(body?.parentId || "").trim();
  const parent = parentId && parentId !== nodeId
    ? await OrganizationNode.findById(parentId).lean()
    : null;
  const inferredAreaCode = existingNode.nodeType === "area"
    ? existingNode.areaCode
    : parent?.nodeType === "area"
      ? parent.areaCode
      : "";
  const areaCode = body?.areaCode === undefined
    ? inferredAreaCode
    : String(body.areaCode || "").trim();
  const area = areaCode ? await Area.findOne({ code: areaCode }).lean() : null;
  const positionX = Number(body?.positionX);
  const positionY = Number(body?.positionY);
  const nextValues = {
    parentId: parent?._id?.toString() || "",
    parentTitle: parent?.title || "",
    level: inferOrganizationNodeLevel(parent),
    areaCode: area?.code || "",
    areaName: area?.name || "",
  };

  if (Number.isFinite(positionX) && Number.isFinite(positionY)) {
    nextValues.positionX = Math.max(0, Math.round(positionX));
    nextValues.positionY = Math.max(0, Math.round(positionY));
  }

  await assertNoCircularParent(nodeId, nextValues.parentId);
  await OrganizationNode.findByIdAndUpdate(nodeId, { $set: nextValues }, {
    new: true,
    runValidators: true,
  });
  await updateDescendantLevels(nodeId, nextValues.level);
  const node = await OrganizationNode.findById(nodeId);
  await upsertCatalogFromStructureNode(node);

  if (existingNode.nodeType === "position" && existingNode.roleCode) {
    await Role.findOneAndUpdate(
      { code: existingNode.roleCode },
      {
        $set: {
          supervisorRoleCode: parent?.nodeType === "position" ? parent.roleCode || "" : "",
          supervisorRoleName: parent?.nodeType === "position" ? parent.roleName || parent.title || "" : "",
        },
      },
      { runValidators: true },
    );
  }

  const actor = await resolveAuditActor();

  await createAuditLog({
    actor,
    action: "organization_structure.relationship_update",
    entityType: "organization_node",
    entityId: node._id.toString(),
    entityLabel: node.title,
    route: `/api/company/organization-structure/${nodeId}`,
    details: {
      before: serializeOrganizationNode(existingNode),
      after: serializeOrganizationNode(node),
    },
  });

  return node;
}

async function guardManageStructure() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "company.structure.manage")) {
    return NextResponse.json({ error: "No tienes permiso para editar la estructura organizacional." }, { status: 403 });
  }

  return null;
}

export async function PATCH(request, { params }) {
  const blockedResponse = await guardManageStructure();

  if (blockedResponse) {
    return blockedResponse;
  }

  try {
    await connectToDatabase();

    const { id } = await params;
    const body = await request.json();
    const existingNode = await OrganizationNode.findById(id).lean();

    if (!existingNode) {
      return NextResponse.json({ error: "Nodo de estructura no encontrado." }, { status: 404 });
    }

    if (body?.action === "update-position") {
      const positionX = Number(body.positionX);
      const positionY = Number(body.positionY);
      const width = Number(body.width);
      const height = Number(body.height);

      if (!Number.isFinite(positionX) || !Number.isFinite(positionY)) {
        return NextResponse.json({ error: "La posición enviada no es válida." }, { status: 400 });
      }

      const nextPosition = {
        positionX: Math.max(0, Math.round(positionX)),
        positionY: Math.max(0, Math.round(positionY)),
      };

      if (Number.isFinite(width) && Number.isFinite(height)) {
        nextPosition.width = Math.max(144, Math.round(width));
        nextPosition.height = Math.max(94, Math.round(height));
      }

      await OrganizationNode.collection.updateOne(
        { _id: existingNode._id },
        {
          $set: nextPosition,
        },
      );
      const node = {
        ...existingNode,
        ...nextPosition,
      };

      return NextResponse.json({ node: serializeOrganizationNode(node) });
    }

    if (body?.action === "update-relationship") {
      const node = await updateNodeRelationship(existingNode, body, id);

      return NextResponse.json({ node: serializeOrganizationNode(node) });
    }

    const refs = await resolveReferences(body, id);
    await assertNoCircularParent(id, refs.parent?._id?.toString() || "");
    const payload = normalizeOrganizationNodePayload(body, refs);
    payload.level = inferOrganizationNodeLevel(refs.parent);
    await OrganizationNode.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });
    const updatedNodeForCatalog = await OrganizationNode.findById(id);
    await upsertCatalogFromStructureNode(updatedNodeForCatalog);
    await updateDescendantLevels(id, payload.level);
    const node = await OrganizationNode.findById(id);
    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "organization_structure.update",
      entityType: "organization_node",
      entityId: node._id.toString(),
      entityLabel: node.title,
      route: `/api/company/organization-structure/${id}`,
      details: {
        before: serializeOrganizationNode(existingNode),
        after: serializeOrganizationNode(node),
      },
    });

    return NextResponse.json({ node: serializeOrganizationNode(node) });
  } catch (error) {
    if (error?.code === 11000) {
      return NextResponse.json({ error: "Ya existe un nodo con ese código." }, { status: 409 });
    }

    return NextResponse.json(
      { error: error.message || "No se pudo actualizar el nodo de estructura." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request, { params }) {
  const blockedResponse = await guardManageStructure();

  if (blockedResponse) {
    return blockedResponse;
  }

  await connectToDatabase();

  const { id } = await params;
  const node = await OrganizationNode.findByIdAndDelete(id);

  if (!node) {
    return NextResponse.json({ error: "Nodo de estructura no encontrado." }, { status: 404 });
  }

  const children = await OrganizationNode.find({ parentId: id }).select("_id").lean();
  await OrganizationNode.updateMany(
    { parentId: id },
    { $set: { parentId: "", parentTitle: "", level: 1 } },
  );
  await Promise.all(
    children.map((child) => updateDescendantLevels(child._id.toString(), 1)),
  );
  await syncCatalogsFromActiveStructure();
  const actor = await resolveAuditActor();

  await createAuditLog({
    actor,
    action: "organization_structure.delete",
    entityType: "organization_node",
    entityId: node._id.toString(),
    entityLabel: node.title,
    route: `/api/company/organization-structure/${id}`,
    details: { deleted: serializeOrganizationNode(node) },
  });

  return NextResponse.json({ success: true });
}
