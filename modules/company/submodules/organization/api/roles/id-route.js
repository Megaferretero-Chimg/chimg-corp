import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { isAuthenticated } from "@/lib/auth";
import {
  normalizeRolePayload,
  resolveUniqueRoleCode,
  serializeRole,
} from "@/modules/company/submodules/organization/lib/roles";
import { normalizeOrganizationNodeCode } from "@/modules/company/submodules/organization/lib/structure";
import { syncCatalogsFromActiveStructure } from "@/modules/company/submodules/organization/lib/structureCatalogSync";
import connectToDatabase from "@/lib/db/mongodb";
import { Area, OrganizationNode, Role } from "@/modules/company/models";

async function resolveSupervisorRole(supervisorRoleCode) {
  const code = String(supervisorRoleCode || "").trim().toUpperCase();

  if (!code) {
    return null;
  }

  return Role.findOne({ code }).lean();
}

async function assertNoCircularSupervisor(roleId, supervisorRoleCode) {
  if (!supervisorRoleCode) {
    return;
  }

  const role = await Role.findById(roleId).select("code").lean();
  const roleCode = String(role?.code || "").trim().toUpperCase();
  let cursorCode = String(supervisorRoleCode || "").trim().toUpperCase();
  const visited = new Set();

  while (cursorCode) {
    if (cursorCode === roleCode) {
      throw new Error("No puedes definir como supervisor un cargo que depende de este mismo cargo.");
    }

    if (visited.has(cursorCode)) {
      throw new Error("La jerarquía de cargos contiene una relación circular.");
    }

    visited.add(cursorCode);
    const cursorRole = await Role.findOne({ code: cursorCode }).select("supervisorRoleCode").lean();
    cursorCode = String(cursorRole?.supervisorRoleCode || "").trim().toUpperCase();
  }
}

export async function PATCH(request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const { id } = await context.params;
    const body = await request.json();
    const existingRole = await Role.findById(id).lean();

    if (!existingRole) {
      return NextResponse.json({ error: "Cargo no encontrado." }, { status: 404 });
    }

    const payload = normalizeRolePayload(body);
    const area = await Area.findOne({ code: payload.areaCode }).lean();
    const supervisorRole = await resolveSupervisorRole(payload.supervisorRoleCode);

    if (!area) {
      return NextResponse.json({ error: "El área seleccionada no existe." }, { status: 404 });
    }

    if (payload.supervisorRoleCode && !supervisorRole) {
      return NextResponse.json({ error: "El supervisor seleccionado no existe." }, { status: 404 });
    }

    if (supervisorRole?._id?.toString() === id) {
      return NextResponse.json({ error: "Un cargo no puede supervisarse a sí mismo." }, { status: 400 });
    }

    await assertNoCircularSupervisor(id, payload.supervisorRoleCode);

    const existingRoles = await Role.find({ _id: { $ne: id } }, { code: 1 }).lean();
    const code = resolveUniqueRoleCode(
      payload.code,
      existingRoles.map((role) => role.code),
      payload.name,
    );

    const role = await Role.findByIdAndUpdate(
      id,
      {
        ...payload,
        code,
        areaName: area.name,
        supervisorRoleName: supervisorRole?.name || "",
      },
      { new: true, runValidators: true },
    );

    if (existingRole.code !== role.code || existingRole.name !== role.name) {
      await Role.updateMany(
        { supervisorRoleCode: existingRole.code },
        { $set: { supervisorRoleCode: role.code, supervisorRoleName: role.name } },
      );
    }
    const areaNode = await OrganizationNode.findOne({
      nodeType: "area",
      areaCode: role.areaCode,
      isActive: { $ne: false },
    }).lean();
    const supervisorNode = role.supervisorRoleCode
      ? await OrganizationNode.findOne({
          nodeType: "position",
          roleCode: role.supervisorRoleCode,
          isActive: { $ne: false },
        }).lean()
      : null;

    await OrganizationNode.updateMany(
      { roleCode: existingRole.code },
      {
        $set: {
          code: normalizeOrganizationNodeCode(`CARGO_${role.code}`),
          title: role.name,
          subtitle: role.areaName || "Cargo funcional",
          parentId: supervisorNode?._id?.toString() || areaNode?._id?.toString() || "",
          parentTitle: supervisorNode?.title || areaNode?.title || "",
          areaCode: role.areaCode,
          areaName: role.areaName,
          roleCode: role.code,
          roleName: role.name,
          notes: role.description || "",
          isActive: role.isActive !== false,
        },
      },
    );

    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "role.update",
      entityType: "role",
      entityId: role._id.toString(),
      entityLabel: role.name,
      route: `/api/company/roles/${id}`,
      details: {
        before: serializeRole(existingRole),
        after: serializeRole(role),
      },
    });

    return NextResponse.json({
      role: serializeRole(role),
    });
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
      { error: error.message || "No se pudo actualizar el cargo." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  await connectToDatabase();
  const { id } = await context.params;
  const role = await Role.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true });

  if (!role) {
    return NextResponse.json({ error: "Cargo no encontrado." }, { status: 404 });
  }

  const actor = await resolveAuditActor();

  await Role.updateMany(
    { supervisorRoleCode: role.code },
    { $set: { supervisorRoleCode: "", supervisorRoleName: "" } },
  );
  await OrganizationNode.updateMany(
    { roleCode: role.code },
    { $set: { isActive: false } },
  );
  await syncCatalogsFromActiveStructure();

  await createAuditLog({
    actor,
    action: "role.delete",
    entityType: "role",
    entityId: role._id.toString(),
    entityLabel: role.name,
    route: `/api/company/roles/${id}`,
    details: {
      deleted: serializeRole(role),
    },
  });

  return NextResponse.json({ success: true });
}
