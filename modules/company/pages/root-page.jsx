import { redirect } from "next/navigation";

import { COMPANY_EMPLOYEES_PATH, getDefaultLandingPathForUser, isCompanyEmployeeOnlyUser, requireAuthenticatedUser } from "@/lib/access-control";
import { companyModulePath } from "@/modules/company/routes";

export default async function CompanyPage() {
  const user = await requireAuthenticatedUser();

  if (isCompanyEmployeeOnlyUser(user)) {
    redirect(COMPANY_EMPLOYEES_PATH);
  }

  if (getDefaultLandingPathForUser(user) !== "/modules") {
    redirect(getDefaultLandingPathForUser(user));
  }

  redirect(companyModulePath("/home"));
}
