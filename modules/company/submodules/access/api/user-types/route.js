import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  DEFAULT_USER_TYPES,
  normalizeUserTypePayload,
  serializeUserType,
} from "@/modules/company/submodules/access/lib/user-types";
import {
  ACCESS_PERMISSION_CATALOG,
  ACCESS_SCOPE_TYPES,
  hasAccessPermission,
} from "@/modules/company/submodules/access/lib/permissions";
import { UserType } from "@/modules/company/models";

async function ensureDefaultUserTypes() {
  const adminUserType = DEFAULT_USER_TYPES.find((userType) => userType.code === "admin");

  await Promise.all(
    DEFAULT_USER_TYPES.flatMap((userType) => [
      UserType.updateOne(
        { code: userType.code },
        { $setOnInsert: userType },
        { upsert: true },
      ),
      UserType.updateOne(
        {
          code: userType.code,
          $or: [
            { permissions: { $exists: false } },
            { permissions: { $size: 0 } },
          ],
        },
        {
          $set: {
            permissions: userType.permissions,
            scopeType: userType.scopeType,
            landingPath: userType.landingPath,
          },
        },
      ),
    ]),
  );

  if (adminUserType) {
    await UserType.updateOne(
      { code: adminUserType.code },
      {
        $set: {
          name: adminUserType.name,
          description: adminUserType.description,
          permissions: adminUserType.permissions,
          scopeType: "company",
          landingPath: "/modules",
          isActive: true,
        },
      },
      { upsert: true },
    );
  }
}

export async function GET() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "company.accessRoles.view") && !hasAccessPermission(user, "company.users.manage")) {
    return NextResponse.json({ error: "No tienes permiso para ver perfiles de acceso." }, { status: 403 });
  }

  await connectToDatabase();
  await ensureDefaultUserTypes();

  const userTypes = await UserType.find({}).sort({ name: 1 }).lean();

  return NextResponse.json({
    userTypes: userTypes.map(serializeUserType),
    permissionCatalog: ACCESS_PERMISSION_CATALOG,
    scopeTypes: ACCESS_SCOPE_TYPES,
  });
}

export async function POST(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "company.accessRoles.manage")) {
    return NextResponse.json({ error: "No tienes permiso para administrar perfiles de acceso." }, { status: 403 });
  }

  try {
    await connectToDatabase();

    const body = await request.json();
    const payload = normalizeUserTypePayload(body);
    const userType = await UserType.create(payload);

    return NextResponse.json(
      {
        userType: serializeUserType(userType),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error?.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const message = field === "name"
        ? "Ya existe un perfil de acceso con ese nombre."
        : "Ya existe un perfil de acceso con ese código.";

      return NextResponse.json({ error: message }, { status: 409 });
    }

    return NextResponse.json(
      { error: error.message || "No se pudo crear el perfil de acceso." },
      { status: 400 },
    );
  }
}
