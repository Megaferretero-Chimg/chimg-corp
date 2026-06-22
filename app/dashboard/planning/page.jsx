import DashboardShell from "@/components/dashboard/DashboardShell";
import PlanningSummary from "@/components/planning/PlanningSummary";

export const metadata = {
  title: "Planificacion | Control de Asistencia",
};

export default async function PlanningPage({ searchParams }) {
  const filters = await searchParams;

  return (
    <DashboardShell
      title="Planificacion"
      description="Resumen mensual de sueldos aproximados, horas suplementarias, horas extra y novedades planificadas por empleado."
    >
      <PlanningSummary
        initialFilters={{
          month: filters?.month || "",
          branchCode: filters?.branchCode || "",
          areaCode: filters?.areaCode || "",
          roleCode: filters?.roleCode || "",
        }}
      />
    </DashboardShell>
  );
}
