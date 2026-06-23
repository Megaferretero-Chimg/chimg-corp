import MonthlyClosureMonthsView from "@/components/attendance/MonthlyClosureMonthsView";
import DashboardShell from "@/components/dashboard/DashboardShell";

export const metadata = {
  title: "Resumen de cierre | Control de Asistencia",
};

export default function OperationsMonthlySummaryPage() {
  return (
    <DashboardShell
      title="Resumen de cierre"
      description="Historial mensual de cierres guardados y acceso al detalle para cerrar o revisar cada mes."
    >
      <MonthlyClosureMonthsView />
    </DashboardShell>
  );
}
