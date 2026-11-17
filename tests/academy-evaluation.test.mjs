import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import { evaluationAvailability, hasPassedEvaluation, passingGrade } from "../modules/academy/lib/evaluation-policy.js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/modules/academy/module") {
      return nextResolve(new URL("../modules/academy/module.js", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { getLearningSteps } = await import("../modules/academy/lib/learning-steps.js");

test("existing failed results do not complete a course or unlock its final evaluation", () => {
  const course = {
    chapters: [
      { _id: "chapter", lessons: [{ _id: "lesson" }], questions: [{ _id: "question" }] },
      { _id: "chapter2", lessons: [{ _id: "lesson2" }], questions: [] },
    ],
    finalEvaluation: { questions: [{ _id: "final-question" }] },
  };
  const progress = {
    completedLessonIds: ["lesson", "lesson2"],
    attempts: { chapter: { maxGrade: 10, result: { grade: 4 } } },
  };
  let sections = getLearningSteps(course, progress);
  assert.equal(sections[0].steps[1].done, false);
  assert.equal(sections[2].steps[0].locked, true);
  progress.attempts.chapter.result.grade = 7;
  sections = getLearningSteps(course, progress);
  assert.equal(sections[0].steps[1].done, true);
  assert.equal(sections[2].steps[0].locked, false);
});

test("passing grade follows the evaluation scale and includes the exact threshold", () => {
  assert.equal(passingGrade(10), 7);
  assert.equal(passingGrade(20), 14);
  assert.equal(hasPassedEvaluation({ maxGrade: 20, result: { grade: 13.99 } }), false);
  assert.equal(hasPassedEvaluation({ maxGrade: 20, result: { grade: 14 } }), true);
  assert.equal(hasPassedEvaluation({ maxGrade: 10 }), false);
});

test("three attempts block retries until midnight in Ecuador", () => {
  const attempt = { day: "2026-11-17", dailyCount: 3, maxGrade: 10, result: { grade: 4 } };
  const before = evaluationAvailability(attempt, Date.parse("2026-11-18T04:59:59Z"));
  assert.equal(before.remaining, 0);
  assert.equal(before.nextAvailableAt.toISOString(), "2026-11-18T05:00:00.000Z");
  const after = evaluationAvailability(attempt, Date.parse("2026-11-18T05:00:00Z"));
  assert.equal(after.used, 0);
  assert.equal(after.remaining, 3);
});

test("legacy results count as one attempt and a passing result stays approved the next day", () => {
  const now = Date.parse("2026-11-17T15:00:00Z");
  assert.equal(evaluationAvailability({ maxGrade: 10, result: { grade: 4 } }, now).remaining, 2);
  assert.equal(evaluationAvailability(null, now).remaining, 3);
  const approved = evaluationAvailability({ day: "2026-11-16", dailyCount: 3, maxGrade: 10, result: { grade: 8 } }, now);
  assert.equal(approved.passed, true);
});
