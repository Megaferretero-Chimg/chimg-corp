import { headers } from "next/headers";

import { requireRequestAccess } from "@/lib/access-control";

export default async function ModulesLayout({ children }) {
  const headerStore = await headers();

  await requireRequestAccess(headerStore.get("x-control-asistencia-path") || "/modules");

  return children;
}
