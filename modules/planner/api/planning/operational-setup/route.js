import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import { seedOperationalSetup } from "@/modules/planner/lib/planning/operationalSetup";
import { PlanningWorkGroup } from "@/modules/planner/models";

function serializeWorkGroup(group = {}) {
  const members = (group.members || []).map((member) => ({
    employeeId: member.employee?.toString?.() || member.employeeId || "",
    employeeName: member.employeeName || "",
    areaCode: member.areaCode || "",
    areaName: member.areaName || "",
    roleCode: member.roleCode || "",
    roleName: member.roleName || "",
  })).filter((member) => member.employeeId);

  return {
    id: group._id?.toString?.() || group.id || "",
    name: group.name || "",
    branchCode: group.branchCode || "",
    branchName: group.branchName || "",
    ownerEmployeeId: group.ownerEmployee?.toString?.() || "",
    ownerEmployeeName: group.ownerEmployeeName || "",
    members,
    memberCount: members.length,
    notes: group.notes || "",
    isActive: group.isActive !== false,
  };
}

export async function GET(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.schedules.view") && !hasAccessPermission(user, "planner.settings.view")) {
    return NextResponse.json({ error: "No tienes permiso para consultar grupos de trabajo." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);

  if (searchParams.get("resource") !== "work-groups") {
    return NextResponse.json({ error: "Recurso no soportado." }, { status: 400 });
  }

  try {
    await connectToDatabase();

    const groups = await PlanningWorkGroup.find({ isActive: { $ne: false } })
      .sort({ branchName: 1, name: 1 })
      .lean();

    return NextResponse.json({ groups: groups.map(serializeWorkGroup) });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron cargar los grupos de trabajo." },
      { status: 400 },
    );
  }
}

export async function POST() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "planner.settings.manage")) {
    return NextResponse.json({ error: "No tienes permiso para gestionar la configuracion de planificacion." }, { status: 403 });
  }

  try {
    await connectToDatabase();

    const summary = await seedOperationalSetup();

    return NextResponse.json({
      message: "Catalogo operativo inicial cargado correctamente.",
      summary,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo cargar el catalogo operativo inicial." },
      { status: 400 },
    );
  }
}
