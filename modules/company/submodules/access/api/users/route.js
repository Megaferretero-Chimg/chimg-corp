import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";
import { normalizeUserPayload, serializeUser } from "@/modules/company/submodules/access/lib/users";
import { Employee, User, UserType } from "@/modules/company/models";

export async function GET() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "company.users.view")) {
    return NextResponse.json({ error: "No tienes permiso para ver usuarios." }, { status: 403 });
  }

  await connectToDatabase();

  const users = await User.find({}).sort({ employeeName: 1 }).lean();

  return NextResponse.json({
    users: users.map(serializeUser),
  });
}

export async function POST(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "company.users.manage")) {
    return NextResponse.json({ error: "No tienes permiso para administrar usuarios." }, { status: 403 });
  }

  try {
    await connectToDatabase();

    const body = await request.json();
    const employeeId = String(body?.employeeId || "").trim();
    const employee = employeeId ? await Employee.findById(employeeId).lean() : null;
    const userType = await UserType.findOne({
      code: String(body?.accessRole || "").trim().toLowerCase(),
    }).lean();
    const payload = normalizeUserPayload(body, { employee, userType });
    const user = await User.create(payload);

    return NextResponse.json(
      {
        user: serializeUser(user),
      },
      { status: 201 },
    );
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
      { error: error.message || "No se pudo crear el usuario." },
      { status: 400 },
    );
  }
}
