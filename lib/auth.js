import crypto from "node:crypto";

import { cookies } from "next/headers";

import connectToDatabase from "@/lib/db/mongodb";
import { verifyPassword } from "@/lib/users";
import User from "@/models/User";

export const SESSION_COOKIE_NAME = "control_asistencia_session";
const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function getRequiredEnvValue(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}.`);
  }

  return value;
}

export function getAuthConfig() {
  return {
    username: getRequiredEnvValue("AUTH_USERNAME"),
    password: getRequiredEnvValue("AUTH_PASSWORD"),
  };
}

function getOptionalAuthConfig() {
  const username = process.env.AUTH_USERNAME;
  const password = process.env.AUTH_PASSWORD;

  if (!username || !password) {
    return null;
  }

  return {
    username,
    password,
  };
}

export function createSessionToken() {
  const { username, password } = getAuthConfig();
  return crypto.createHash("sha256").update(`${username}:${password}`).digest("hex");
}

function createOptionalSessionToken() {
  const authConfig = getOptionalAuthConfig();

  if (!authConfig) {
    return "";
  }

  return crypto
    .createHash("sha256")
    .update(`${authConfig.username}:${authConfig.password}`)
    .digest("hex");
}

function getSessionSecret() {
  return getRequiredEnvValue("SESSION_SECRET");
}

export function createUserSessionToken(userId, accessRole = "") {
  const normalizedUserId = String(userId || "");
  const normalizedAccessRole = String(accessRole || "viewer").trim().toLowerCase();
  const signature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(`${normalizedUserId}:${normalizedAccessRole}`)
    .digest("hex");

  return `user:${normalizedUserId}:${normalizedAccessRole}:${signature}`;
}

function resolveUserIdFromSessionToken(token) {
  const parts = String(token || "").split(":");
  const [, userId, roleOrSignature, nextSignature] = parts;
  const isLegacyToken = parts.length === 3;
  const accessRole = isLegacyToken ? "" : roleOrSignature;
  const signature = isLegacyToken ? roleOrSignature : nextSignature;

  if (!userId || !signature) {
    return "";
  }

  const expectedSignature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(isLegacyToken ? userId : `${userId}:${accessRole}`)
    .digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return "";
  }

  return userId;
}

export async function validateCredentials(username, password) {
  const authConfig = getOptionalAuthConfig();

  if (authConfig && username === authConfig.username && password === authConfig.password) {
    return {
      type: "env",
      token: createOptionalSessionToken(),
      accessRole: "admin",
    };
  }

  await connectToDatabase();

  const user = await User.findOne({
    username: String(username || "").trim().toLowerCase(),
  });

  if (!user || user.isActive === false || !verifyPassword(password, user.passwordHash)) {
    return null;
  }

  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

  return {
    type: "user",
    token: createUserSessionToken(user._id.toString(), user.accessRole || "viewer"),
    accessRole: user.accessRole || "viewer",
  };
}

export async function isAuthenticated() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie?.value) {
    return false;
  }

  const envSessionToken = createOptionalSessionToken();

  if (envSessionToken && sessionCookie.value === envSessionToken) {
    return true;
  }

  const userId = resolveUserIdFromSessionToken(sessionCookie.value);

  if (!userId) {
    return false;
  }

  await connectToDatabase();

  const user = await User.findById(userId).select("isActive").lean();

  return Boolean(user && user.isActive !== false);
}

export async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie?.value) {
    return null;
  }

  const envSessionToken = createOptionalSessionToken();

  if (envSessionToken && sessionCookie.value === envSessionToken) {
    return {
      id: "env",
      username: getOptionalAuthConfig()?.username || "admin",
      employeeName: "ADMIN",
      accessRole: "admin",
      accessRoleLabel: "Administrador",
    };
  }

  const userId = resolveUserIdFromSessionToken(sessionCookie.value);

  if (!userId) {
    return null;
  }

  await connectToDatabase();

  const user = await User.findById(userId)
    .select("username employeeName accessRole accessRoleLabel isActive")
    .lean();

  if (!user || user.isActive === false) {
    return null;
  }

  return {
    id: user._id.toString(),
    username: user.username || "",
    employeeName: user.employeeName || "",
    accessRole: user.accessRole || "viewer",
    accessRoleLabel: user.accessRoleLabel || "",
  };
}

export function getSessionCookieOptions() {
  const configuredMaxAge = Number(process.env.SESSION_MAX_AGE_SECONDS);
  const maxAge = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
    ? Math.floor(configuredMaxAge)
    : DEFAULT_SESSION_MAX_AGE_SECONDS;

  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
