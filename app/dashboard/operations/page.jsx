import { redirect } from "next/navigation";

import { planningModulePath } from "@/lib/modules/planning/routes";

export default function OperationsPage() {
  redirect(planningModulePath("/operations/monthly-closure"));
}
