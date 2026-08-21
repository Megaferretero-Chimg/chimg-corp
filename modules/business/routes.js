export const BUSINESS_MODULE_BASE_PATH = "/modules/business";

export function businessModulePath(pathname = "") {
  const normalized = String(pathname || "").trim();

  if (!normalized || normalized === "/") {
    return BUSINESS_MODULE_BASE_PATH;
  }

  return `${BUSINESS_MODULE_BASE_PATH}${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
}
