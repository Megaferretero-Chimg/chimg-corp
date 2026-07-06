import ModuleShell from "@/components/shell/ModuleShell";
import RoleScheduleSettingsManager from "@/modules/planner/components/settings/RoleScheduleSettingsManager";

export const metadata = {
  title: "Horarios por cargo | Control de Asistencia",
};

export default function SettingsRoleSchedulesPage() {
  return (
    <ModuleShell
      title="Horarios por cargo"
      description="Define que cargos tienen horario fijo, que cargos pasan por planificacion variable y si sus picadas contabilizan horas."
    >
      <RoleScheduleSettingsManager />
    </ModuleShell>
  );
}
