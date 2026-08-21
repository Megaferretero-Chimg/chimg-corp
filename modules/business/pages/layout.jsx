import { headers } from "next/headers";

import AccessDenied from "@/components/auth/AccessDenied";
import { ModuleConfigProvider } from "@/components/shell/ModuleConfigProvider";
import { requireRequestAccess } from "@/lib/access-control";
import { getBusinessModuleForUser } from "@/modules/business/module";

export default async function BusinessLayout({ children }) {
  const headerStore = await headers();
  const access = await requireRequestAccess(headerStore.get("x-control-asistencia-path") || "/modules/business");

  if (!access.isAllowed) return <AccessDenied />;

  return <ModuleConfigProvider value={getBusinessModuleForUser(access.user)}>{children}</ModuleConfigProvider>;
}
