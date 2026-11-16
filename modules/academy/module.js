const academyPath = "/modules/academy";

export const ACADEMY_ADMIN = {
  title: "Administración",
  href: `${academyPath}/admin`,
  permission: "academy.admin.view",
  description: "Organiza cursos, lecciones, evaluaciones y asignaciones.",
};

export const ACADEMY_COURSES_PATH = `${ACADEMY_ADMIN.href}/courses`;

export const ACADEMY_SETTINGS_PATH = `${ACADEMY_ADMIN.href}/settings`;

export const ACADEMY_MODULE = {
  key: "academy",
  title: "Academia",
  homeHref: academyPath,
  modulesHref: "/modules",
};

export const MAX_LESSON_BLOCK_IMAGES = 10;

export const MAX_QUESTION_IMAGES = 4;

export function isValidQuestionPoints(value) {
  return Number.isFinite(value) && value >= 0.01 && Number(value.toFixed(2)) === value;
}
