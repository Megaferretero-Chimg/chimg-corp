import ModuleShell from "@/components/shell/ModuleShell";
import MonthlyReportsLoadingState from "@/modules/planner/components/reports/MonthlyReportsLoadingState";

export default function ReportsMonthlyLoading() {
  return (
    <ModuleShell
      title="Reporte mensual"
      description="Resumen básico mes a mes con cierre, horas, costos y exportables principales."
    >
      <MonthlyReportsLoadingState />
    </ModuleShell>
  );
}
