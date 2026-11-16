import { ArrowLeft, BookOpen, ClipboardList, Pencil, Plus } from "lucide-react";
import Link from "next/link";

import { ACADEMY_COURSES_PATH } from "@/modules/academy/module";
import styles from "@/modules/academy/styles/course-overview.module.scss";

export default function ChapterOverview({ course, chapter }) {
  const courseHref = `${ACADEMY_COURSES_PATH}?edit=${course._id}`;
  const href = `${courseHref}&section=chapter&chapter=${chapter._id}`;

  const questionCount = chapter.questions?.length ?? 0;

  return (
    <div className={styles.page}>
      <Link href={courseHref} className={styles.back}><ArrowLeft size={17} aria-hidden="true" /> {course.title}</Link>
      <section className={styles.hero}>
        <div className={styles.heading}><h1>{chapter.title}</h1></div>
        <div className={styles.actions}>
          <Link href={`${href}&mode=edit`} aria-label="Editar capítulo" title="Editar capítulo"><Pencil size={18} aria-hidden="true" /></Link>
        </div>
      </section>
      <section aria-labelledby="lessons-title">
        <div className={styles.sectionHeader}>
          <h2 id="lessons-title">Lecciones <span>{chapter.lessons.length}</span></h2>
          <Link className={styles.create} href={`${href}&lesson=new`} scroll={false}><Plus size={17} aria-hidden="true" /> Crear lección</Link>
        </div>
        {chapter.lessons.length ? (
          <ol className={styles.lessonGrid}>
            {chapter.lessons.map((lesson, index) => (
              <li key={String(lesson._id)}>
                <Link className={styles.lessonCard} href={`${href}&lesson=${lesson._id}`}>
                  <span className={styles.lessonNumber}><BookOpen size={19} aria-hidden="true" /> {String(index + 1).padStart(2, "0")}</span>
                  <h3>{lesson.title}</h3>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <div className={styles.empty}><h3>Aún no hay lecciones</h3><p>Crea la primera para añadir su contenido.</p></div>
        )}
      </section>
      <div className={styles.lessonGrid}>
        <Link className={`${styles.lessonCard} ${styles.evaluationCard}`} href={`${href}&mode=evaluation`}>
          <span className={styles.lessonNumber}>
            <ClipboardList size={19} aria-hidden="true" />
            {questionCount} {questionCount === 1 ? "pregunta" : "preguntas"}
          </span>
          <h2 className={styles.evaluationCardTitle}>Evaluación</h2>
        </Link>
      </div>
    </div>
  );
}
