import { headers } from "next/headers";

import AccessDenied from "@/components/auth/AccessDenied";
import { ModuleConfigProvider } from "@/components/shell/ModuleConfigProvider";
import { requireRequestAccess } from "@/lib/access-control";
import { getPlanningModuleForUser } from "@/modules/planner/module";

export default async function DashboardLayout({ children }) {
  const headerStore = await headers();

  const access = await requireRequestAccess(headerStore.get("x-control-asistencia-path") || "/modules/planning");

  if (!access.isAllowed) {
    return <AccessDenied />;
  }

  return (
    <ModuleConfigProvider value={getPlanningModuleForUser(access.user)}>
      {children}
    </ModuleConfigProvider>
  );
}
