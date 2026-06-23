import { redirect } from "next/navigation";

import { planningModulePath } from "@/lib/modules/planning/routes";

export default function AttendanceMonthlyClosurePage() {
  redirect(planningModulePath("/operations/monthly-summary"));
}
