import ModuleShell from "@/components/shell/ModuleShell";
import WorkGroupSettingsManager from "@/modules/planner/components/settings/WorkGroupSettingsManager";

export const metadata = { title: "Grupos de trabajo | Control de Asistencia" };

export default function SettingsWorkGroupsPage() {
  return (
    <ModuleShell title="Grupos de trabajo" description="Define responsables y empleados por equipo para organizar la planificación semanal.">
      <WorkGroupSettingsManager />
    </ModuleShell>
  );
}
