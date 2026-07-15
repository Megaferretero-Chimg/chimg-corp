import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  DEFAULT_USER_TYPES,
  serializeUserType,
} from "@/modules/company/submodules/access/lib/user-types";
import {
  ACCESS_PERMISSION_CATALOG,
  ACCESS_PAGE_CATALOG,
  ACCESS_SCOPE_TYPES,
  hasAccessPermission,
} from "@/modules/company/submodules/access/lib/permissions";
import { UserType } from "@/modules/company/models";

async function ensureDefaultUserTypes() {
  await Promise.all(
    DEFAULT_USER_TYPES.map((userType) =>
      UserType.updateOne(
        { code: userType.code },
        { $set: userType },
        { upsert: true },
      ),
    ),
  );
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

  const userTypes = await UserType.find({
    code: { $in: DEFAULT_USER_TYPES.map((type) => type.code) },
  }).sort({ name: 1 }).lean();

  return NextResponse.json({
    userTypes: userTypes.map(serializeUserType),
    permissionCatalog: ACCESS_PERMISSION_CATALOG,
    pageCatalog: ACCESS_PAGE_CATALOG,
    scopeTypes: ACCESS_SCOPE_TYPES,
  });
}

export async function POST() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  if (!hasAccessPermission(user, "company.accessRoles.manage")) {
    return NextResponse.json({ error: "No tienes permiso para administrar perfiles de acceso." }, { status: 403 });
  }

  return NextResponse.json(
    { error: "Los perfiles de acceso son fijos: Administrador, Jefe de sucursal y Encargado de nómina." },
    { status: 405 },
  );
}
