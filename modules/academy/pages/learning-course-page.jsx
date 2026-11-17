import { ArrowLeft, BookOpen, Check, CircleHelp, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  completeLearningLesson,
  finishLearningAttempt,
  saveLearningAnswer,
  startLearningAttempt,
} from "@/modules/academy/actions/learner-progress";
import LessonContent from "@/modules/academy/components/LessonContent";
import CourseOutline from "@/modules/academy/components/CourseOutline";
import LearningPageEntrance from "@/modules/academy/components/LearningPageEntrance";
import LessonMediaPreview from "@/modules/academy/components/LessonMediaPreview";
import { lessonPreviewUrl } from "@/modules/academy/lib/cloudinary";
import { getLearningCourse } from "@/modules/academy/lib/learner-access";
import { DAILY_ATTEMPT_LIMIT, evaluationAvailability, passingGrade } from "@/modules/academy/lib/evaluation-policy";
import { getLearningSteps, learningStepPath } from "@/modules/academy/lib/learning-steps";
import { getLessonBlocks } from "@/modules/academy/lib/lesson-blocks";
import { ACADEMY_LEARNING } from "@/modules/academy/module";
import styles from "@/modules/academy/styles/learning.module.scss";

export const metadata = { title: "Curso | Academia" };

const formatGrade = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 });
const formatDeadline = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", dateStyle: "short", timeStyle: "short" });

function LearningLesson({ courseId, step, next }) {
  const blocks = getLessonBlocks(step.lesson);
  const previewUrls = Object.fromEntries(blocks.flatMap(({ assets }) => assets ?? []).map((asset) => [
    asset.publicId, lessonPreviewUrl(courseId, asset),
  ]));

  return (
    <>
      <LessonContent blocks={blocks} previewUrls={previewUrls} />
      <footer className={styles.actions}>
        {step.done ? (
          <>
            <span className={styles.done}><Check size={18} aria-hidden="true" />Lección completada</span>
            {next && !next.locked && <Link className={styles.primary} href={learningStepPath(courseId, next)}>Continuar</Link>}
            {!next && <Link className={styles.primary} href={ACADEMY_LEARNING.href}>Volver a Mis cursos</Link>}
          </>
        ) : (
          <form action={completeLearningLesson.bind(null, courseId, step.id)}>
            <button className={styles.primary}>Marcar como completada</button>
          </form>
        )}
      </footer>
    </>
  );
}

function LearningEvaluation({ courseId, step, attempt, now, next, courseComplete }) {
  if (step.locked) {
    return <p className={styles.notice}><LockKeyhole size={18} aria-hidden="true" />Completa las lecciones para habilitar la evaluación.</p>;
  }

  if (!attempt) {
    const count = Math.min(step.settings?.questionsPerAttempt ?? step.questions.length, step.questions.length);
    return (
      <>
        <p>{count} {count === 1 ? "pregunta" : "preguntas"} · {step.settings?.timeLimitMinutes ? step.settings.timeLimitMinutes + " min" : "Sin límite de tiempo"}</p>
        <p>Nota mínima para aprobar · {formatGrade.format(passingGrade(step.settings?.maxGrade ?? 10))} / {formatGrade.format(step.settings?.maxGrade ?? 10)}</p>
        <p>Tienes hasta {DAILY_ATTEMPT_LIMIT} intentos por día. Se renuevan a medianoche, hora de Ecuador.</p>
        {step.settings?.allowAnswerChanges === false && <p>Tu respuesta se guardará al elegirla.</p>}
        <form action={startLearningAttempt.bind(null, courseId, step.id)}>
          <button className={styles.primary}>Iniciar evaluación</button>
        </form>
      </>
    );
  }

  if (attempt.result) {
    const { grade, correct, answered } = attempt.result;
    const availability = evaluationAvailability(attempt, now);
    return (
      <>
        <section className={`${styles.result} ${availability.passed ? "" : styles.resultFailed}`}>
          <h3>{availability.passed ? "Evaluación aprobada" : "Evaluación no aprobada"}</h3>
          <strong>{formatGrade.format(grade)} / {formatGrade.format(attempt.maxGrade)}</strong>
          <p>{correct} de {attempt.questions.length} correctas · {attempt.questions.length - answered} sin responder</p>
          <p>Nota mínima · {formatGrade.format(attempt.passingGrade ?? passingGrade(attempt.maxGrade))} / {formatGrade.format(attempt.maxGrade)}</p>
        </section>
        {!availability.passed && (
          <p className={styles.retryNotice}>
            {availability.remaining > 0
              ? `Te quedan ${availability.remaining} ${availability.remaining === 1 ? "intento" : "intentos"} hoy.`
              : `Agotaste los ${DAILY_ATTEMPT_LIMIT} intentos de hoy. Podrás volver a intentarlo el ${formatDeadline.format(availability.nextAvailableAt)}, hora de Ecuador.`}
          </p>
        )}
        <footer className={styles.actions}>
          <Link className={courseComplete ? styles.primary : styles.secondary} href={ACADEMY_LEARNING.href}>Volver a Mis cursos</Link>
          {!availability.passed && availability.remaining > 0 && (
            <form action={startLearningAttempt.bind(null, courseId, step.id)}>
              <button className={styles.primary}>Volver a intentar</button>
            </form>
          )}
          {availability.passed && next && !next.locked && <Link className={styles.primary} href={learningStepPath(courseId, next)}>Continuar curso</Link>}
        </footer>
      </>
    );
  }

  const answers = attempt.answers ?? {};
  const expired = attempt.expiresAt && now >= new Date(attempt.expiresAt).getTime();
  return (
    <div className={styles.quiz}>
      <div className={styles.quizProgress}>
        <span>{Object.keys(answers).length} de {attempt.questions.length} respondidas</span>
        <span>Intento {attempt.dailyCount ?? 1} de {DAILY_ATTEMPT_LIMIT}</span>
        {attempt.expiresAt && <span>{expired ? "Tiempo agotado" : "Límite: " + formatDeadline.format(new Date(attempt.expiresAt))}</span>}
      </div>
      {attempt.questions.map((question, index) => {
        const id = String(question._id);
        const selected = answers[id];
        return (
          <fieldset key={id} className={styles.question} disabled={Boolean(expired) || (!attempt.allowAnswerChanges && selected !== undefined)}>
            <legend>{index + 1}. {question.prompt}</legend>
            {question.images?.length > 0 && <div className={styles.questionImages}>
              {question.images.map((image, imageIndex) => (
                <LessonMediaPreview key={image.publicId} asset={image} src={lessonPreviewUrl(courseId, image)} label={"Imagen " + (imageIndex + 1)} />
              ))}
            </div>}
            <form className={styles.options}>
              {question.options.map((option, optionIndex) => (
                <button
                  key={optionIndex}
                  className={styles.option}
                  aria-pressed={selected === optionIndex}
                  formAction={saveLearningAnswer.bind(null, courseId, step.id, attempt.attemptId ?? "", id, optionIndex)}
                >
                  <span className={styles.optionMark} aria-hidden="true">{selected === optionIndex && <Check size={13} />}</span>
                  {option}
                </button>
              ))}
            </form>
          </fieldset>
        );
      })}
      <form action={finishLearningAttempt.bind(null, courseId, step.id, attempt.attemptId ?? "")}>
        <button className={styles.primary}>Entregar evaluación</button>
      </form>
    </div>
  );
}

export default async function LearningCoursePage({ params, searchParams }) {
  const [{ courseId }, query] = await Promise.all([params, searchParams]);
  const { course, progress, now } = await getLearningCourse(courseId);
  const sections = getLearningSteps(course, progress);
  const steps = sections.flatMap((section) => section.steps);
  const active = query.lesson || query.evaluation
    ? steps.find((step) => step.id === query[step.kind])
    : steps.find((step) => !step.done && !step.locked) ?? steps.at(-1);
  if (!active) notFound();
  const complete = steps.filter(({ done }) => done).length;
  const next = steps[steps.indexOf(active) + 1];

  return (
    <LearningPageEntrance transitionKey={courseId + ":" + active.id}>
      <Link href={ACADEMY_LEARNING.href} className={styles.back}><ArrowLeft size={17} aria-hidden="true" />Mis cursos</Link>
      <header className={styles.courseHeader}>
        <h1>{course.title}</h1>
        {course.description && <p>{course.description}</p>}
      </header>
      <div className={styles.courseGrid}>
        <CourseOutline activeTitle={active.title}>
        <nav className={styles.outline} aria-label="Contenido del curso">
          <div className={styles.outlineHeading}>
          <div className={styles.outlineProgressTitle}>
            <h2>Tu progreso</h2>
            <span>{Math.round(complete / steps.length * 100)}%</span>
          </div>
          <p>{complete === steps.length ? "Curso completado" : complete + " de " + steps.length + " actividades"}</p>
          <progress value={complete} max={steps.length} aria-label="Progreso del curso" />
          </div>
          <div className={styles.outlineLessons}>
          {sections.map((section) => (
            <section key={section.id}>
              <h3>{section.title}</h3>
              <ul>
                {section.steps.map((step) => {
                  const Icon = step.done ? Check : step.locked ? LockKeyhole : step.kind === "lesson" ? BookOpen : CircleHelp;
                  const text = <><Icon size={16} aria-hidden="true" /><span>{step.title}</span></>;
                  return (
                    <li key={step.id}>
                      {step.locked ? <span className={styles.locked}>{text}<span className={styles.srOnly}> · Bloqueada</span></span> : (
                        <Link href={learningStepPath(courseId, step)} aria-current={step === active ? "step" : undefined}>{text}</Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          </div>
        </nav>
        </CourseOutline>
        <section key={active.id} className={`${styles.panel} ${styles.lessonPanel}`} data-kind={active.kind}>
          <header className={styles.activityHeader}>
            <span className={styles.activityKind}>{active.kind === "lesson" ? <BookOpen size={15} aria-hidden="true" /> : <CircleHelp size={15} aria-hidden="true" />}{active.kind === "lesson" ? "Lección" : "Evaluación"}</span>
            <h2 className={styles.activityTitle}>{active.title}</h2>
          </header>
          {active.kind === "lesson" ? <LearningLesson courseId={courseId} step={active} next={next} /> : (
            <LearningEvaluation courseId={courseId} step={active} attempt={progress?.attempts?.[active.id]} now={now} next={next} courseComplete={complete === steps.length} />
          )}
        </section>
      </div>
    </LearningPageEntrance>
  );
}
