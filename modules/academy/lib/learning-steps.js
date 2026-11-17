import { ACADEMY_LEARNING } from "@/modules/academy/module";
import { hasPassedEvaluation } from "./evaluation-policy.js";

export function courseLearningPath(courseId) {
  return ACADEMY_LEARNING.href + "/" + courseId;
}

export function getLearningSteps(course, progress) {
  const completed = new Set(progress?.completedLessonIds ?? []);
  const attempts = progress?.attempts ?? {};

  const sections = course.chapters.map((chapter) => {
    const lessons = chapter.lessons.map((lesson) => ({
      id: String(lesson._id),
      kind: "lesson",
      title: lesson.title,
      done: completed.has(String(lesson._id)),
      lesson,
    }));
    const evaluation = chapter.questions?.length ? [{
      id: String(chapter._id),
      kind: "evaluation",
      title: "Evaluación del capítulo",
      locked: lessons.some(({ done }) => !done),
      done: hasPassedEvaluation(attempts[chapter._id]),
      questions: chapter.questions,
      settings: chapter.evaluation,
    }] : [];
    return { id: String(chapter._id), title: chapter.title, steps: [...lessons, ...evaluation] };
  });

  const legacyQuestions = course.finalEvaluation?.questions;
  if (legacyQuestions?.length && course.chapters.some(({ questions }) => !questions?.length)) {
    sections.push({
      id: "final",
      title: "Cierre del curso",
      steps: [{
        id: "final",
        kind: "evaluation",
        title: "Evaluación final",
        locked: sections.some(({ steps }) => steps.some(({ done }) => !done)),
        done: hasPassedEvaluation(attempts.final),
        questions: legacyQuestions,
      }],
    });
  }
  return sections;
}

export function learningStepPath(courseId, step) {
  return courseLearningPath(courseId) + "?" + step.kind + "=" + step.id;
}
