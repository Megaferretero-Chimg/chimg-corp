import { redirect } from "next/navigation";

import { planningModulePath } from "@/modules/planner/routes";

export const metadata = {
  title: "Horarios por cargo | Control de Asistencia",
};

export default function DeprecatedPunchRulesPage() {
  redirect(planningModulePath("/settings/role-schedules"));
}
