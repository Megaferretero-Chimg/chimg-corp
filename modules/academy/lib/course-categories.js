import CourseCategory from "@/modules/academy/models/CourseCategory";

const builtInCategories = [
  { value: "onboarding", label: "Inducción", builtIn: true },
  { value: "express", label: "Curso exprés", builtIn: true },
];

export function normalizeCategoryName(name) {
  return name.trim().replace(/\s+/g, " ").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}

export function isBuiltInCategoryName(name) {
  return builtInCategories.some(({ label }) => normalizeCategoryName(label) === name);
}

export async function listCourseCategories({ includeArchived = false } = {}) {
  const categories = await CourseCategory.find().select("name code isActive").sort({ name: 1 }).lean();
  const overrides = new Map(categories.filter(({ code }) => code).map((category) => [category.code, category]));
  const result = [
    ...builtInCategories.map((category) => {
      const saved = overrides.get(category.value);
      return { ...category, label: saved?.name ?? category.label, isActive: saved?.isActive !== false };
    }),
    ...categories.filter(({ code }) => !code).map(({ _id, name, isActive }) => ({
      value: String(_id), label: name, builtIn: false, isActive: isActive !== false,
    })),
  ];
  return includeArchived ? result : result.filter(({ isActive }) => isActive);
}

export async function courseCategoryExists(value) {
  const categories = await listCourseCategories();
  return categories.some((category) => category.value === value);
}
