import { redirect } from "next/navigation";

import AccessDenied from "@/components/auth/AccessDenied";
import { requireRequestAccess } from "@/lib/access-control";
import { ACADEMY_ADMIN, ACADEMY_LEARNING, ACADEMY_MODULE } from "@/modules/academy/module";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";

export const metadata = { title: "Academia | Control de Asistencia" };

export default async function AcademyHomePage() {
  const { user, isAllowed } = await requireRequestAccess(ACADEMY_MODULE.homeHref);
  if (!isAllowed) return <AccessDenied />;
  redirect(hasAccessPermission(user, ACADEMY_ADMIN.permission) ? ACADEMY_ADMIN.href : ACADEMY_LEARNING.href);
}
