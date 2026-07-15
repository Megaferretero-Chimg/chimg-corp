import UserTypeManagement from "@/modules/company/submodules/access/components/UserTypeManagement";
import ModuleShell from "@/components/shell/ModuleShell";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getCompanyModuleForUser } from "@/modules/company/module";

export const metadata = {
  title: "Roles de acceso | Empresa y configuración global",
};

export default async function CompanyPermissionsPage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      moduleConfig={getCompanyModuleForUser(user)}
      title="Roles de acceso"
      description="Tres perfiles operativos protegidos y un inventario completo de páginas con su control de acceso."
    >
      <UserTypeManagement />
    </ModuleShell>
  );
}
