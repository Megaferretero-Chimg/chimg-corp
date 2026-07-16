import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import { isReservedUsername, normalizeUserPayload, serializeUser } from "@/modules/company/submodules/access/lib/users";
import { Employee, User, UserType } from "@/modules/company/models";

export async function PATCH(request, { params }) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "company.users.manage")) {
    return NextResponse.json({ error: "No tienes permiso para administrar usuarios." }, { status: 403 });
  }

  try {
    await connectToDatabase();

    const { id } = await params;
    const body = await request.json();
    const existingUser = await User.findById(id).lean();

    if (!existingUser) {
      return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
    }

    if (isReservedUsername(existingUser.username)) {
      return NextResponse.json(
        { error: "El usuario maestro del sistema no se puede editar." },
        { status: 403 },
      );
    }

    if (body?.action === "reactivate") {
      if (existingUser.isActive !== false) {
        return NextResponse.json({
          success: true,
          action: "already_active",
          message: "El acceso ya estaba activo.",
          user: serializeUser(existingUser),
        });
      }

      const linkedEmployee = existingUser.employeeId
        ? await Employee.findById(existingUser.employeeId).select({ isActive: 1 }).lean()
        : null;

      if (existingUser.employeeId && (!linkedEmployee || linkedEmployee.isActive === false)) {
        return NextResponse.json(
          { error: "No puedes activar el acceso porque el empleado vinculado está inactivo." },
          { status: 409 },
        );
      }

      const requestedAccessRole = String(body?.accessRole || existingUser.accessRole || "").trim().toLowerCase();
      const activeUserType = await UserType.findOne({
        code: requestedAccessRole,
        isActive: { $ne: false },
      }).select({ code: 1, name: 1 }).lean();

      if (!activeUserType) {
        return NextResponse.json(
          { error: "Selecciona un perfil de acceso vigente para activar nuevamente al usuario." },
          { status: 409 },
        );
      }

      const reactivatedUser = await User.findByIdAndUpdate(
        id,
        {
          $set: {
            isActive: true,
            accessRole: activeUserType.code,
            accessRoleLabel: activeUserType.name,
          },
        },
        { new: true, runValidators: true },
      ).lean();
      const actor = await resolveAuditActor();

      await createAuditLog({
        actor,
        action: "userAccess.reactivate",
        entityType: "user",
        entityId: id,
        entityLabel: existingUser.username || id,
        route: `/api/company/users/${id}`,
        details: {
          employeeId: existingUser.employeeId || "",
          employeeName: existingUser.employeeName || "",
          username: existingUser.username || "",
          before: {
            isActive: false,
            accessRole: existingUser.accessRole || "",
          },
          after: {
            isActive: true,
            accessRole: activeUserType.code,
          },
        },
      });

      return NextResponse.json({
        success: true,
        action: "reactivated",
        message: "Acceso de usuario activado nuevamente.",
        user: serializeUser(reactivatedUser),
      });
    }

    if (existingUser.isActive === false) {
      return NextResponse.json(
        { error: "El usuario está inactivo. Actívalo antes de modificar sus datos." },
        { status: 409 },
      );
    }

    const employeeId = String(body?.employeeId || "").trim();
    const employee = employeeId ? await Employee.findById(employeeId).lean() : null;
    const userType = await UserType.findOne({
      code: String(body?.accessRole || "").trim().toLowerCase(),
    }).lean();
    const payload = normalizeUserPayload(body, { employee, userType, isEditing: true });

    const user = await User.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });

    return NextResponse.json({
      user: serializeUser(user),
    });
  } catch (error) {
    if (error?.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const messages = {
        employeeId: "Este empleado ya tiene un usuario asignado.",
        username: "Ya existe un usuario con ese nombre de acceso.",
        email: "Ya existe un usuario con ese email.",
      };

      return NextResponse.json(
        { error: messages[field] || "Ya existe un usuario con esos datos." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: error.message || "No se pudo actualizar el usuario." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request, { params }) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "company.users.manage")) {
    return NextResponse.json({ error: "No tienes permiso para administrar usuarios." }, { status: 403 });
  }

  try {
    await connectToDatabase();

    const { id } = await params;
    const existingUser = await User.findById(id).lean();

    if (!existingUser) {
      return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
    }

    if (isReservedUsername(existingUser.username)) {
      return NextResponse.json(
        { error: "El usuario maestro del sistema no se puede desactivar." },
        { status: 403 },
      );
    }

    if (existingUser.isActive === false) {
      return NextResponse.json({
        success: true,
        action: "already_inactive",
        message: "El acceso ya estaba desactivado.",
      });
    }

    const deactivatedUser = await User.findByIdAndUpdate(
      id,
      { $set: { isActive: false } },
      { new: true, runValidators: true },
    ).lean();
    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "userAccess.deactivate",
      entityType: "user",
      entityId: id,
      entityLabel: existingUser.username || id,
      route: `/api/company/users/${id}`,
      details: {
        employeeId: existingUser.employeeId || "",
        employeeName: existingUser.employeeName || "",
        username: existingUser.username || "",
        accessRole: existingUser.accessRole || "",
        before: { isActive: true },
        after: { isActive: false },
      },
    });

    return NextResponse.json({
      success: true,
      action: "deactivated",
      message: "Acceso de usuario desactivado correctamente.",
      user: serializeUser(deactivatedUser),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo desactivar el usuario." },
      { status: 400 },
    );
  }
}
