import { redirect } from "next/navigation";

import { planningModulePath } from "@/modules/planner/routes";

export default async function ReportsPlanVsRealPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const params = new URLSearchParams();

  if (resolvedSearchParams?.month) params.set("month", resolvedSearchParams.month);

  redirect(`${planningModulePath("/history")}${params.size ? `?${params.toString()}` : ""}`);
}
