import { redirect } from "next/navigation";

import { companyModulePath } from "@/modules/company/routes";

export const metadata = {
  title: "Áreas | Control de Asistencia",
};

export default function SettingsAreasPage() {
  redirect(companyModulePath("/areas"));
}
