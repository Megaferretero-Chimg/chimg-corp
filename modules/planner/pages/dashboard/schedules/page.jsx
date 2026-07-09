import ModuleShell from "@/components/shell/ModuleShell";
import SchedulePlanner from "@/modules/planner/components/planning/SchedulePlanner";

export const metadata = {
  title: "Horarios | Control de Asistencia",
};

export default async function DashboardSchedulesPage({ searchParams }) {
  const {
    month = "",
    groupId = "",
    week = "",
  } = await searchParams;

  return (
    <ModuleShell
      title="Planificacion semanal"
      description="Organiza horarios semanales por grupo de trabajo en una sola matriz para gestionar el equipo correcto."
    >
      <SchedulePlanner
        basePath="/schedules"
        initialFilters={{ month, groupId, week }}
      />
    </ModuleShell>
  );
}
