import { headers } from "next/headers";

import { requireRequestAccess } from "@/lib/access-control";

export default async function DashboardLayout({ children }) {
  const headerStore = await headers();

  await requireRequestAccess(headerStore.get("x-control-asistencia-path") || "/dashboard");

  return children;
}
