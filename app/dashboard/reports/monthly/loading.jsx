import DashboardShell from "@/components/dashboard/DashboardShell";
import MonthlyReportsLoadingState from "@/components/reports/MonthlyReportsLoadingState";

export default function ReportsMonthlyLoading() {
  return (
    <DashboardShell
      title="Reporte mensual"
      description="Resumen básico mes a mes con cierre, horas, costos y exportables principales."
    >
      <MonthlyReportsLoadingState />
    </DashboardShell>
  );
}
