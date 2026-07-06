import ModuleShell from "@/components/shell/ModuleShell";
import MonthlyReportsView from "@/modules/planner/components/reports/MonthlyReportsView";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";

export const metadata = {
  title: "Reporte mensual | Control de Asistencia",
};

export default async function ReportsMonthlyPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;

  return (
    <ModuleShell
      title="Reporte mensual"
      description="Resumen básico mes a mes con cierre, horas, costos y exportables principales."
    >
      <MonthlyReportsView initialMonth={resolvedSearchParams?.month || formatEcuadorMonthKey()} />
    </ModuleShell>
  );
}
