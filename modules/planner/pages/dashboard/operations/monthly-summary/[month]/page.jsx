import MonthlyClosureView from "@/modules/planner/components/attendance/MonthlyClosureView";
import ModuleShell from "@/components/shell/ModuleShell";

export const metadata = {
  title: "Detalle de cierre | Control de Asistencia",
};

export default async function OperationsMonthlySummaryDetailPage({ params }) {
  const { month } = await params;

  return (
    <ModuleShell
      title={`Cierre ${month}`}
      description="Detalle del mes con totales consolidados, resumen por area, formatos de descarga y guardado de copia historica."
    >
      <MonthlyClosureView view="summary" fixedMonth={month} />
    </ModuleShell>
  );
}
