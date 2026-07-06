import ModuleShell from "@/components/shell/ModuleShell";
import ModuleScaffold from "@/components/shell/ModuleScaffold";
import { planningModulePath } from "@/modules/planner/routes";

export const metadata = {
  title: "Cierre operativo | Control de Asistencia",
};

export default function OperationalClosurePage() {
  return (
    <ModuleShell
      title="Cierre operativo"
      description="Consolidacion del periodo una vez conciliados horarios, picadas y novedades."
    >
      <ModuleScaffold
        eyebrow="Cierre"
        title="Periodo listo para reportes y nomina"
        description="El cierre representa una foto consolidada del periodo; no impide trabajar, pero deja una referencia formal."
        sections={[
          {
            title: "Cruce horario vs picadas",
            description: "Revision del cruce que sustenta el cierre.",
            href: planningModulePath("/attendance/comparison"),
          },
          {
            title: "Resumen de cierre",
            description: "Base operativa existente para totales finales del mes.",
            href: planningModulePath("/operations/monthly-summary"),
          },
          {
            title: "Reporte mensual",
            description: "Salida ejecutiva y exportable despues del cierre.",
            href: planningModulePath("/reports/monthly"),
          },
        ]}
      />
    </ModuleShell>
  );
}
