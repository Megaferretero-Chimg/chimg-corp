import ModuleShell from "@/components/shell/ModuleShell";
import BranchManagement from "@/modules/company/submodules/organization/components/BranchManagement";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getCompanyModuleForUser } from "@/modules/company/module";

export const metadata = {
  title: "Sucursales | Empresa y configuración global",
};

export default async function CompanyBranchesPage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      moduleConfig={getCompanyModuleForUser(user)}
      title="Sucursales"
      description="Administra el catálogo global de sucursales que luego podrá ser reutilizado por otros módulos de la plataforma."
    >
      <BranchManagement />
    </ModuleShell>
  );
}
