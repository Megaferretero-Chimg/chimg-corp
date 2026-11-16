"use server";

import mongoose from "mongoose";

import { requireRequestAccess } from "@/lib/access-control";
import connectToDatabase from "@/lib/db/mongodb";
import { prepareUpload } from "@/modules/academy/lib/cloudinary";
import Course from "@/modules/academy/models/Course";
import { ACADEMY_COURSES_PATH } from "@/modules/academy/module";

export async function prepareLessonMedia(courseId, kind) {
  const { isAllowed } = await requireRequestAccess(ACADEMY_COURSES_PATH);
  if (!isAllowed || !mongoose.isObjectIdOrHexString(courseId) || !["image", "video"].includes(kind)) {
    return { error: "No se puede preparar esta carga." };
  }
  try {
    await connectToDatabase();
    if (!(await Course.exists({ _id: courseId }))) return { error: "El curso ya no está disponible." };
    return prepareUpload(courseId, kind);
  } catch {
    return { error: "No se pudo preparar la carga en Cloudinary." };
  }
}
