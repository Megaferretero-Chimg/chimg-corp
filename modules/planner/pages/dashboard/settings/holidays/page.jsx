import { redirect } from "next/navigation";

import { planningModulePath } from "@/modules/planner/routes";

export default function SettingsHolidaysPage() {
  redirect(planningModulePath("/planning/holidays"));
}
