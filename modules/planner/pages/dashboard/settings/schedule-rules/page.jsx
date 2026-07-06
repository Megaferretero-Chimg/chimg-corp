import ModuleShell from "@/components/shell/ModuleShell";
import ScheduleRulesManager from "@/modules/planner/components/planning/ScheduleRulesManager";

export const metadata = {
  title: "Reglas de horario | Control de Asistencia",
};

export default function SettingsScheduleRulesPage() {
  return (
    <ModuleShell
      title="Reglas de horario"
      description="Define el margen de tolerancia que se aplica al cruce entre horarios y picadas."
    >
      <ScheduleRulesManager />
    </ModuleShell>
  );
}
