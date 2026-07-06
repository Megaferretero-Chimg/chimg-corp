import { NextResponse } from "next/server";

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

  await connectToDatabase();

  const { id } = await params;
  const existingUser = await User.findById(id).lean();

  if (!existingUser) {
    return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
  }

  if (isReservedUsername(existingUser.username)) {
    return NextResponse.json(
      { error: "El usuario maestro del sistema no se puede eliminar." },
      { status: 403 },
    );
  }

  await User.findByIdAndDelete(id);

  return NextResponse.json({ success: true });
}
