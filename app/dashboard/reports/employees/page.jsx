import { redirect } from "next/navigation";

import { planningModulePath } from "@/lib/modules/planning/routes";

export default async function ReportsEmployeesPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const params = new URLSearchParams();

  if (resolvedSearchParams?.month) params.set("month", resolvedSearchParams.month);

  redirect(`${planningModulePath("/reports/monthly")}${params.size ? `?${params.toString()}` : ""}`);
}
