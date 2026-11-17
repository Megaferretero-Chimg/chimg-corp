import { headers } from "next/headers";

import AccessDenied from "@/components/auth/AccessDenied";
import UserAccountMenu from "@/components/auth/UserAccountMenu";
import { requireRequestAccess } from "@/lib/access-control";
import { getModuleCardsForUser } from "@/modules/registry";

export default async function ModulesLayout({ children }) {
  const headerStore = await headers();

  const access = await requireRequestAccess(headerStore.get("x-control-asistencia-path") || "/modules");

  if (!access.isAllowed) {
    return <AccessDenied />;
  }

  const { user } = access;

  return (
    <>
      {children}
      <UserAccountMenu
        user={{
          name: user.employeeName || user.username,
          username: user.username,
          role: user.accessRoleLabel || user.accessRole,
          email: user.email || "",
        }}
        canSwitchModules={getModuleCardsForUser(user).length > 1}
      />
    </>
  );
}
