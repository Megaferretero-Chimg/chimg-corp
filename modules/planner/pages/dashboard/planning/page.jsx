import ModuleShell from "@/components/shell/ModuleShell";
import PlanningSummary from "@/modules/planner/components/planning/PlanningSummary";

export const metadata = {
  title: "Planificacion | Control de Asistencia",
};

export default async function PlanningPage({ searchParams }) {
  const filters = await searchParams;

  return (
    <ModuleShell
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
    </ModuleShell>
  );
}
