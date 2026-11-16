import { ArrowLeft, ChevronRight, Pencil, Plus, Settings2 } from "lucide-react";
import Link from "next/link";

import { ACADEMY_COURSES_PATH } from "@/modules/academy/module";
import styles from "@/modules/academy/styles/course-overview.module.scss";

export default function CourseOverview({ course, category }) {
  const href = `${ACADEMY_COURSES_PATH}?edit=${course._id}`;
  const chapters = course.chapters ?? [];
  const published = course.status === "published";

  return (
    <div className={styles.page}>
      <Link href={ACADEMY_COURSES_PATH} className={styles.back}><ArrowLeft size={17} aria-hidden="true" /> Cursos</Link>
      <section className={styles.hero}>
        <div className={styles.heading}>
          <div className={styles.metadata}>
            <span>{category}</span>
            <span className={styles.status} data-published={published}>{published ? "Publicado" : "Borrador"}</span>
          </div>
          <h1>{course.title}</h1>
          {course.description && <p className={styles.description}>{course.description}</p>}
        </div>
        <div className={styles.actions}>
          <Link href={`${href}&section=base`} aria-label="Editar información del curso" title="Editar información"><Pencil size={18} aria-hidden="true" /></Link>
          <Link href={`${href}&section=settings`} aria-label="Configurar cargos y publicación" title="Cargos y publicación"><Settings2 size={18} aria-hidden="true" /></Link>
        </div>
      </section>

      <section aria-labelledby="chapters-title">
        <div className={styles.sectionHeader}>
          <h2 id="chapters-title">Capítulos <span>{chapters.length}</span></h2>
          <Link className={styles.create} href={`${href}&section=chapter&chapter=new`} scroll={false}><Plus size={17} aria-hidden="true" /> Crear capítulo</Link>
        </div>
        {chapters.length ? (
          <ol className={styles.chapters}>
            {chapters.map((chapter, index) => (
              <li key={String(chapter._id)}>
                <Link className={styles.chapter} href={`${href}&section=chapter&chapter=${chapter._id}`}>
                  <span className={styles.number} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <div className={styles.chapterCopy}>
                    <h3>{chapter.title}</h3>
                    <p>{chapter.lessons.length} lecciones · {chapter.questions?.length ?? 0} preguntas</p>
                  </div>
                  <ChevronRight size={18} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <div className={styles.empty}>
            <h3>Aún no hay capítulos</h3>
            <p>Crea el primero para añadir sus lecciones y evaluación.</p>
          </div>
        )}
      </section>
      {course.finalEvaluation?.questions?.length > 0 && (
        <p className={styles.legacy}>Este curso conserva su evaluación final anterior.</p>
      )}
    </div>
  );
}
