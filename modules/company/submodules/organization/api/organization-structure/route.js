import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import {
  ORGANIZATION_LEVELS,
  ORGANIZATION_NODE_TYPES,
  inferOrganizationNodeLevel,
  normalizeOrganizationNodeCode,
  normalizeOrganizationNodePayload,
  serializeOrganizationNode,
} from "@/modules/company/submodules/organization/lib/structure";
import {
  deriveAreaCodeFromNode,
  deriveRoleCodeFromNode,
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

function prepareCatalogBackedPayload(payload, refs) {
  if (payload.nodeType === "area") {
    const areaCode = deriveAreaCodeFromNode(payload);

    return {
      ...payload,
      code: payload.code || normalizeOrganizationNodeCode(`AREA_${areaCode}`),
      areaCode,
      areaName: payload.title,
      roleCode: "",
      roleName: "",
    };
  }

  if (payload.nodeType === "position") {
    const parentAreaCode = refs.parent?.areaCode || "";
    const roleCode = deriveRoleCodeFromNode(payload);

    return {
      ...payload,
      code: payload.code || normalizeOrganizationNodeCode(`CARGO_${roleCode}`),
      areaCode: payload.areaCode || parentAreaCode,
      areaName: payload.areaName || refs.parent?.areaName || "",
      roleCode,
      roleName: payload.title,
    };
  }

  return payload;
}

function serializeEmployeeOption(employee) {
  return {
    id: employee._id.toString(),
    fullName: employee.fullName || "",
    dni: employee.dni || "",
    areaName: employee.areaName || "",
    roleName: employee.roleName || "",
  };
}

export async function GET(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "company.structure.view")) {
    return NextResponse.json({ error: "No tienes permiso para ver la estructura organizacional." }, { status: 403 });
  }

  await connectToDatabase();
  const { searchParams } = new URL(request.url);

  if (searchParams.get("resource") === "employees") {
    const employees = await Employee.find({ isActive: { $ne: false } })
      .select("fullName dni areaName roleName")
      .sort({ fullName: 1 })
      .lean();

    return NextResponse.json({
      employees: employees.map(serializeEmployeeOption),
    });
  }

  const [nodes, areas, roles] = await Promise.all([
    OrganizationNode.find({ isActive: { $ne: false } })
      .select("code title subtitle nodeType level parentId parentTitle areaCode areaName roleCode roleName responsibleEmployeeId responsibleEmployeeName sortOrder positionX positionY width height notes isActive createdAt updatedAt")
      .sort({ level: 1, sortOrder: 1, title: 1 })
      .lean(),
    Area.find({ isActive: { $ne: false } })
      .select("code name")
      .sort({ name: 1 })
      .lean(),
    Role.find({ isActive: { $ne: false } })
      .select("code name areaCode areaName")
      .sort({ name: 1 })
      .lean(),
  ]);
  const serializedNodes = nodes.map(serializeOrganizationNode);

  return NextResponse.json({
    nodes: serializedNodes,
    canManage: hasAccessPermission(user, "company.structure.manage"),
    nodeTypes: ORGANIZATION_NODE_TYPES,
    levels: ORGANIZATION_LEVELS,
    areas: areas.map((area) => ({
      id: area._id.toString(),
      code: area.code || "",
      name: area.name || "",
    })),
    roles: roles.map((role) => ({
      id: role._id.toString(),
      code: role.code || "",
      name: role.name || "",
      areaCode: role.areaCode || "",
      areaName: role.areaName || "",
    })),
    employees: [],
  });
}

export async function POST(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "company.structure.manage")) {
    return NextResponse.json({ error: "No tienes permiso para editar la estructura organizacional." }, { status: 403 });
  }

  try {
    await connectToDatabase();

    const body = await request.json();
    const refs = await resolveReferences(body);
    let payload = normalizeOrganizationNodePayload(body, refs);
    payload = prepareCatalogBackedPayload(payload, refs);
    payload.level = inferOrganizationNodeLevel(refs.parent);
    const node = await OrganizationNode.create(payload);
    const synced = await upsertCatalogFromStructureNode(node);

    if (synced.area || synced.role) {
      const patch = {
        ...(synced.area
          ? {
              areaCode: synced.area.code,
              areaName: synced.area.name,
            }
          : {}),
        ...(synced.role
          ? {
              roleCode: synced.role.code,
              roleName: synced.role.name,
              areaCode: synced.role.areaCode,
              areaName: synced.role.areaName,
            }
          : {}),
      };

      if (Object.keys(patch).length) {
        await OrganizationNode.findByIdAndUpdate(node._id, { $set: patch }, { runValidators: true });
        Object.assign(node, patch);
      }
    }
    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "organization_structure.create",
      entityType: "organization_node",
      entityId: node._id.toString(),
      entityLabel: node.title,
      route: "/api/company/organization-structure",
      details: { after: serializeOrganizationNode(node) },
    });

    return NextResponse.json({ node: serializeOrganizationNode(node) }, { status: 201 });
  } catch (error) {
    if (error?.code === 11000) {
      return NextResponse.json({ error: "Ya existe un nodo con ese código." }, { status: 409 });
    }

    return NextResponse.json(
      { error: error.message || "No se pudo crear el nodo de estructura." },
      { status: 400 },
    );
  }
}
