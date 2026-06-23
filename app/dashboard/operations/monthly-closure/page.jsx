import MonthlyClosureView from "@/components/attendance/MonthlyClosureView";
import DashboardShell from "@/components/dashboard/DashboardShell";

export const metadata = {
  title: "Cruce de horas | Control de Asistencia",
};

export default function OperationsMonthlyClosurePage() {
  return (
    <DashboardShell
      title="Cruce de horas"
      description="Ultimo ajuste operativo para completar laborables con horas suplementarias o extraordinarias cuando haga falta."
    >
      <MonthlyClosureView view="cross" />
    </DashboardShell>
  );
}
