import { redirect } from "next/navigation";

import { planningModulePath } from "@/lib/modules/planning/routes";

export default async function PayrollExecutedCostPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const params = new URLSearchParams();

  ["month", "branchCode", "areaCode"].forEach((key) => {
    if (resolvedSearchParams?.[key]) params.set(key, resolvedSearchParams[key]);
  });

  redirect(`${planningModulePath("/payroll")}${params.size ? `?${params.toString()}` : ""}`);
}
