import { redirect } from "next/navigation";

import { companyModulePath } from "@/modules/company/routes";

export const metadata = {
  title: "Sucursales | Control de Asistencia",
};

export default function SettingsBranchesPage() {
  redirect(companyModulePath("/branches"));
}
