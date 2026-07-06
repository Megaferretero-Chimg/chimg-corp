import ModuleShell from "@/components/shell/ModuleShell";
import UserManagement from "@/modules/company/submodules/access/components/UserManagement";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getCompanyModuleForUser } from "@/modules/company/module";

export const metadata = {
  title: "Usuarios | Empresa y configuración global",
};

export default async function CompanyUsersPage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      moduleConfig={getCompanyModuleForUser(user)}
      title="Usuarios"
      description="Accesos a la plataforma ligados a empleados activos."
    >
      <UserManagement />
    </ModuleShell>
  );
}
