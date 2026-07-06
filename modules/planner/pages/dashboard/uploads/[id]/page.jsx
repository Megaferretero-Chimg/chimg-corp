import { redirect } from "next/navigation";

import { planningModulePath } from "@/modules/planner/routes";

export default async function UploadNormalizationPage({ params }) {
  const { id } = await params;

  redirect(planningModulePath(`/attendance/uploads/${id}`));
}
