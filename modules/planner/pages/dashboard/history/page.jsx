import ModuleShell from "@/components/shell/ModuleShell";
import ModuleScaffold from "@/components/shell/ModuleScaffold";
import { planningModulePath } from "@/modules/planner/routes";

export const metadata = {
  title: "Historial operativo | Control de Asistencia",
};

export default function OperationalHistoryPage() {
  return (
    <ModuleShell
      title="Historial operativo"
      description="Trazabilidad de creaciones, cambios, revisiones y cierres relacionados con horarios y asistencia."
    >
      <ModuleScaffold
        eyebrow="Historial"
        title="Registro de decisiones operativas"
        description="La estructura queda lista para guardar quien creo, modifico, reviso o consolido informacion del periodo."
        sections={[
          {
            title: "Horario vigente",
            description: "Origen de cambios de planificacion semanal.",
            href: planningModulePath("/schedules"),
          },
          {
            title: "Cruce horario vs picadas",
            description: "Diferencias detectadas entre planificacion y asistencia real.",
            href: planningModulePath("/attendance/comparison"),
          },
          {
            title: "Cierre operativo",
            description: "Marca final del periodo y referencia para reportes.",
            href: planningModulePath("/closure"),
          },
        ]}
      />
    </ModuleShell>
  );
}
