import { NextResponse } from "next/server";
import crypto from "node:crypto";

const SESSION_COOKIE_NAME = "control_asistencia_session";
const PLANNING_EXCEPTIONS_ACCESS_ROLE = "planning_exceptions";
const BRANCH_MANAGER_ACCESS_ROLE = "branch_manager";
const LIMITED_API_ALLOWLIST = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/company/employees",
  "/api/planner/planning/base-schedules",
  "/api/planner/planning/exceptions",
];

function getSignedAccessRole(token) {
  const parts = String(token || "").split(":");

  if (parts.length !== 4 || parts[0] !== "user") {
    return "";
  }

  const [, userId, accessRole, signature] = parts;

  if (!userId || !accessRole || !signature || !process.env.SESSION_SECRET) {
    return "";
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(`${userId}:${accessRole}`)
    .digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return "";
  }

  return accessRole;
}

function canLimitedUserAccessApi(pathname) {
  return LIMITED_API_ALLOWLIST.some((allowedPath) =>
    pathname === allowedPath || pathname.startsWith(`${allowedPath}/`),
  );
}

function canBranchManagerAccessApi(pathname, method) {
  if (pathname.startsWith("/api/auth/")) return true;

  const readOnlyPaths = [
    "/api/company/employees",
    "/api/company/roles",
    "/api/planner/planning/base-schedules",
    "/api/planner/planning/operational-setup",
    "/api/planner/planning/holidays",
    "/api/planner/planning/vacations",
  ];

  if (method === "GET" && readOnlyPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return true;
  }

  return [
    "/api/planner/planning/schedule-assignments",
    "/api/planner/planning/exceptions",
  ].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function proxy(request) {
  const pathname = request.nextUrl.pathname;
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value || "";
  const accessRole = getSignedAccessRole(sessionCookie);

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


  if (
    pathname.startsWith("/api/")
    && accessRole === BRANCH_MANAGER_ACCESS_ROLE
    && !canBranchManagerAccessApi(pathname, request.method)
  ) {
    return NextResponse.json(
      { error: "El Jefe de sucursal solo puede planificar y gestionar sus propios ajustes y excepciones." },
      { status: 403 },
    );
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
