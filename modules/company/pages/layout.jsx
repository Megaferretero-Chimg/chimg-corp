import { headers } from "next/headers";

import AccessDenied from "@/components/auth/AccessDenied";
import { ModuleConfigProvider } from "@/components/shell/ModuleConfigProvider";
import { requireRequestAccess } from "@/lib/access-control";
import { getCompanyModuleForUser } from "@/modules/company/module";

export default async function CompanyLayout({ children }) {
  const headerStore = await headers();

  const access = await requireRequestAccess(headerStore.get("x-control-asistencia-path") || "/modules/company");

  if (!access.isAllowed) {
    return <AccessDenied />;
  }

  return (
    <ModuleConfigProvider value={getCompanyModuleForUser(access.user)}>
      {children}
    </ModuleConfigProvider>
  );
}
