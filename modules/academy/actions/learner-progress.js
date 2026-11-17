"use server";

import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";

import { gradeAttempt, selectAttemptQuestions } from "@/modules/academy/lib/evaluation-attempt";
import { evaluationAvailability, passingGrade } from "@/modules/academy/lib/evaluation-policy";
import { getLearningCourse } from "@/modules/academy/lib/learner-access";
import { getLearningSteps, learningStepPath } from "@/modules/academy/lib/learning-steps";
import LearningProgress from "@/modules/academy/models/LearningProgress";

async function getStep(courseId, kind, id) {
  const context = await getLearningCourse(courseId);
  const steps = getLearningSteps(context.course, context.progress).flatMap((section) => section.steps);
  const step = steps.find((item) => item.id === id && item.kind === kind);
  if (!step || step.locked) notFound();

  return { ...context, steps, step, href: learningStepPath(courseId, step) };
}

export async function completeLearningLesson(courseId, lessonId) {
  const { learner, course, progressId, step, steps, href } = await getStep(courseId, "lesson", lessonId);
  const filter = { _id: progressId };
  const update = {
    $setOnInsert: { employeeId: learner.employeeId, courseId: course._id },
    $addToSet: { completedLessonIds: lessonId },
  };
  try {
    await LearningProgress.updateOne(filter, update, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    await LearningProgress.updateOne(filter, update);
  }
  const next = steps[steps.indexOf(step) + 1];
  redirect(next ? learningStepPath(courseId, next) : href);
}

export async function startLearningAttempt(courseId, evaluationId) {
  const { progressId, progress, step, href, now } = await getStep(courseId, "evaluation", evaluationId);
  const { questions, settings } = step;
  const path = "attempts." + step.id;
  const previous = progress?.attempts?.[step.id];
  const availability = evaluationAvailability(previous, now);
  if (availability.passed || availability.remaining === 0 || (previous && !previous.result)) redirect(href);

  const filter = { _id: progressId, [path]: { $exists: false } };
  const history = [...(previous?.history ?? [])];
  if (previous) {
    delete filter[path];
    filter[path + ".attemptId"] = previous.attemptId ?? { $exists: false };
    filter[path + ".result.grade"] = previous.result.grade;
    history.push({
      attemptId: previous.attemptId,
      startedAt: previous.startedAt,
      finishedAt: previous.finishedAt,
      grade: previous.result.grade,
      maxGrade: previous.maxGrade,
      passingGrade: previous.passingGrade ?? passingGrade(previous.maxGrade),
    });
  }
  await LearningProgress.updateOne(filter, {
    $set: {
      [path]: {
        attemptId: randomUUID(),
        startedAt: new Date(now),
        day: availability.day,
        dailyCount: availability.used + 1,
        passingGrade: passingGrade(settings?.maxGrade ?? 10),
        history,
        questions: selectAttemptQuestions(questions.map((question) => ({
          ...question,
          _id: String(question._id),
          points: question.points ?? 1,
          images: question.images ?? (question.image ? [question.image] : []),
        })), settings?.questionsPerAttempt),
        answers: {},
        maxGrade: settings?.maxGrade ?? 10,
        allowAnswerChanges: settings?.allowAnswerChanges !== false,
        expiresAt: settings?.timeLimitMinutes ? new Date(Date.now() + settings.timeLimitMinutes * 60000) : null,
        revision: 0,
      },
    },
  });
  redirect(href);
}

export async function saveLearningAnswer(courseId, evaluationId, attemptId, questionId, option) {
  const { progressId, progress, step, href } = await getStep(courseId, "evaluation", evaluationId);
  const attempt = progress?.attempts?.[step.id];
  if ((attempt?.attemptId ?? "") !== attemptId) redirect(href);
  const question = attempt?.questions.find(({ _id }) => String(_id) === questionId);
  if (!question || !Number.isInteger(option) || option < 0 || option >= question.options.length) notFound();

  const path = "attempts." + step.id;
  const answerPath = path + ".answers." + questionId;
  const filter = {
    _id: progressId,
    [path + ".attemptId"]: attemptId || { $exists: false },
    [path + ".result"]: { $exists: false },
    $or: [{ [path + ".expiresAt"]: null }, { [path + ".expiresAt"]: { $gt: new Date() } }],
  };
  if (!attempt.allowAnswerChanges) filter[answerPath] = { $exists: false };

  await LearningProgress.updateOne(filter, {
    $set: { [answerPath]: option },
    $inc: { [path + ".revision"]: 1 },
  });
  redirect(href);
}

export async function finishLearningAttempt(courseId, evaluationId, attemptId) {
  const { progressId, progress, step, href } = await getStep(courseId, "evaluation", evaluationId);
  const path = "attempts." + step.id;
  let attempt = progress?.attempts?.[step.id];
  if (!attempt) notFound();
  if ((attempt.attemptId ?? "") !== attemptId) redirect(href);

  // An answer saved concurrently must be included in the final grade.
  for (let retries = 0; retries < 3 && !attempt.result; retries++) {
    const answers = attempt.answers ?? {};
    const result = {
      ...gradeAttempt(attempt.questions, answers, attempt.maxGrade),
      answered: Object.keys(answers).length,
    };
    const saved = await LearningProgress.updateOne({
      _id: progressId,
      [path + ".attemptId"]: attemptId || { $exists: false },
      [path + ".result"]: { $exists: false },
      [path + ".revision"]: attempt.revision,
    }, { $set: { [path + ".result"]: result, [path + ".finishedAt"]: new Date() } });
    if (saved.modifiedCount) break;
    const current = await LearningProgress.findById(progressId).select(path).lean();
    attempt = current?.attempts?.[step.id];
    if (!attempt) notFound();
    if ((attempt.attemptId ?? "") !== attemptId) redirect(href);
  }
  redirect(href);
}
