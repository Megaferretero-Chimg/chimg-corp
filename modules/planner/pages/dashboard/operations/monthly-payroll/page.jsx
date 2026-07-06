import MonthlyClosureView from "@/modules/planner/components/attendance/MonthlyClosureView";
import ModuleShell from "@/components/shell/ModuleShell";

export const metadata = {
  title: "Pre-nómina | Control de Asistencia",
};

export default function OperationsMonthlyPayrollPage() {
  return (
    <ModuleShell
      title="Pre-nómina"
      description="Tabla final simple con horas suplementarias, extraordinarias y sueldo registrado antes del cierre mensual."
    >
      <MonthlyClosureView view="payroll" />
    </ModuleShell>
  );
}
