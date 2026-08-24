import crypto from "node:crypto";

import connectToDatabase from "@/lib/db/mongodb";
import {
  ApiRateLimit,
  Device,
  DeviceSyncLog,
} from "@/modules/business/models";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVATION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function isUuid(value) {
  return UUID_PATTERN.test(String(value || "").trim());
}

export function hashDeviceToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

export function hashActivationCode(value) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET no está configurado.");
  return crypto.createHmac("sha256", secret).update(String(value || "").trim().toUpperCase()).digest("hex");
}

export function createAccessToken() {
  return `chimg_${crypto.randomBytes(32).toString("base64url")}`;
}

export function createActivationCode(length = 16) {
  const bytes = crypto.randomBytes(length);
  const value = [...bytes].map((byte) => ACTIVATION_ALPHABET[byte % ACTIVATION_ALPHABET.length]).join("");
  return `CHIMG-${value.match(/.{1,4}/g).join("-")}`;
}

export function getClientIp(request) {
  return String(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown")
    .split(",")[0]
    .trim();
}

export async function consumeRateLimit(key, { limit, windowMs }) {
  await connectToDatabase();
  const now = Date.now();
  const windowStartedAt = new Date(Math.floor(now / windowMs) * windowMs);
  const expiresAt = new Date(windowStartedAt.getTime() + windowMs * 2);
  const windowKey = `${key}:${windowStartedAt.toISOString()}`;
  const result = await ApiRateLimit.findOneAndUpdate(
    { key: windowKey },
    {
      $inc: { count: 1 },
      $setOnInsert: { windowStartedAt, expiresAt },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  ).lean();

  return {
    allowed: result.count <= limit,
    remaining: Math.max(0, limit - result.count),
    retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt.getTime() + windowMs - now) / 1000)),
  };
}

export async function logDeviceSync({ device = null, deviceId = "", action, status, version = "", details = {} }) {
  return DeviceSyncLog.create({
    device: device?._id || null,
    deviceId: device?.deviceId || deviceId,
    action,
    status,
    version,
    details,
    happenedAt: new Date(),
  });
}

export async function authenticateDeviceRequest(request, { action = "manifest" } = {}) {
  await connectToDatabase();
  const header = String(request.headers.get("authorization") || "").trim();
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return { error: "Bearer Token obligatorio.", status: 401, device: null };
  }

  const tokenHash = hashDeviceToken(match[1]);
  const device = await Device.findOne({ tokenHash }).select("+tokenHash");

  if (!device) {
    await logDeviceSync({ action: "auth_rejected", status: "rejected", details: { requestedAction: action } });
    return { error: "Token de dispositivo inválido.", status: 401, device: null };
  }

  if (device.status === "revoked") {
    await logDeviceSync({ device, action: "auth_rejected", status: "rejected", details: { requestedAction: action, reason: "revoked" } });
    return { error: "La llave de este dispositivo fue eliminada.", status: 403, device };
  }

  const rate = await consumeRateLimit(`device:${device.deviceId}`, { limit: 120, windowMs: 60_000 });
  if (!rate.allowed) {
    return {
      error: "Demasiadas solicitudes. Intenta nuevamente en unos segundos.",
      status: 429,
      device,
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  }

  device.lastSeenAt = new Date();
  await device.save();

  return { error: "", status: 200, device, token: match[1] };
}
