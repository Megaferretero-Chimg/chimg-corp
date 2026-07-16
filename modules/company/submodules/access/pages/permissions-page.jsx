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
      description="Crea perfiles personalizados y define las páginas y acciones disponibles para cada uno. El perfil Administrador permanece protegido."
    >
      <UserTypeManagement />
    </ModuleShell>
  );
}
