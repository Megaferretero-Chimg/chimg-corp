"use server";

import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRequestAccess } from "@/lib/access-control";
import connectToDatabase from "@/lib/db/mongodb";
import Role from "@/modules/company/models/Role";
import { courseCategoryExists } from "@/modules/academy/lib/course-categories";
import { verifyAsset } from "@/modules/academy/lib/cloudinary";
import { ACADEMY_ADMIN, ACADEMY_COURSES_PATH, MAX_LESSON_BLOCK_IMAGES, MAX_QUESTION_IMAGES, isValidQuestionPoints } from "@/modules/academy/module";
import Course from "@/modules/academy/models/Course";

export async function saveCourse(_previousState, formData) {
  const { isAllowed } = await requireRequestAccess(ACADEMY_COURSES_PATH);
  if (!isAllowed) return { error: "No tienes permiso para administrar cursos." };

  const id = formData.get("id");
  const version = formData.get("version");
  const section = formData.get("section");
  const autoSave = formData.get("saveMode") === "auto";
  const canAutoSave = section === "lesson"
    ? mongoose.isObjectIdOrHexString(formData.get("lesson"))
    : section === "evaluation" && mongoose.isObjectIdOrHexString(formData.get("chapter"));
  if (autoSave && !canAutoSave) return { error: "El autoguardado no está disponible en esta sección." };

  let destination;
  let savedVersion;

  try {
    const input = JSON.parse(formData.get("course"));
    if (!["base", "settings", "chapter", "lesson", "evaluation"].includes(section) ||
      (id ? !mongoose.isObjectIdOrHexString(id) : section !== "base")) {
      return { error: "La sección solicitada no está disponible." };
    }

    await connectToDatabase();
    const course = id ? await Course.findById(id) : new Course();
    if (!course) return { error: "El curso ya no está disponible." };
    if (id && String(course.__v ?? 0) !== version) {
      return { error: "El curso cambió desde que lo abriste. Vuelve a abrirlo para ver la versión actual." };
    }

    if (section === "base") {
      const { title, description, type } = input;
      if (type !== course.type && !(await courseCategoryExists(type))) return { error: "Selecciona una categoría válida." };
      course.set({ title, description, type });
    }

    if (section === "settings") {
      const { roleIds, status } = input;
      if (!Array.isArray(roleIds) || roleIds.some((roleId) => !mongoose.isObjectIdOrHexString(roleId))) {
        return { error: "Selecciona cargos válidos." };
      }
      const availableRoles = await Role.countDocuments({
        _id: { $in: roleIds },
        $or: [{ isActive: { $ne: false } }, { _id: { $in: course.roleIds } }],
      });
      if (availableRoles !== roleIds.length) return { error: "Revisa los cargos seleccionados." };
      course.set({ roleIds, status });
    }

    if (section === "lesson") {
      const chapter = course.chapters.id(formData.get("chapter"));
      if (!chapter) return { error: "El capítulo ya no está disponible." };
      const lessonId = formData.get("lesson");
      const lesson = lessonId ? chapter.lessons.id(lessonId) : null;
      if (lessonId && !lesson) return { error: "La lección ya no está disponible." };
      const media = [];
      const existing = new Map((lesson?.media ?? []).map((asset) => [`${asset.kind}:${asset.publicId}`, asset]));
      const fields = { title: input.title };
      if (Array.isArray(input.blocks)) {
        const blocks = [];
        for (const block of input.blocks) {
          const label = typeof block.label === "string" ? block.label.trim() || undefined : undefined;
          if (block.kind === "text") {
            if (!Array.isArray(block.parts) || block.parts.some(({ text }) => typeof text !== "string")) {
              return { error: "Revisa los bloques de texto." };
            }
            const parts = block.parts.map(({ style, text }) => ({ style, text }));
            blocks.push({ kind: "text", label, parts });
          } else if (block.kind === "divider") {
            blocks.push({ kind: "divider", label });
          } else {
            const { kind } = block;
            if (!["image", "video"].includes(kind)) return { error: "Revisa los archivos de la lección." };
            const incoming = block.assets ?? block.images ?? (block.asset ? [block.asset] : null);
            if (!Array.isArray(incoming)) return { error: "Revisa los archivos de la lección." };
            if (kind === "image" && incoming.length > MAX_LESSON_BLOCK_IMAGES) {
              return { error: `Cada bloque admite hasta ${MAX_LESSON_BLOCK_IMAGES} imágenes.` };
            }
            const assets = [];
            for (const item of incoming) {
              if (item?.kind !== kind) return { error: "El archivo no corresponde al tipo de bloque." };
              const asset = existing.get(`${kind}:${item.publicId}`) ?? await verifyAsset(course.id, item);
              assets.push(asset);
              media.push(asset);
            }
            blocks.push({ kind, label, assets });
          }
        }
        fields.blocks = blocks;
        fields.content = blocks.flatMap((block) => block.parts?.map(({ text }) => text) ?? []).join("\n\n");
        fields.media = media;
      } else if (lesson?.blocks) {
        return { error: "Vuelve a abrir la lección para editar sus bloques." };
      } else {
        for (const asset of input.media ?? []) {
          media.push(existing.get(`${asset.kind}:${asset.publicId}`) ?? await verifyAsset(course.id, asset));
        }
        fields.content = input.content;
        fields.media = media;
      }
      if (lesson) lesson.set(fields);
      else chapter.lessons.push(fields);
      destination = `${ACADEMY_COURSES_PATH}?edit=${course.id}&section=chapter&chapter=${chapter.id}`;
    }

    if (section === "chapter") {
      const chapterId = formData.get("chapter");
      const chapter = chapterId ? course.chapters.id(chapterId) : null;
      if (chapterId && !chapter) return { error: "El capítulo ya no está disponible." };

      if (chapter) {
        chapter.title = input.title;
        destination = `${ACADEMY_COURSES_PATH}?edit=${course.id}&section=chapter&chapter=${chapter.id}`;
      } else {
        course.chapters.push({ title: input.title });
        destination = `${ACADEMY_COURSES_PATH}?edit=${course.id}&section=chapter&chapter=${course.chapters.at(-1).id}`;
      }
    }

    if (section === "evaluation") {
      const chapter = course.chapters.id(formData.get("chapter"));
      if (!chapter) return { error: "El capítulo ya no está disponible." };
      const { questions, evaluation } = input;
      if (!Array.isArray(questions) || !evaluation || typeof evaluation.allowAnswerChanges !== "boolean") {
        return { error: "Revisa la configuración de la evaluación." };
      }
      const { questionsPerAttempt, timeLimitMinutes, maxGrade, allowAnswerChanges } = evaluation;
      if (questionsPerAttempt != null && (!Number.isInteger(questionsPerAttempt) || questionsPerAttempt < 1)) {
        return { error: "El máximo de preguntas por intento debe ser un número entero mayor que cero." };
      }
      if (timeLimitMinutes != null && (!Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1)) {
        return { error: "El tiempo límite debe ser un número entero de minutos." };
      }
      if (!Number.isFinite(maxGrade) || maxGrade < 0.01) return { error: "La nota máxima debe ser mayor que cero." };

      const bank = [];
      for (const { _id, prompt, options, correctOptionIndex, points, image, images } of questions) {
        if (!isValidQuestionPoints(points)) return { error: "Los puntos deben ser positivos y tener hasta dos decimales." };
        const incoming = images ?? (image ? [image] : []);
        if (!Array.isArray(incoming) || incoming.length > MAX_QUESTION_IMAGES) {
          return { error: `Cada pregunta admite hasta ${MAX_QUESTION_IMAGES} imágenes.` };
        }
        const stored = chapter.questions.id(_id);
        const previous = new Map((stored?.images ?? (stored?.image ? [stored.image] : [])).map((item) => [item.publicId, item]));
        const verified = [];
        for (const item of incoming) {
          if (item?.kind !== "image") return { error: "Solo puedes añadir imágenes a una pregunta." };
          try {
            verified.push(previous.get(item.publicId) ?? await verifyAsset(course.id, item));
          } catch {
            return { error: "No se pudo verificar la imagen de una pregunta." };
          }
        }
        bank.push({ _id, prompt, options, correctOptionIndex, points, images: verified });
      }
      chapter.set({
        questions: bank,
        evaluation: { questionsPerAttempt, timeLimitMinutes, maxGrade, allowAnswerChanges },
      });
      destination = `${ACADEMY_COURSES_PATH}?edit=${course.id}&section=chapter&chapter=${chapter.id}`;
    }

    await course.save();
    savedVersion = course.__v ?? 0;
    destination ??= `${ACADEMY_COURSES_PATH}?edit=${course.id}`;
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) {
      return { error: Object.values(error.errors)[0]?.message || "Revisa los datos del curso." };
    }
    if (error instanceof mongoose.Error.VersionError) {
      return { error: "Otro usuario guardó cambios en este curso. Vuelve a abrirlo para ver la versión actual." };
    }
    return { error: "No se pudo guardar. Revisa los datos e inténtalo de nuevo." };
  }

  revalidatePath(ACADEMY_ADMIN.href);
  revalidatePath(ACADEMY_COURSES_PATH);
  if (autoSave) return { version: savedVersion };
  redirect(destination);
}
