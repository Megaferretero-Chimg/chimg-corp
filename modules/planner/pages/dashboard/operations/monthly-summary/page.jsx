import MonthlyClosureMonthsView from "@/modules/planner/components/attendance/MonthlyClosureMonthsView";
import ModuleShell from "@/components/shell/ModuleShell";

export const metadata = {
  title: "Resumen de cierre | Control de Asistencia",
};

export default function OperationsMonthlySummaryPage() {
  return (
    <ModuleShell
      title="Resumen de cierre"
      description="Historial mensual de cierres guardados y acceso al detalle para cerrar o revisar cada mes."
    >
      <MonthlyClosureMonthsView />
    </ModuleShell>
  );
}
