import ModuleShell from "@/components/shell/ModuleShell";
import ModuleScaffold from "@/components/shell/ModuleScaffold";
import { planningModulePath } from "@/modules/planner/routes";

export const metadata = {
  title: "Conciliacion | Control de Asistencia",
};

export default function ReconciliationPage() {
  return (
    <ModuleShell
      title="Conciliacion"
      description="Cruce entre horario planificado, asistencia real y novedades registradas antes del cierre operativo."
    >
      <ModuleScaffold
        eyebrow="Control operativo"
        title="Planificado, ejecutado y justificado"
        description="Esta pagina sera el punto donde se emparejan diferencias sin frenar el calendario operativo."
        sections={[
          {
            title: "Horario vigente",
            description: "Planificacion que se toma como base para comparar la ejecucion.",
            href: planningModulePath("/schedules"),
          },
          {
            title: "Asistencia real",
            description: "Picadas normalizadas y publicadas desde el biometrico.",
            href: planningModulePath("/attendance"),
          },
          {
            title: "Novedades",
            description: "Justificaciones y cambios que explican diferencias detectadas.",
            href: planningModulePath("/updates"),
          },
        ]}
      />
    </ModuleShell>
  );
}
