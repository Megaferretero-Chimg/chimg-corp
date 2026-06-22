import DashboardShell from "@/components/dashboard/DashboardShell";
import BaseSchedulesManager from "@/components/planning/BaseSchedulesManager";

export const metadata = {
  title: "Horarios base | Control de Asistencia",
};

export default function SettingsBaseSchedulesPage() {
  return (
    <DashboardShell
      title="Horarios base"
      description="Catalogo de horarios diarios por area para alimentar la programacion operativa."
    >
      <BaseSchedulesManager />
    </DashboardShell>
  );
}
