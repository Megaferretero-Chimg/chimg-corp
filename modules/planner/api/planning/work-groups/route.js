import mongoose from "mongoose";
import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { Employee } from "@/modules/company/models";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import { resolvePlannerEmployeeScope } from "@/modules/planner/lib/planning/accessScope";
import { PlanningWorkGroup } from "@/modules/planner/models";

function normalizeId(value) {
  const id = String(value || "").trim();
  return mongoose.isValidObjectId(id) ? id : "";
}

function normalizeText(value) {
  return String(value || "").trim();
}

function groupScopeQuery(scope) {
  if (scope.isCompanyWide) return {};

  const workGroupIds = (scope.workGroupIds || []).map(normalizeId).filter(Boolean);
  const ownerEmployeeId = normalizeId(scope.user?.employeeId);
  const conditions = [];

  if (workGroupIds.length) conditions.push({ _id: { $in: workGroupIds } });
  if (ownerEmployeeId) conditions.push({ ownerEmployee: ownerEmployeeId });

  return conditions.length ? { $or: conditions } : { _id: null };
}

function assertGroupInScope(group, scope) {
  if (scope.isCompanyWide) return;

  const allowedIds = new Set((scope.workGroupIds || []).map(String));
  const ownerEmployeeId = normalizeId(scope.user?.employeeId);
  const isOwned = ownerEmployeeId && String(group?.ownerEmployee || "") === ownerEmployeeId;

  if (!group || (!allowedIds.has(String(group._id)) && !isOwned)) {
    throw new Error("No tienes permiso para gestionar este grupo de trabajo.");
  }
}

function serializeGroup(group = {}, employeesById = new Map()) {
  const members = (group.members || []).map((member) => {
    const employeeId = String(member.employee || member.employeeId || "");
    const employee = employeesById.get(employeeId);

    return {
      employeeId,
      employeeName: employee?.fullName || member.employeeName || "",
      branchCode: employee?.branchCode || group.branchCode || "",
      branchName: employee?.branchName || group.branchName || "",
      areaCode: employee?.areaCode || member.areaCode || "",
      areaName: employee?.areaName || member.areaName || "",
      roleCode: employee?.roleCode || member.roleCode || "",
      roleName: employee?.roleName || member.roleName || "",
      isActive: employee?.isActive !== false,
    };
  }).filter((member) => member.employeeId);
  const ownerEmployeeId = String(group.ownerEmployee || "");
  const owner = employeesById.get(ownerEmployeeId);

  return {
    id: String(group._id || group.id || ""),
    name: group.name || "",
    branchCode: owner?.branchCode || group.branchCode || "",
    branchName: owner?.branchName || group.branchName || "",
    ownerEmployeeId,
    ownerEmployeeName: owner?.fullName || group.ownerEmployeeName || "",
    members,
    memberCount: members.length,
    notes: group.notes || "",
    isActive: group.isActive !== false,
  };
}

async function requestContext(permission) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { response: NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 }) };
  }

  if (!hasAccessPermission(user, permission)) {
    return { response: NextResponse.json({ error: "No tienes permiso para gestionar grupos de trabajo." }, { status: 403 }) };
  }

  await connectToDatabase();
  const scope = await resolvePlannerEmployeeScope();
  return { user, scope };
}

async function employeeDocumentsForGroups(groups = []) {
  const ids = new Set();

  groups.forEach((group) => {
    if (group.ownerEmployee) ids.add(String(group.ownerEmployee));
    (group.members || []).forEach((member) => {
      if (member.employee) ids.add(String(member.employee));
    });
  });

  if (!ids.size) return new Map();

  const employees = await Employee.find({ _id: { $in: [...ids] } })
    .select({ fullName: 1, branchCode: 1, branchName: 1, areaCode: 1, areaName: 1, roleCode: 1, roleName: 1, isActive: 1 })
    .lean();

  return new Map(employees.map((employee) => [String(employee._id), employee]));
}

async function buildGroupPayload(body, scope, { existingGroup = null } = {}) {
  const name = normalizeText(body?.name);
  const ownerEmployeeId = normalizeId(body?.ownerEmployeeId);
  const submittedMemberIds = [...new Set((Array.isArray(body?.memberIds) ? body.memberIds : []).map(normalizeId).filter(Boolean))];

  if (!name) throw new Error("Indica el nombre del grupo de trabajo.");
  if (!ownerEmployeeId) throw new Error("Selecciona la persona responsable del grupo.");

  if (!submittedMemberIds.includes(ownerEmployeeId)) submittedMemberIds.unshift(ownerEmployeeId);

  const employees = await Employee.find({ _id: { $in: submittedMemberIds } })
    .select({ fullName: 1, branchCode: 1, branchName: 1, areaCode: 1, areaName: 1, roleCode: 1, roleName: 1, isActive: 1 })
    .lean();

  if (employees.length !== submittedMemberIds.length) {
    throw new Error("Uno o mas empleados seleccionados no existen.");
  }

  const employeesById = new Map(employees.map((employee) => [String(employee._id), employee]));
  const existingMemberIds = new Set((existingGroup?.members || []).map((member) => String(member.employee || "")));
  const inactiveEmployees = employees.filter((employee) => employee.isActive === false);
  const invalidInactiveEmployee = inactiveEmployees.find((employee) =>
    String(employee._id) === ownerEmployeeId || !existingMemberIds.has(String(employee._id)),
  );

  if (invalidInactiveEmployee) {
    throw new Error("No puedes agregar empleados inactivos al grupo de trabajo.");
  }

  const inactiveEmployeeIds = new Set(inactiveEmployees.map((employee) => String(employee._id)));
  const memberIds = submittedMemberIds.filter((employeeId) => !inactiveEmployeeIds.has(employeeId));

  if (!scope.isCompanyWide) {
    const allowedEmployeeIds = scope.employeeIdSet || new Set(scope.employeeIds || []);
    const invalidEmployeeId = memberIds.find((employeeId) => !allowedEmployeeIds.has(employeeId));

    if (invalidEmployeeId) {
      throw new Error("El grupo contiene empleados fuera de tu alcance de planificacion.");
    }
  }

  const owner = employeesById.get(ownerEmployeeId);

  return {
    name,
    branchCode: owner?.branchCode || "",
    branchName: owner?.branchName || "",
    ownerEmployee: ownerEmployeeId,
    ownerEmployeeName: owner?.fullName || "",
    members: memberIds.map((employeeId) => {
      const employee = employeesById.get(employeeId);

      return {
        employee: employeeId,
        employeeName: employee.fullName || "",
        areaCode: employee.areaCode || "",
        areaName: employee.areaName || "",
        roleCode: employee.roleCode || "",
        roleName: employee.roleName || "",
      };
    }),
    notes: normalizeText(body?.notes),
    isActive: body?.isActive !== false,
  };
}

export async function GET() {
  const context = await requestContext("planner.settings.view");
  if (context.response) return context.response;

  try {
    const groups = await PlanningWorkGroup.find(groupScopeQuery(context.scope))
      .sort({ isActive: -1, branchName: 1, name: 1 })
      .lean();
    const employeesById = await employeeDocumentsForGroups(groups);

    return NextResponse.json({
      groups: groups.map((group) => serializeGroup(group, employeesById)),
      canManage: hasAccessPermission(context.user, "planner.settings.manage"),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudieron cargar los grupos de trabajo." }, { status: 400 });
  }
}

export async function POST(request) {
  const context = await requestContext("planner.settings.manage");
  if (context.response) return context.response;

  try {
    const body = await request.json();
    const payload = await buildGroupPayload(body, context.scope);
    const duplicate = await PlanningWorkGroup.exists({
      ...groupScopeQuery(context.scope),
      name: { $regex: `^${payload.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
      isActive: { $ne: false },
    });

    if (duplicate) throw new Error("Ya existe un grupo activo con ese nombre.");

    const group = await PlanningWorkGroup.create(payload);
    const employeesById = await employeeDocumentsForGroups([group.toObject()]);

    return NextResponse.json(
      { message: "Grupo de trabajo creado correctamente.", group: serializeGroup(group.toObject(), employeesById) },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudo crear el grupo de trabajo." }, { status: 400 });
  }
}

export async function PATCH(request) {
  const context = await requestContext("planner.settings.manage");
  if (context.response) return context.response;

  try {
    const body = await request.json();
    const groupId = normalizeId(body?.id);
    if (!groupId) throw new Error("Grupo de trabajo invalido.");

    const group = await PlanningWorkGroup.findById(groupId);
    assertGroupInScope(group, context.scope);
    const payload = await buildGroupPayload(body, context.scope, { existingGroup: group });
    const duplicate = await PlanningWorkGroup.exists({
      ...groupScopeQuery(context.scope),
      _id: { $ne: groupId },
      name: { $regex: `^${payload.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
      isActive: { $ne: false },
    });

    if (duplicate) throw new Error("Ya existe otro grupo activo con ese nombre.");

    group.set(payload);
    await group.save();
    const employeesById = await employeeDocumentsForGroups([group.toObject()]);

    return NextResponse.json({
      message: "Grupo de trabajo actualizado correctamente.",
      group: serializeGroup(group.toObject(), employeesById),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudo actualizar el grupo de trabajo." }, { status: 400 });
  }
}

export async function DELETE(request) {
  const context = await requestContext("planner.settings.manage");
  if (context.response) return context.response;

  try {
    const body = await request.json();
    const groupId = normalizeId(body?.id);
    if (!groupId) throw new Error("Grupo de trabajo invalido.");

    const group = await PlanningWorkGroup.findById(groupId);
    assertGroupInScope(group, context.scope);
    group.isActive = false;
    await group.save();

    return NextResponse.json({ message: "Grupo de trabajo desactivado correctamente." });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudo desactivar el grupo de trabajo." }, { status: 400 });
  }
}
