import { redirect } from "next/navigation";

import { planningModulePath } from "@/modules/planner/routes";

export const metadata = {
  title: "Configuracion | Control de Asistencia",
};

export default function DeprecatedLaborRulesPage() {
  redirect(planningModulePath("/settings"));
}
