import { redirect } from "next/navigation";

import { planningModulePath } from "@/modules/planner/routes";

export const metadata = {
  title: "Planificacion semanal | Control de Asistencia",
};

export default async function PlanningMonthlyPage({ searchParams }) {
  const {
    month = "",
    branchCode = "",
    areaCode = "",
    roleCode = "",
    week = "",
  } = await searchParams;
  const params = new URLSearchParams();

  if (month) params.set("month", month);
  if (branchCode) params.set("branchCode", branchCode);
  if (areaCode) params.set("areaCode", areaCode);
  if (roleCode) params.set("roleCode", roleCode);
  if (week) params.set("week", week);

  redirect(`${planningModulePath("/schedules")}${params.size ? `?${params.toString()}` : ""}`);
}
