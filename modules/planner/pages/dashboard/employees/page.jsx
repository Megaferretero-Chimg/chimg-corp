import ModuleShell from "@/components/shell/ModuleShell";
import EmployeeManagement from "@/modules/company/submodules/people/components/employees/EmployeeManagement";

export const metadata = {
  title: "Empleados | Control de Asistencia",
};

export default function DashboardEmployeesPage() {
  return (
    <ModuleShell
      title="Gestión de empleados"
      description="Registra, revisa, edita y elimina empleados. El nombre completo será la base para relacionarlos luego con el archivo del biométrico."
    >
      <EmployeeManagement />
    </ModuleShell>
  );
}
