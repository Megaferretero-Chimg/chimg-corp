import ModuleShell from "@/components/shell/ModuleShell";
import VacationPlanner from "@/modules/planner/components/planning/VacationPlanner";

export const metadata = {
  title: "Vacaciones programadas | Control de Asistencia",
};

export default function PlanningTimeOffPage() {
  return (
    <ModuleShell
      title="Vacaciones programadas"
      description="Registro, revisión y aprobación de solicitudes de vacaciones antes de generar la planificación."
    >
      <VacationPlanner />
    </ModuleShell>
  );
}
