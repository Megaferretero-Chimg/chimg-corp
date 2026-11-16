import { redirect } from "next/navigation";

import AccessDenied from "@/components/auth/AccessDenied";
import { requireRequestAccess } from "@/lib/access-control";
import { ACADEMY_ADMIN, ACADEMY_MODULE } from "@/modules/academy/module";

export const metadata = { title: "Academia | Control de Asistencia" };

export default async function AcademyHomePage() {
  const { isAllowed } = await requireRequestAccess(ACADEMY_MODULE.homeHref);
  if (!isAllowed) return <AccessDenied />;
  redirect(ACADEMY_ADMIN.href);
}
