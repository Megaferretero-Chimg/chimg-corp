import { redirect } from "next/navigation";
import { planningModulePath } from "@/modules/planner/routes";

export default function DashboardPage() {
  redirect(planningModulePath("/home"));
}
