import { NextResponse } from "next/server";
import crypto from "node:crypto";

const SESSION_COOKIE_NAME = "control_asistencia_session";
const PLANNING_EXCEPTIONS_ACCESS_ROLE = "planning_exceptions";
const LIMITED_API_ALLOWLIST = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/company/employees",
  "/api/planner/planning/base-schedules",
  "/api/planner/planning/exceptions",
];

function getSignedSession(token) {
  const parts = String(token || "").split(":");

  if (![4, 5].includes(parts.length) || parts[0] !== "user") {
    return null;
  }

  const hasEmbeddedPermissions = parts.length === 5;
  const [, userId, accessRole, permissionsOrSignature, nextSignature] = parts;
  const encodedPermissions = hasEmbeddedPermissions ? permissionsOrSignature : "";
  const signature = hasEmbeddedPermissions ? nextSignature : permissionsOrSignature;

  if (!userId || !accessRole || !signature || !process.env.SESSION_SECRET) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(hasEmbeddedPermissions
      ? `${userId}:${accessRole}:${encodedPermissions}`
      : `${userId}:${accessRole}`)
    .digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return null;
  }

  let permissions = [];

  if (encodedPermissions) {
    try {
      const decoded = JSON.parse(Buffer.from(encodedPermissions, "base64url").toString("utf8"));
      permissions = Array.isArray(decoded) ? decoded.map(String) : [];
    } catch {
      return null;
    }
  }

  return { userId, accessRole, permissions };
}

function isAdminAccessRole(value) {
  return ["admin", "administrator", "administrador"].includes(String(value || "").trim().toLowerCase());
}

function hasAnyPermission(permissionSet, permissions = []) {
  return permissions.some((permission) => permissionSet.has(permission));
}

function canAccessApi(pathname, method, permissionSet) {
  if (pathname.startsWith("/api/auth/")) return true;

  if (pathname === "/api/business/inventory") {
    return hasAnyPermission(permissionSet, ["business.inventory.view"]);
  }

  if (pathname === "/api/business/inventory/import") {
    return hasAnyPermission(permissionSet, ["business.inventory.import"]);
  }

  if (pathname === "/api/business/warehouses") {
    return method === "GET"
      ? hasAnyPermission(permissionSet, ["business.warehouses.view", "business.inventory.view"])
      : hasAnyPermission(permissionSet, ["business.warehouses.manage"]);
  }

  if (pathname.startsWith("/api/business/warehouses/")) {
    return hasAnyPermission(permissionSet, ["business.warehouses.manage"]);
  }

  if (pathname === "/api/company/employees") {
    if (method !== "GET") return hasAnyPermission(permissionSet, ["company.employees.create"]);
    return hasAnyPermission(permissionSet, [
      "company.employees.view",
      "planner.schedules.weekly.view",
      "planner.schedules.view",
      "planner.timeOff.view",
      "planner.attendance.view",
      "planner.operations.view",
    ]);
  }

  if (pathname === "/api/company/branches" && method === "GET") {
    return hasAnyPermission(permissionSet, [
      "company.branches.view",
      "planner.schedules.weekly.view",
      "planner.attendance.view",
      "planner.operations.view",
      "planner.settings.view",
    ]);
  }

  if (pathname.startsWith("/api/company/employees/")) {
    return hasAnyPermission(permissionSet, ["company.employees.update", "company.employees.delete"]);
  }

  if (pathname === "/api/company/roles" && method === "GET") {
    return hasAnyPermission(permissionSet, [
      "company.roles.view",
      "planner.schedules.weekly.view",
      "planner.settings.view",
    ]);
  }

  const attendanceRules = [
    ["/api/planner/attendance/upload/", ["planner.attendance.upload"]],
    ["/api/planner/attendance/upload", method === "GET"
      ? ["planner.attendance.view", "planner.attendance.upload"]
      : ["planner.attendance.upload"]],
    ["/api/planner/attendance/punches/", method === "GET"
      ? ["planner.attendance.view", "planner.attendance.review"]
      : ["planner.attendance.review"]],
    ["/api/planner/attendance/punches", method === "GET"
      ? ["planner.attendance.view", "planner.attendance.review"]
      : ["planner.attendance.review"]],
    ["/api/planner/attendance/comparison", ["planner.attendance.view"]],
    ["/api/planner/attendance/decision-history", method === "GET"
      ? ["planner.attendance.view", "planner.attendance.review"]
      : ["planner.attendance.review"]],
    ["/api/planner/attendance/day-decisions", method === "GET"
      ? ["planner.attendance.view", "planner.attendance.review"]
      : ["planner.attendance.review"]],
    ["/api/planner/attendance/monthly-closure", method === "GET"
      ? ["planner.operations.view", "planner.attendance.view"]
      : ["planner.operations.manage", "planner.attendance.close"]],
  ];
  const attendanceRule = attendanceRules.find(([path]) => pathname === path || pathname.startsWith(path));

  if (attendanceRule) {
    return hasAnyPermission(permissionSet, attendanceRule[1]);
  }

  const planningRules = [
    ["/api/planner/planning/schedule-assignments/export", ["planner.schedules.export"]],
    ["/api/planner/planning/schedule-unlock-requests/", ["planner.updates.manage"]],
    ["/api/planner/planning/schedule-unlock-requests", method === "GET"
      ? ["planner.schedules.weekly.view", "planner.updates.view"]
      : ["planner.schedules.manage"]],
    ["/api/planner/planning/schedule-assignments", method === "GET"
      ? ["planner.schedules.weekly.view", "planner.schedules.view"]
      : ["planner.schedules.manage", "planner.updates.manage"]],
    ["/api/planner/planning/base-schedules/", ["planner.settings.manage"]],
    ["/api/planner/planning/base-schedules", method === "GET"
      ? ["planner.schedules.weekly.view", "planner.settings.view", "planner.attendance.view"]
      : ["planner.schedules.quickTemplates.create", "planner.settings.manage"]],
    ["/api/planner/planning/operational-setup", method === "GET"
      ? ["planner.schedules.weekly.view", "planner.settings.view"]
      : ["planner.settings.manage"]],
    ["/api/planner/planning/work-groups", method === "GET"
      ? ["planner.schedules.weekly.view", "planner.settings.view"]
      : ["planner.settings.manage"]],
    ["/api/planner/planning/holidays/", ["planner.holidays.manage"]],
    ["/api/planner/planning/holidays", method === "GET"
      ? ["planner.schedules.weekly.view", "planner.holidays.view"]
      : ["planner.holidays.manage"]],
    ["/api/planner/planning/vacations/", method === "DELETE"
      ? ["planner.timeOff.view", "planner.timeOff.manage"]
      : ["planner.timeOff.manage"]],
    ["/api/planner/planning/vacations", method === "GET"
      ? ["planner.schedules.weekly.view", "planner.timeOff.view"]
      : ["planner.timeOff.view", "planner.timeOff.manage"]],
    ["/api/planner/planning/exceptions/", method === "PATCH"
      ? ["planner.exceptions.approve"]
      : ["planner.exceptions.deleteOwn", "planner.exceptions.approve", "planner.attendance.review"]],
    ["/api/planner/planning/exceptions", method === "GET"
      ? ["planner.exceptions.view", "planner.schedules.weekly.view"]
      : ["planner.exceptions.create", "planner.attendance.review"]],
  ];
  const rule = planningRules.find(([path]) => pathname === path || pathname.startsWith(path));

  return rule ? hasAnyPermission(permissionSet, rule[1]) : false;
}

function canLimitedUserAccessApi(pathname) {
  return LIMITED_API_ALLOWLIST.some((allowedPath) =>
    pathname === allowedPath || pathname.startsWith(`${allowedPath}/`),
  );
}

export async function proxy(request) {
  const pathname = request.nextUrl.pathname;
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value || "";
  const session = getSignedSession(sessionCookie);
  const accessRole = session?.accessRole || "";

  if (
    pathname.startsWith("/api/") &&
    accessRole === PLANNING_EXCEPTIONS_ACCESS_ROLE &&
    !canLimitedUserAccessApi(pathname)
  ) {
    return NextResponse.json(
      { error: "Este perfil solo puede usar las APIs de ajustes y excepciones." },
      { status: 403 },
    );
  }

  if (pathname.startsWith("/api/") && session && !isAdminAccessRole(accessRole)) {
    try {
      const permissionSet = new Set(session.permissions || []);

      if (!permissionSet || !canAccessApi(pathname, request.method, permissionSet)) {
        return NextResponse.json(
          { error: "No tienes permiso para usar este recurso." },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "No se pudo validar el acceso a este recurso." },
        { status: 503 },
      );
    }
  }

  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("x-control-asistencia-path", pathname);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
