import ModuleShell from "@/components/shell/ModuleShell";
import EmployeeManagement from "@/modules/company/submodules/people/components/employees/EmployeeManagement";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getCompanyModuleForUser } from "@/modules/company/module";

export const metadata = {
  title: "Empleados | Empresa y configuración global",
};

export default async function CompanyEmployeesPage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      moduleConfig={getCompanyModuleForUser(user)}
      title="Empleados"
      description="Administra la base global de empleados, reutilizable por otros módulos de la plataforma."
    >
      <EmployeeManagement />
    </ModuleShell>
  );
}
