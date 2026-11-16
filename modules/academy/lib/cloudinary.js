import { createHash, randomUUID } from "node:crypto";

function credentials() {
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
  if (!cloud || !key || !secret) throw new Error("Cloudinary no está configurado.");
  return { cloud, key, secret };
}

export function prepareUpload(courseId, kind) {
  const { cloud, key, secret } = credentials();
  const fields = {
    overwrite: "false",
    public_id: `academy/${courseId}/${randomUUID()}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: "authenticated",
  };
  const payload = Object.entries(fields).sort().map(([name, value]) => `${name}=${value}`).join("&");
  const signature = createHash("sha256").update(payload + secret).digest("hex");
  return {
    url: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/${kind}/upload`,
    fields: { ...fields, api_key: key, signature },
  };
}

export async function verifyAsset(courseId, { publicId, kind }) {
  if (!["image", "video"].includes(kind) ||
    typeof publicId !== "string" || !publicId.startsWith(`academy/${courseId}/`) ||
    !/^[0-9a-f-]{36}$/.test(publicId.slice(`academy/${courseId}/`.length))) {
    throw new Error("El archivo no corresponde a este curso.");
  }
  const { cloud, key, secret } = credentials();
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/resources/${kind}/authenticated/${encodeURIComponent(publicId)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("No se pudo verificar el archivo en Cloudinary.");
  const asset = await response.json();
  if (asset.public_id !== publicId || asset.resource_type !== kind || asset.type !== "authenticated" || !asset.format) {
    throw new Error("El archivo verificado no coincide con la solicitud.");
  }
  return { publicId, kind, format: asset.format };
}

export function lessonPreviewUrl(courseId, { publicId, kind, format }) {
  if (!["image", "video"].includes(kind) ||
    typeof publicId !== "string" || !publicId.startsWith(`academy/${courseId}/`) ||
    !/^[0-9a-f-]{36}$/.test(publicId.slice(`academy/${courseId}/`.length)) ||
    !/^[a-z0-9]+$/i.test(format ?? "")) return null;

  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_SECRET: secret } = process.env;
  if (!cloud || !secret) return null;

  const path = `${publicId}.${format}`;
  const signature = createHash("sha256").update(path + secret).digest("base64url").slice(0, 8);
  return `https://res.cloudinary.com/${encodeURIComponent(cloud)}/${kind}/authenticated/s--${signature}--/${path}`;
}
