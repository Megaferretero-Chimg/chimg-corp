import MonthlyClosureView from "@/components/attendance/MonthlyClosureView";
import DashboardShell from "@/components/dashboard/DashboardShell";

export const metadata = {
  title: "Pre-nómina | Control de Asistencia",
};

export default function OperationsMonthlyPayrollPage() {
  return (
    <DashboardShell
      title="Pre-nómina"
      description="Tabla final simple con horas suplementarias, extraordinarias y sueldo registrado antes del cierre mensual."
    >
      <MonthlyClosureView view="payroll" />
    </DashboardShell>
  );
}
