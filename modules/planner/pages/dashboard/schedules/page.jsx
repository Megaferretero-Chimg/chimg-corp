import ModuleShell from "@/components/shell/ModuleShell";
import SchedulePlanner from "@/modules/planner/components/planning/SchedulePlanner";

export const metadata = {
  title: "Horarios | Control de Asistencia",
};

export default async function DashboardSchedulesPage({ searchParams }) {
  const {
    month = "",
    branchCode = "",
    areaCode = "",
    roleCode = "",
    week = "",
  } = await searchParams;

  return (
    <ModuleShell
      title="Planificacion semanal"
      description="Organiza horarios por sucursal, area y cargo en una sola matriz semanal para trabajar la semana completa del equipo."
    >
      <SchedulePlanner
        basePath="/schedules"
        initialFilters={{ month, branchCode, areaCode, roleCode, week }}
      />
    </ModuleShell>
  );
}
