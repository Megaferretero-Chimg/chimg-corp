import mongoose from "mongoose";

import Link from "next/link";
import connectToDatabase from "@/lib/db/mongodb";
import AcademyShell from "@/modules/academy/components/AcademyShell";
import CourseCatalog from "@/modules/academy/components/CourseCatalog";
import ChapterOverview from "@/modules/academy/components/ChapterOverview";
import CourseOverview from "@/modules/academy/components/CourseOverview";
import EvaluationEditor from "@/modules/academy/components/EvaluationEditor";
import CourseEditor from "@/modules/academy/components/CourseEditor";
import { lessonPreviewUrl } from "@/modules/academy/lib/cloudinary";
import { listCourseCategories } from "@/modules/academy/lib/course-categories";
import Course from "@/modules/academy/models/Course";
import { ACADEMY_COURSES_PATH } from "@/modules/academy/module";
import styles from "@/modules/academy/styles/admin.module.scss";
import Role from "@/modules/company/models/Role";

export const metadata = { title: "Cursos | Academia" };

async function CoursesContent({ params }) {
  const { edit, section, chapter: chapterId, lesson: lessonId, mode } = params;
  await connectToDatabase();
  const categories = await listCourseCategories({ includeArchived: true });
  const categoryNames = new Map(categories.map(({ value, label }) => [value, label]));

  if (edit && edit !== "new") {
    const course = mongoose.isObjectIdOrHexString(edit) ? await Course.findById(edit).lean() : null;
    if (!course) {
      return <p className={styles.panel}>El curso solicitado no está disponible. <Link href={ACADEMY_COURSES_PATH}>Volver a cursos</Link></p>;
    }

    const href = `${ACADEMY_COURSES_PATH}?edit=${course._id}`;
    if (section === "base" || section === "settings" || section === "chapter") {
      const chapter = section === "chapter"
        ? (course.chapters ?? []).find(({ _id }) => String(_id) === chapterId)
        : undefined;
      if (section === "chapter" && !chapter && chapterId !== "new") {
        return <p className={styles.panel}>El capítulo solicitado no está disponible. <Link href={href}>Volver al curso</Link></p>;
      }

      if (chapter && mode === "evaluation") {
        const questions = JSON.parse(JSON.stringify(chapter.questions ?? []));
        const previewUrls = Object.fromEntries(questions.flatMap(({ image, images }) => images ?? (image ? [image] : [])).map((image) => [
          image.publicId, lessonPreviewUrl(String(course._id), image),
        ]));
        return (
          <EvaluationEditor
            key={String(chapter._id)}
            courseId={String(course._id)}
            version={course.__v ?? 0}
            chapterId={String(chapter._id)}
            chapterTitle={chapter.title}
            questions={questions}
            evaluation={chapter.evaluation}
            previewUrls={previewUrls}
          />
        );
      }

      if (chapter && mode !== "edit") {
        const lesson = chapter.lessons.find(({ _id }) => String(_id) === lessonId);
        if (lessonId && !lesson && lessonId !== "new") {
          return <p className={styles.panel}>La lección ya no está disponible. <Link href={`${href}&section=chapter&chapter=${chapter._id}`}>Volver al capítulo</Link></p>;
        }
        const assets = lesson?.blocks
          ? lesson.blocks.flatMap(({ asset, images, assets }) => assets ?? images ?? (asset ? [asset] : []))
          : lesson?.media ?? [];
        const previewUrls = Object.fromEntries(assets.map((asset) => [
          asset.publicId, lessonPreviewUrl(String(course._id), asset),
        ]));
        return (
          <>
            {(!lessonId || lessonId === "new") && <ChapterOverview course={course} chapter={chapter} />}
            {lessonId && (
              <CourseEditor
                key={`${course._id}-${chapter._id}-${lessonId}`}
                section="lesson"
                course={{ _id: String(course._id), __v: course.__v }}
                chapter={{ _id: String(chapter._id), title: chapter.title }}
                lesson={lesson ? JSON.parse(JSON.stringify(lesson)) : undefined}
                previewUrls={previewUrls}
              />
            )}
          </>
        );
      }

      const roles = section === "settings" ? await Role.find({
        $or: [{ isActive: { $ne: false } }, { _id: { $in: course.roleIds || [] } }],
      }).select("name areaCode isActive").sort({ name: 1, areaCode: 1 }).lean() : [];

      return (
        <>
          {section === "chapter" && !chapter && (
            <CourseOverview course={course} category={categoryNames.get(course.type) ?? "Categoría no disponible"} />
          )}
          <CourseEditor
          key={`${course._id}-${section}-${chapterId ?? ""}`}
          section={section}
          categories={section === "base" ? categories.filter((category) => category.isActive || category.value === course.type) : []}
          course={{
            _id: String(course._id), __v: course.__v, title: course.title,
            description: course.description, type: course.type, status: course.status,
            roleIds: (course.roleIds ?? []).map(String),
          }}
          chapter={chapter ? JSON.parse(JSON.stringify(chapter)) : undefined}
          roles={roles.map(({ _id, name, areaCode, isActive }) => ({ id: String(_id), name, areaCode, isActive }))}
          />
        </>
      );
    }

    return <CourseOverview course={course} category={categoryNames.get(course.type) ?? "Categoría no disponible"} />;
  }

  const courses = await Course.find().select("title description type status roleIds").sort({ updatedAt: -1 }).lean();
  const roleIds = [...new Set(courses.flatMap((course) => (course.roleIds ?? []).map(String)))];
  const roles = await Role.find({ _id: { $in: roleIds } }).select("name areaCode").sort({ name: 1, areaCode: 1 }).lean();

  return (
    <>
      <CourseCatalog
        courses={courses.map(({ _id, title, description, type, status, roleIds }) => ({
          id: String(_id), title, description, category: categoryNames.get(type) ?? "Categoría no disponible", status, roleIds: (roleIds ?? []).map(String),
        }))}
        roles={roles.map(({ _id, name, areaCode }) => ({
          id: String(_id), label: areaCode ? `${name} · ${areaCode}` : name,
        }))}
      />
      {edit === "new" && <CourseEditor section="base" categories={categories.filter(({ isActive }) => isActive)} />}
    </>
  );
}

export default async function AcademyCoursesPage({ searchParams }) {
  const params = await searchParams;
  return (
    <AcademyShell showHeader={!params.edit || params.edit === "new"} path={ACADEMY_COURSES_PATH} title="Cursos" description="Administra los cursos, sus capítulos, lecciones y evaluaciones por capítulo.">
      {() => <CoursesContent params={params} />}
    </AcademyShell>
  );
}
