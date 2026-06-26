import { redirect } from "next/navigation";

import { PLANNING_EXCEPTIONS_ACCESS_ROLE } from "@/lib/access-roles";
import { getAuthenticatedUser } from "@/lib/auth";
import { planningModulePath } from "@/lib/modules/planning/routes";

export const PLANNING_EXCEPTIONS_PATH = planningModulePath("/planning/exceptions");

function normalizeAccessRole(value) {
  return String(value || "").trim().toLowerCase();
}

export function isPlanningExceptionsUser(user) {
  return normalizeAccessRole(user?.accessRole) === PLANNING_EXCEPTIONS_ACCESS_ROLE;
}

function normalizeRequestPath(pathname) {
  const value = String(pathname || "").trim();
  const [pathOnly = ""] = value.split("?");

  return pathOnly.replace(/\/+$/, "") || "/";
}

export function getDefaultLandingPathForUser(user) {
  return isPlanningExceptionsUser(user) ? PLANNING_EXCEPTIONS_PATH : "/modules";
}

export function canAccessRequestPath(user, pathname) {
  if (!isPlanningExceptionsUser(user)) {
    return true;
  }

  const path = normalizeRequestPath(pathname);

  return new Set([
    "/modules",
    "/modules/planning",
    PLANNING_EXCEPTIONS_PATH,
    "/dashboard/planning/exceptions",
  ]).has(path);
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

  if (!canAccessRequestPath(user, pathname)) {
    redirect(getDefaultLandingPathForUser(user));
  }

  return user;
}
