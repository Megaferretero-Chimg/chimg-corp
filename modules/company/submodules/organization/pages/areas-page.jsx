import ModuleShell from "@/components/shell/ModuleShell";
import AreaManagement from "@/modules/company/submodules/organization/components/AreaManagement";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getCompanyModuleForUser } from "@/modules/company/module";

export const metadata = {
  title: "Áreas | Empresa y configuración global",
};

export default async function CompanyAreasPage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      moduleConfig={getCompanyModuleForUser(user)}
      title="Áreas"
      description="Administra el catálogo global de áreas que podrá reutilizarse en cualquier sucursal y en distintos módulos de la plataforma."
    >
      <AreaManagement />
    </ModuleShell>
  );
}
