import { redirect } from "next/navigation";

import { planningModulePath } from "@/modules/planner/routes";

export default function OperationsPage() {
  redirect(planningModulePath("/operations/monthly-closure"));
}
