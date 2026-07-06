import { redirect } from "next/navigation";

import { companyModulePath } from "@/modules/company/routes";

export const metadata = {
  title: "Usuarios y permisos | Control de Asistencia",
};

export default function SettingsUsersPage() {
  redirect(companyModulePath("/users"));
}
