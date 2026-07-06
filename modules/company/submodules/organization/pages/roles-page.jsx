import ModuleShell from "@/components/shell/ModuleShell";
import RoleManagement from "@/modules/company/submodules/organization/components/RoleManagement";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getCompanyModuleForUser } from "@/modules/company/module";

export const metadata = {
  title: "Cargos | Empresa y configuración global",
};

export default async function CompanyRolesPage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      moduleConfig={getCompanyModuleForUser(user)}
      title="Cargos"
      description="Administra las posiciones de trabajo y relaciónalas con las áreas definidas por la empresa."
    >
      <RoleManagement />
    </ModuleShell>
  );
}
