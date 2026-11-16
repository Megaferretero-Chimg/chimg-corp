"use server";

import { revalidatePath } from "next/cache";

import { requireRequestAccess } from "@/lib/access-control";
import connectToDatabase from "@/lib/db/mongodb";
import { isBuiltInCategoryName, normalizeCategoryName } from "@/modules/academy/lib/course-categories";
import CourseCategory from "@/modules/academy/models/CourseCategory";
import { ACADEMY_COURSES_PATH, ACADEMY_SETTINGS_PATH } from "@/modules/academy/module";

export async function createCategory(_previousState, formData) {
  const { isAllowed } = await requireRequestAccess(ACADEMY_SETTINGS_PATH);
  if (!isAllowed) return { error: "No tienes permiso para configurar Academia." };

  const rawName = formData.get("name");
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
  const normalizedName = normalizeCategoryName(name);
  if (!normalizedName || name.length > 80) return { error: "Escribe un nombre de hasta 80 caracteres." };
  if (isBuiltInCategoryName(normalizedName)) return { error: "Ya existe una categoría con ese nombre." };

  try {
    await connectToDatabase();
    await CourseCategory.init();
    await CourseCategory.create({ name, normalizedName });
  } catch (error) {
    return { error: error.code === 11000 ? "Ya existe una categoría con ese nombre." : "No se pudo crear la categoría." };
  }

  revalidatePath(ACADEMY_SETTINGS_PATH);
  revalidatePath(ACADEMY_COURSES_PATH);
  return { success: "Categoría creada." };
}
