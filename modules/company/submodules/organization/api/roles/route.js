import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { isAuthenticated } from "@/lib/auth";
import {
  normalizeRolePayload,
  resolveUniqueRoleCode,
  serializeRole,
} from "@/modules/company/submodules/organization/lib/roles";
import { normalizeOrganizationNodeCode } from "@/modules/company/submodules/organization/lib/structure";
import connectToDatabase from "@/lib/db/mongodb";
import { Area, OrganizationNode, Role } from "@/modules/company/models";

async function resolveSupervisorRole(supervisorRoleCode) {
  const code = String(supervisorRoleCode || "").trim().toUpperCase();

  if (!code) {
    return null;
  }

  return Role.findOne({ code }).lean();
}

export async function GET() {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  await connectToDatabase();
  const roles = await Role.find({ isActive: { $ne: false } })
    .sort({ areaName: 1, name: 1 })
    .lean();

  return NextResponse.json({
    roles: roles.map(serializeRole),
  });
}

export async function POST(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const body = await request.json();
    const payload = normalizeRolePayload(body);
    const area = await Area.findOne({ code: payload.areaCode }).lean();
    const supervisorRole = await resolveSupervisorRole(payload.supervisorRoleCode);

    if (!area) {
      return NextResponse.json({ error: "El área seleccionada no existe." }, { status: 404 });
    }

    if (payload.supervisorRoleCode && !supervisorRole) {
      return NextResponse.json({ error: "El supervisor seleccionado no existe." }, { status: 404 });
    }

    const existingRoles = await Role.find({}, { code: 1 }).lean();
    const code = resolveUniqueRoleCode(
      payload.code,
      existingRoles.map((role) => role.code),
      payload.name,
    );

    const role = await Role.create({
      ...payload,
      code,
      areaName: area.name,
      supervisorRoleName: supervisorRole?.name || "",
    });
    const areaNode = await OrganizationNode.findOne({
      nodeType: "area",
      areaCode: area.code,
      isActive: { $ne: false },
    }).lean();
    const supervisorNode = role.supervisorRoleCode
      ? await OrganizationNode.findOne({
          nodeType: "position",
          roleCode: role.supervisorRoleCode,
          isActive: { $ne: false },
        }).lean()
      : null;

    await OrganizationNode.findOneAndUpdate(
      { nodeType: "position", roleCode: code },
      {
        $set: {
          code: normalizeOrganizationNodeCode(`CARGO_${code}`),
          title: role.name,
          subtitle: role.areaName || "Cargo funcional",
          nodeType: "position",
          level: supervisorNode ? Math.min(Number(supervisorNode.level || 1) + 1, 10) : 2,
          parentId: supervisorNode?._id?.toString() || areaNode?._id?.toString() || "",
          parentTitle: supervisorNode?.title || areaNode?.title || "",
          areaCode: role.areaCode,
          areaName: role.areaName,
          roleCode: role.code,
          roleName: role.name,
          notes: role.description || "",
          isActive: role.isActive !== false,
        },
        $setOnInsert: {
          responsibleEmployeeId: "",
          responsibleEmployeeName: "",
          sortOrder: 0,
          positionX: null,
          positionY: null,
        },
      },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "role.create",
      entityType: "role",
      entityId: role._id.toString(),
      entityLabel: role.name,
      route: "/api/company/roles",
      details: {
        after: serializeRole(role),
      },
    });

    return NextResponse.json(
      {
        role: serializeRole(role),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error?.code === 11000) {
      const fields = Object.keys(error.keyPattern || {});

      if (fields.includes("code")) {
        return NextResponse.json({ error: "Ya existe un cargo con ese código." }, { status: 409 });
      }

      return NextResponse.json(
        { error: "Ya existe un cargo con ese nombre dentro del área seleccionada." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: error.message || "No se pudo crear el cargo." },
      { status: 400 },
    );
  }
}
