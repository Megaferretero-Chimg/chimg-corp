import ModuleShell from "@/components/shell/ModuleShell";
import EmployeeMonthlySummaryView from "@/modules/planner/components/payroll/EmployeeMonthlySummaryView";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";

export const metadata = {
  title: "Resumen por empleado | Control de Asistencia",
};

export default async function PayrollByEmployeePage({ searchParams }) {
  const resolvedSearchParams = await searchParams;

  return (
    <ModuleShell
      title="Resumen por empleado"
      description="Consulta mensual individual con salario, horas planificadas, horas registradas, autorizaciones, novedades y valores por día."
    >
      <EmployeeMonthlySummaryView
        initialEmployeeId={resolvedSearchParams?.employeeId || ""}
        initialMonth={resolvedSearchParams?.month || formatEcuadorMonthKey()}
      />
    </ModuleShell>
  );
}
