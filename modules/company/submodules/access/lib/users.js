import crypto from "node:crypto";

import { DEFAULT_USER_TYPES } from "@/modules/company/submodules/access/lib/user-types";
import { BRANCH_MANAGER_ACCESS_ROLE } from "@/lib/access-roles";

export const ACCESS_ROLES = DEFAULT_USER_TYPES.map((type) => ({
  value: type.code,
  label: type.name,
}));

const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = "sha256";

export function getAccessRoleLabel(value) {
  return ACCESS_ROLES.find((role) => role.value === value)?.label || "Consulta";
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)
    .toString("hex");

  return `pbkdf2:${PASSWORD_ITERATIONS}:${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [scheme, iterationsText, salt, hash] = String(storedHash || "").split(":");

  if (scheme !== "pbkdf2" || !iterationsText || !salt || !hash) {
    return false;
  }

  const iterations = Number(iterationsText);

  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  const candidate = crypto
    .pbkdf2Sync(String(password), salt, iterations, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)
    .toString("hex");
  const candidateBuffer = Buffer.from(candidate, "hex");
  const hashBuffer = Buffer.from(hash, "hex");

  return candidateBuffer.length === hashBuffer.length && crypto.timingSafeEqual(candidateBuffer, hashBuffer);
}

export function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export function getReservedUsernames() {
  return new Set(
    [process.env.AUTH_USERNAME, "admin"]
      .map(normalizeUsername)
      .filter(Boolean),
  );
}

export function isReservedUsername(value) {
  return getReservedUsernames().has(normalizeUsername(value));
}

export function normalizeUserPayload(body, { employee, userType, isEditing = false } = {}) {
  const username = normalizeUsername(body?.username);
  const email = String(body?.email || "").trim().toLowerCase();
  const accessRole = String(userType?.code || body?.accessRole || "").trim().toLowerCase();
  const password = String(body?.password || "");

  if (body?.employeeId && !employee?._id) {
    throw new Error("Debes seleccionar un empleado válido.");
  }

  if (employee?.isActive === false) {
    throw new Error("No puedes crear acceso para un empleado inactivo.");
  }

  if (!username) {
    throw new Error("El usuario es obligatorio.");
  }

  if (isReservedUsername(username)) {
    throw new Error("Ese usuario está reservado para el acceso principal del sistema.");
  }

  if (!userType?._id) {
    throw new Error("Debes seleccionar un tipo de usuario válido.");
  }


  if (accessRole === BRANCH_MANAGER_ACCESS_ROLE && !employee?._id) {
    throw new Error("El Jefe de sucursal debe estar vinculado al empleado que dirige el grupo de trabajo.");
  }

  if (userType.isActive === false) {
    throw new Error("No puedes asignar un tipo de usuario inactivo.");
  }

  if (!isEditing && password.length < 6) {
    throw new Error("La clave temporal debe tener al menos 6 caracteres.");
  }

  if (isEditing && password && password.length < 6) {
    throw new Error("La nueva clave debe tener al menos 6 caracteres.");
  }

  const payload = {
    employeeId: employee?._id?.toString() || "",
    employeeName: employee?.fullName || "",
    employeeDni: employee?.dni || "",
    username,
    email,
    accessRole,
    accessRoleLabel: userType.name || getAccessRoleLabel(accessRole),
    isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
  };

  if (password) {
    payload.passwordHash = hashPassword(password);
  }

  return payload;
}

export function serializeUser(user) {
  return {
    id: user._id.toString(),
    employeeId: user.employeeId || "",
    employeeName: user.employeeName || "",
    employeeDni: user.employeeDni || "",
    username: user.username || "",
    email: user.email || "",
    accessRole: user.accessRole || "viewer",
    accessRoleLabel: user.accessRoleLabel || getAccessRoleLabel(user.accessRole),
    isActive: user.isActive !== false,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
