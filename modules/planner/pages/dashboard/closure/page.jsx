import { redirect } from "next/navigation";

import { planningModulePath } from "@/modules/planner/routes";

export const metadata = {
  title: "Control operativo | Control de Asistencia",
};

export default function OperationalClosurePage() {
  redirect(planningModulePath("/operations"));
}
