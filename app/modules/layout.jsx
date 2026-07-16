import { headers } from "next/headers";

import AccessDenied from "@/components/auth/AccessDenied";
import { requireRequestAccess } from "@/lib/access-control";

export default async function ModulesLayout({ children }) {
  const headerStore = await headers();

  const access = await requireRequestAccess(headerStore.get("x-control-asistencia-path") || "/modules");

  if (!access.isAllowed) {
    return <AccessDenied />;
  }

  return children;
}
