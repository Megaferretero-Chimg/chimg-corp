import { redirect } from "next/navigation";

import { planningModulePath } from "@/lib/modules/planning/routes";

export default function ReportsPage() {
  redirect(planningModulePath("/reports/monthly"));
}
