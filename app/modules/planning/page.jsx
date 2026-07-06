import { redirect } from "next/navigation";

import { PLANNING_EXCEPTIONS_PATH, isPlanningExceptionsUser, requireAuthenticatedUser } from "@/lib/access-control";
import { planningModulePath } from "@/modules/planner/routes";

export const metadata = {
  title: "Planificación y control operativo | Control de Asistencia",
};

export default async function PlanningModuleEntryPage() {
  const user = await requireAuthenticatedUser();

  redirect(isPlanningExceptionsUser(user) ? PLANNING_EXCEPTIONS_PATH : planningModulePath("/home"));
}
