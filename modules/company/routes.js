export const COMPANY_MODULE_BASE_PATH = "/modules/company";

export function companyModulePath(pathname = "") {
  const normalized = String(pathname || "").trim();

  if (!normalized || normalized === "/") {
    return COMPANY_MODULE_BASE_PATH;
  }

  return `${COMPANY_MODULE_BASE_PATH}${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
}
