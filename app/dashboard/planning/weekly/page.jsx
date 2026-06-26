import DashboardShell from "@/components/dashboard/DashboardShell";
import ModuleScaffold from "@/components/dashboard/ModuleScaffold";

export const metadata = {
  title: "Revision operativa | Control de Asistencia",
};

export default function PlanningWeeklyPage() {
  return (
    <DashboardShell
      title="Revision operativa"
      description="Resumen mensual de horarios programados, cobertura semanal, dias extra y pendientes por empleado."
    >
      <ModuleScaffold
        eyebrow="Planificacion"
        title="Revision operativa semanal"
        description="Este espacio queda reservado para revisar cobertura semanal, dias extra y pendientes por empleado sin bloquear el build del sistema."
      />
    </DashboardShell>
  );
}
