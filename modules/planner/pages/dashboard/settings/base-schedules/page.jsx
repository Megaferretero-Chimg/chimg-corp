import ModuleShell from "@/components/shell/ModuleShell";
import BaseSchedulesManager from "@/modules/planner/components/planning/BaseSchedulesManager";

export const metadata = {
  title: "Horarios base | Control de Asistencia",
};

export default function SettingsBaseSchedulesPage() {
  return (
    <ModuleShell
      title="Horarios base"
      description="Catalogo de horarios diarios por area para alimentar la programacion operativa."
    >
      <BaseSchedulesManager />
    </ModuleShell>
  );
}
