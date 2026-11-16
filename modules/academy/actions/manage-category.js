"use server";

import mongoose from "mongoose";
import { revalidatePath } from "next/cache";

import { requireRequestAccess } from "@/lib/access-control";
import connectToDatabase from "@/lib/db/mongodb";
import { listCourseCategories, normalizeCategoryName } from "@/modules/academy/lib/course-categories";
import Course from "@/modules/academy/models/Course";
import CourseCategory from "@/modules/academy/models/CourseCategory";
import { ACADEMY_COURSES_PATH, ACADEMY_SETTINGS_PATH } from "@/modules/academy/module";

export async function manageCategory(_previousState, formData) {
  const { isAllowed } = await requireRequestAccess(ACADEMY_SETTINGS_PATH);
  if (!isAllowed) return { error: "No tienes permiso para configurar Academia." };

  const value = formData.get("id");
  const intent = formData.get("intent");
  if (!["edit", "delete"].includes(intent) ||
    (!["onboarding", "express"].includes(value) && !mongoose.isObjectIdOrHexString(value))) {
    return { error: "La categoría solicitada no es válida." };
  }

  try {
    await connectToDatabase();
    const categories = await listCourseCategories({ includeArchived: true });
    const category = categories.find((item) => item.value === value && item.isActive);
    if (!category) return { error: "La categoría ya no está disponible." };
    let fields;
    if (intent === "delete") {
      if (await Course.exists({ type: value })) {
        return { error: "Esta categoría tiene cursos asignados. Cambia su categoría antes de eliminarla." };
      }
      fields = { isActive: false };
    } else {
      const rawName = formData.get("name");
      const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
      const normalizedName = normalizeCategoryName(name);
      if (!normalizedName || name.length > 80) return { error: "Escribe un nombre de hasta 80 caracteres." };
      if (categories.some((item) => item.value !== value && normalizeCategoryName(item.label) === normalizedName)) {
        return { error: "Ya existe una categoría con ese nombre." };
      }
      fields = { name, normalizedName };
    }
    await CourseCategory.init();
    if (category.builtIn) {
      await CourseCategory.findOneAndUpdate({ code: value }, {
        $set: fields,
        $setOnInsert: {
          code: value,
          ...(intent === "delete" ? { name: category.label, normalizedName: normalizeCategoryName(category.label) } : {}),
        },
      }, { upsert: true, runValidators: true });
    } else {
      const updated = await CourseCategory.findOneAndUpdate({ _id: value, isActive: { $ne: false } }, { $set: fields }, { runValidators: true });
      if (!updated) return { error: "La categoría ya no está disponible." };
    }
  } catch (error) {
    return { error: error.code === 11000 ? "Ya existe una categoría con ese nombre." : "No se pudo guardar el cambio." };
  }

  revalidatePath(ACADEMY_SETTINGS_PATH);
  revalidatePath(ACADEMY_COURSES_PATH);
  return { success: intent === "delete" ? "Categoría eliminada." : "Categoría actualizada." };
}
