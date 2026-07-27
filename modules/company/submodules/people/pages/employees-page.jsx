import ModuleShell from "@/components/shell/ModuleShell";
import EmployeeManagement from "@/modules/company/submodules/people/components/employees/EmployeeManagement";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getCompanyModuleForUser } from "@/modules/company/module";

export const metadata = {
  title: "Empleados | Empresa y configuración global",
};

function firstSearchParam(value) {
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

export default async function CompanyEmployeesPage({ searchParams }) {
  const user = await requireAuthenticatedUser();
  const params = await searchParams;
  const requestedPage = Number(firstSearchParam(params?.page) || 1);
  const initialUrlState = {
    search: firstSearchParam(params?.q),
    page: Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1,
    area: firstSearchParam(params?.area),
    role: firstSearchParam(params?.role),
    branch: firstSearchParam(params?.branch),
    relation: firstSearchParam(params?.relation),
  };

  return (
    <ModuleShell
      moduleConfig={getCompanyModuleForUser(user)}
      title="Empleados"
      description="Administra la base global de empleados, reutilizable por otros módulos de la plataforma."
    >
      <EmployeeManagement initialUrlState={initialUrlState} />
    </ModuleShell>
  );
}
