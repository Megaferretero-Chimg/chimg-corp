export const PLANNING_MODULE_BASE_PATH = "/modules/planning";

export function planningModulePath(pathname = "") {
  const normalized = String(pathname || "").trim();

  if (!normalized || normalized === "/") {
    return PLANNING_MODULE_BASE_PATH;
  }

  return `${PLANNING_MODULE_BASE_PATH}${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
}
