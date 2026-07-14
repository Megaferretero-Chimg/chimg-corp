import ModuleShell from "@/components/shell/ModuleShell";
import ModuleScaffold from "@/components/shell/ModuleScaffold";
import { planningModulePath } from "@/modules/planner/routes";

export const metadata = {
  title: "Revision operativa | Control de Asistencia",
};

export default function OperationalReviewPage() {
  return (
    <ModuleShell
      title="Revision operativa"
      description="Espacio administrativo para revisar horarios guardados, observar cambios y mantener trazabilidad sin detener la operacion."
    >
      <ModuleScaffold
        eyebrow="Control operativo"
        title="Revision del horario vigente"
        description="El horario planificado sigue siendo aplicable. La revision funciona como control y registro, no como bloqueo del flujo."
        sections={[
          {
            title: "Horarios por revisar",
            description: "Vista de semanas creadas o modificadas por jefes de sucursal.",
            href: planningModulePath("/schedules"),
          },
          {
            title: "Cambios recientes",
            description: "Lectura de modificaciones relevantes antes de la conciliacion.",
            href: planningModulePath("/history"),
          },
          {
            title: "Cruce operativo",
            description: "Punto de entrada para comparar planificacion, asistencia real y novedades.",
            href: planningModulePath("/reconciliation"),
          },
        ]}
      />
    </ModuleShell>
  );
}
