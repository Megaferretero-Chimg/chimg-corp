import ModuleShell from "@/components/shell/ModuleShell";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getCompanyModuleForUser } from "@/modules/company/module";
import OrganizationStructureManager from "@/modules/company/submodules/organization/components/OrganizationStructureManager";

export const metadata = {
  title: "Estructura | Empresa y configuración global",
};

export default async function CompanyStructurePage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      moduleConfig={getCompanyModuleForUser(user)}
      title="Estructura organizacional"
      description="Visualiza y edita conexiones jerárquicas de áreas, cargos, responsables y equipos."
    >
      <OrganizationStructureManager />
    </ModuleShell>
  );
}
