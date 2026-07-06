import { redirect } from "next/navigation";

import { planningModulePath } from "@/modules/planner/routes";

export default function AttendanceMonthlyClosurePage() {
  redirect(planningModulePath("/operations/monthly-summary"));
}
