import { redirect } from "next/navigation";

import { PLANNING_EXCEPTIONS_ACCESS_ROLE } from "@/lib/access-roles";
import { getAuthenticatedUser } from "@/lib/auth";
import { planningModulePath } from "@/modules/planner/routes";
import { companyModulePath } from "@/modules/company/routes";
import {
  getRequiredPermissionForPath,
  hasAccessPermission,
  isAdminAccessUser,
} from "@/modules/company/submodules/access/lib/permissions";

export const PLANNING_EXCEPTIONS_PATH = planningModulePath("/planning/exceptions");
export const EMPLOYEE_ONLY_COMPANY_USERNAMES = new Set(["adriana", "patricia"]);
export const COMPANY_EMPLOYEES_PATH = companyModulePath("/employees");

function normalizeAccessRole(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export function isPlanningExceptionsUser(user) {
  return normalizeAccessRole(user?.accessRole) === PLANNING_EXCEPTIONS_ACCESS_ROLE;
}

export function isCompanyEmployeeOnlyUser(user) {
  if (isAdminAccessUser(user)) {
    return false;
  }

  return EMPLOYEE_ONLY_COMPANY_USERNAMES.has(normalizeUsername(user?.username));
}

export function canManageUserAccess(user) {
  return hasAccessPermission(user, "company.accessRoles.manage") || hasAccessPermission(user, "company.users.manage");
}

function normalizeRequestPath(pathname) {
  const value = String(pathname || "").trim();
  const [pathOnly = ""] = value.split("?");

  return pathOnly.replace(/\/+$/, "") || "/";
}

export function getDefaultLandingPathForUser(user) {
  return user?.landingPath || (isPlanningExceptionsUser(user) ? PLANNING_EXCEPTIONS_PATH : "/modules");
}

export function canAccessRequestPath(user, pathname) {
  const path = normalizeRequestPath(pathname);

  if (path === "/" || path === "/modules") {
    return true;
  }

  if (isCompanyEmployeeOnlyUser(user)) {
    if (path === "/modules/planning" || path.startsWith("/modules/planning/")) return true;

    return path === COMPANY_EMPLOYEES_PATH || path.startsWith(`${COMPANY_EMPLOYEES_PATH}/`);
  }

  const requiredPermission = getRequiredPermissionForPath(path);

  if (requiredPermission) {
    return hasAccessPermission(user, requiredPermission);
  }

  if (path === "/modules/company") {
    return hasAccessPermission(user, "company.home.view") ||
      hasAccessPermission(user, "company.employees.view") ||
      hasAccessPermission(user, "company.organization.view") ||
      hasAccessPermission(user, "company.access.view");
  }

  if (path === "/modules/planning") {
    return hasAccessPermission(user, "planner.home.view") ||
      hasAccessPermission(user, "planner.schedules.weekly.view") ||
      hasAccessPermission(user, "planner.schedules.view") ||
      hasAccessPermission(user, "planner.attendance.view") ||
      hasAccessPermission(user, "planner.reports.view");
  }

  if (path === "/modules/business") {
    return hasAccessPermission(user, "business.home.view") ||
      hasAccessPermission(user, "business.inventory.view") ||
      hasAccessPermission(user, "business.warehouses.view");
  }

  if (path.startsWith("/modules/")) {
    return isAdminAccessUser(user);
  }

  return true;
}

export async function requireAuthenticatedUser() {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/");
  }

  return user;
}

export async function requireRequestAccess(pathname) {
  const user = await requireAuthenticatedUser();

  return {
    user,
    isAllowed: canAccessRequestPath(user, pathname),
  };
}
