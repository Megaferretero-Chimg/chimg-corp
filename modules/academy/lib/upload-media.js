import { prepareLessonMedia } from "@/modules/academy/actions/prepare-media";

export async function uploadAcademyMedia(courseId, file, kind) {
  if (!file.type.startsWith(`${kind}/`)) throw new Error("Tipo de archivo incorrecto.");
  const upload = await prepareLessonMedia(courseId, kind);
  if (upload.error) throw new Error(upload.error);
  const body = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) body.append(name, value);
  body.append("file", file);
  const response = await fetch(upload.url, { method: "POST", body });
  if (!response.ok) throw new Error("Cloudinary no pudo cargar el archivo.");
  const asset = await response.json();
  if (asset.public_id !== upload.fields.public_id || asset.resource_type !== kind || asset.type !== "authenticated" || !asset.format) {
    throw new Error("Cloudinary devolvió un archivo inesperado.");
  }
  return { publicId: asset.public_id, kind, format: asset.format };
}
