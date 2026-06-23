import DashboardShell from "@/components/dashboard/DashboardShell";
import MonthlyReportsView from "@/components/reports/MonthlyReportsView";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";

export const metadata = {
  title: "Reporte mensual | Control de Asistencia",
};

export default async function ReportsMonthlyPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;

  return (
    <DashboardShell
      title="Reporte mensual"
      description="Resumen básico mes a mes con cierre, horas, costos y exportables principales."
    >
      <MonthlyReportsView initialMonth={resolvedSearchParams?.month || formatEcuadorMonthKey()} />
    </DashboardShell>
  );
}
