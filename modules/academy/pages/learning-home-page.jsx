import { ArrowRight, BookOpen, Check, Layers } from "lucide-react";
import Link from "next/link";
import LearningPageEntrance from "@/modules/academy/components/LearningPageEntrance";

import { assignedCourseFilter, getLearner } from "@/modules/academy/lib/learner-access";
import { courseLearningPath, getLearningSteps } from "@/modules/academy/lib/learning-steps";
import Course from "@/modules/academy/models/Course";
import LearningProgress from "@/modules/academy/models/LearningProgress";
import styles from "@/modules/academy/styles/learning.module.scss";

export const metadata = { title: "Mis cursos | Academia" };

export default async function LearningHomePage() {
  const learner = await getLearner();
  const courses = await Course.find(assignedCourseFilter(learner))
    .select("title description chapters._id chapters.lessons._id chapters.questions._id finalEvaluation.questions._id")
    .sort({ title: 1 }).lean();
  const records = await LearningProgress.find({ employeeId: learner.employeeId, courseId: { $in: courses.map(({ _id }) => _id) } })
    .select("courseId completedLessonIds attempts").lean();
  const progressByCourse = new Map(records.map((record) => [String(record.courseId), record]));
  const courseCards = courses.map((course) => {
    const steps = getLearningSteps(course, progressByCourse.get(String(course._id))).flatMap((section) => section.steps);
    const completed = steps.filter(({ done }) => done).length;
    return {
      course,
      completed,
      total: steps.length,
      finished: steps.length > 0 && completed === steps.length,
      lessons: steps.filter(({ kind }) => kind === "lesson").length,
    };
  });
  const finishedCount = courseCards.filter(({ finished }) => finished).length;
  const inProgressCount = courseCards.filter(({ completed, finished }) => completed > 0 && !finished).length;

  return (
    <LearningPageEntrance transitionKey="courses">
      <header className={styles.intro}>
        <div className={styles.introCopy}>
          <h1>Mis cursos</h1>
          <p>Un paso más en tu aprendizaje.<br />Continúa con tus capacitaciones a tu ritmo.</p>
        </div>
        <dl className={styles.summary}>
          <div><dt>Asignados</dt><dd>{courses.length}</dd></div>
          <div><dt>En curso</dt><dd>{inProgressCount}</dd></div>
          <div><dt>Completados</dt><dd>{finishedCount}</dd></div>
        </dl>
      </header>
      {courses.length === 0 ? (
        <section className={styles.panel}><h2>No tienes cursos asignados</h2><p>Las capacitaciones asignadas a tu cargo aparecerán aquí.</p></section>
      ) : (
        <ul className={styles.cards}>
          {courseCards.map(({ course, completed, total, finished, lessons }) => {
            const id = String(course._id);
            const percent = total ? Math.round(completed / total * 100) : 0;
            return (
              <li key={id} className={styles.courseCard}>
                <div className={styles.cardTop}>
                  <span className={styles.courseIcon}><BookOpen size={28} strokeWidth={1.5} aria-hidden="true" /></span>
                  <span className={`${styles.badge} ${finished ? styles.badgeComplete : ""}`}>
                    {finished && <Check size={13} aria-hidden="true" />}
                    {finished ? "Completado" : completed ? "En curso" : "Pendiente"}
                  </span>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.courseMeta}>
                    <span><Layers size={14} aria-hidden="true" />{course.chapters.length} {course.chapters.length === 1 ? "capítulo" : "capítulos"}</span>
                    <span><BookOpen size={14} aria-hidden="true" />{lessons} {lessons === 1 ? "lección" : "lecciones"}</span>
                  </div>
                  <h2>{course.title}</h2>
                  {course.description && <p>{course.description}</p>}
                  <div className={styles.cardFooter}>
                    <div className={styles.courseProgress}>
                      <span>{completed} de {total} actividades</span>
                      <strong>{percent}%</strong>
                    </div>
                    <progress value={completed} max={total || 1} aria-label={"Progreso de " + course.title} />
                    <Link className={styles.primary} href={courseLearningPath(id)}>
                      {finished ? "Revisar curso" : completed ? "Continuar curso" : "Empezar curso"}
                      <ArrowRight size={17} aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </LearningPageEntrance>
  );
}
