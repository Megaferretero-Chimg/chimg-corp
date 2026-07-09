import { redirect } from "next/navigation";

import { planningModulePath } from "@/modules/planner/routes";

export const metadata = {
  title: "Horario vs picadas | Control de Asistencia",
};

export default function PlanningWeeklyPage() {
  redirect(planningModulePath("/attendance/comparison"));
}
