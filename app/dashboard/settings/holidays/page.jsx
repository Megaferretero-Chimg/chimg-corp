import { redirect } from "next/navigation";

import { planningModulePath } from "@/lib/modules/planning/routes";

export default function SettingsHolidaysPage() {
  redirect(planningModulePath("/planning/holidays"));
}
