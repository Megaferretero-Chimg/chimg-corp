import ModuleShell from "@/components/shell/ModuleShell";
import ModuleScaffold from "@/components/shell/ModuleScaffold";
import { planningModulePath } from "@/modules/planner/routes";

export const metadata = {
  title: "Configuracion | Control de Asistencia",
};

export default function SettingsPage() {
  return (
    <ModuleShell
      title="Configuracion"
      description="Decisiones operativas que no deben quedar quemadas en codigo."
    >
      <ModuleScaffold
        eyebrow="Configuracion"
        title="Centro operativo"
        description="Ajusta solo las reglas que requieren criterio humano. Lo que se puede deducir desde cargos, horarios, picadas u organigrama debe resolverse de forma automatica."
        sections={[
          {
            title: "Plantillas de horarios",
            description: "Opciones diarias reutilizables por area para planificar o asignar horarios fijos.",
            href: planningModulePath("/settings/base-schedules"),
            bullets: ["Rangos horarios", "Almuerzo y picadas esperadas", "Filtro por area"],
          },
          {
            title: "Grupos de trabajo",
            description: "Unidad operativa que define quien planifica a quien. Los grupos existentes vuelven a alimentar la planificacion semanal.",
            href: planningModulePath("/settings/work-groups"),
            bullets: ["Selector de grupo", "Historial por equipo", "Responsable operativo"],
          },
          {
            title: "Horarios por cargo",
            description: "Define si un cargo se planifica cada semana, mantiene un horario fijo y si sus picadas contabilizan horas.",
            href: planningModulePath("/settings/role-schedules"),
            bullets: ["Fijo o variable", "Plantilla fija", "Picadas contabilizables"],
          },
          {
            title: "Reglas de horario",
            description: "Define el margen de tolerancia para atrasos al comparar horarios y picadas.",
            href: planningModulePath("/settings/schedule-rules"),
            bullets: ["Tolerancia de atrasos", "Horario vs picadas"],
          },
        ]}
        futureNote="Empresa mantiene la estructura base: sucursales, areas, cargos, empleados y organigrama. Planificacion solo consume esa estructura."
      />
    </ModuleShell>
  );
}
