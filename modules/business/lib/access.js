import { getAuthenticatedUser } from "@/lib/auth";
import {
  hasAccessPermission,
  isAdminAccessUser,
} from "@/modules/company/submodules/access/lib/permissions";

export async function getBusinessAccess(permission) {
  const user = await getAuthenticatedUser();

  if (!user) return { user: null, status: 401, error: "Sesión inválida o expirada." };
  if (!isAdminAccessUser(user)) {
    return { user, status: 403, error: "Este módulo está disponible únicamente para administradores." };
  }
  if (!hasAccessPermission(user, permission)) {
    return { user, status: 403, error: "No tienes permiso para realizar esta acción." };
  }

  return { user, status: 200, error: "" };
}
