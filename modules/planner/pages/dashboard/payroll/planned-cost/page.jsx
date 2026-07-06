import { redirect } from "next/navigation";

import { planningModulePath } from "@/modules/planner/routes";

export default async function PayrollPlannedCostPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const params = new URLSearchParams();

  ["month", "branchCode", "areaCode"].forEach((key) => {
    if (resolvedSearchParams?.[key]) params.set(key, resolvedSearchParams[key]);
  });

  redirect(`${planningModulePath("/payroll")}${params.size ? `?${params.toString()}` : ""}`);
}
