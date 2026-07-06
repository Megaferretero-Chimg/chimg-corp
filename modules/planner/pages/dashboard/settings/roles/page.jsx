import { redirect } from "next/navigation";

import { companyModulePath } from "@/modules/company/routes";

export const metadata = {
  title: "Roles | Control de Asistencia",
};

export default function SettingsRolesPage() {
  redirect(companyModulePath("/roles"));
}
