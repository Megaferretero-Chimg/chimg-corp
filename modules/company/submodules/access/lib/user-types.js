import {
  ALL_ACCESS_PERMISSIONS,
  getDefaultPermissionsForRole,
  isAdminAccessRole,
  normalizePermissionDependencies,
  normalizePermissions,
} from "@/modules/company/submodules/access/lib/permissions";

export const DEFAULT_USER_TYPES = [
  {
    code: "admin",
    name: "Administrador",
    description: "Acceso general a la administración del sistema.",
    permissions: getDefaultPermissionsForRole("admin"),
    scopeType: "company",
    landingPath: "/modules",
    isActive: true,
  },
];

export const PROTECTED_USER_TYPE_CODES = new Set(["admin"]);

function slugifyTypeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s_-]/g, " ")
    .trim();
}

export function normalizeUserTypeCode(value) {
  return slugifyTypeText(value)
    .replace(/[\s_-]+/g, "_")
    .toLowerCase();
}

export function isProtectedUserTypeCode(value) {
  return PROTECTED_USER_TYPE_CODES.has(normalizeUserTypeCode(value));
}

export function normalizeUserTypePayload(body) {
  const name = String(body?.name || "").trim();
  const code = normalizeUserTypeCode(body?.code || name);
  const description = String(body?.description || "").trim();
  const scopeType = String(body?.scopeType || "company").trim().toLowerCase();
  const landingPath = String(body?.landingPath || "/modules").trim() || "/modules";

  if (!name) {
    throw new Error("El nombre del perfil de acceso es obligatorio.");
  }

  if (!code) {
    throw new Error("No se pudo generar el código del perfil de acceso.");
  }

  if (isProtectedUserTypeCode(code)) {
    throw new Error("El perfil Administrador está protegido y no se puede crear ni modificar.");
  }

  return {
    code,
    name,
    description,
    permissions: normalizePermissionDependencies(body?.permissions),
    scopeType: ["company", "branch", "area", "team", "self"].includes(scopeType) ? scopeType : "company",
    landingPath: landingPath.startsWith("/") ? landingPath : `/${landingPath}`,
    isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
  };
}

export function serializeUserType(userType) {
  const isAdmin = isAdminAccessRole(userType.code);
  const permissions = isAdmin
    ? ALL_ACCESS_PERMISSIONS
    : normalizePermissions(userType.permissions);

  return {
    id: userType._id.toString(),
    code: userType.code || "",
    name: userType.name || "",
    description: userType.description || "",
    permissions,
    scopeType: isAdmin ? "company" : userType.scopeType || "company",
    landingPath: isAdmin ? "/modules" : userType.landingPath || "/modules",
    isActive: userType.isActive !== false,
    isProtected: isProtectedUserTypeCode(userType.code),
    createdAt: userType.createdAt,
    updatedAt: userType.updatedAt,
  };
}
