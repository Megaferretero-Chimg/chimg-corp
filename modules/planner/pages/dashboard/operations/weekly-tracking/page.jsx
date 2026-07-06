import ModuleShell from "@/components/shell/ModuleShell";
import ModuleScaffold from "@/components/shell/ModuleScaffold";

export const metadata = {
  title: "Seguimiento semanal | Control de Asistencia",
};

export default function WeeklyTrackingPage() {
  return (
    <ModuleShell
      title="Seguimiento semanal"
      description="Página base para revisar semana a semana la ejecución frente al plan."
    >
      <ModuleScaffold
        eyebrow="Operación"
        title="Control de cumplimiento semanal"
        description="Este espacio se usará para revisar si la semana se está ejecutando como fue planificada y si necesitamos registrar desviaciones o ajustar cobertura."
      />
    </ModuleShell>
  );
}
