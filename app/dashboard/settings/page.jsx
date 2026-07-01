import DashboardShell from "@/components/dashboard/DashboardShell";
import ModuleScaffold from "@/components/dashboard/ModuleScaffold";
import { planningModulePath } from "@/lib/modules/planning/routes";

export const metadata = {
  title: "Configuracion | Control de Asistencia",
};

export default function SettingsPage() {
  return (
    <DashboardShell
      title="Configuracion"
      description="Parametros propios del modulo de planificacion y control operativo."
    >
      <ModuleScaffold
        eyebrow="Planning"
        title="Parametros del modulo"
        description="La idea es evitar que demasiadas reglas queden quemadas en codigo. Aqui vivira la parametrizacion especifica del modulo de planificacion y control operativo."
        sections={[
          {
            title: "Plantillas de horarios",
            description: "Horarios base por area y rol.",
            href: planningModulePath("/settings/base-schedules"),
          },
          {
            title: "Reglas laborales",
            description: "Jornadas, descansos, feriados y recargos.",
            href: planningModulePath("/settings/labor-rules"),
          },
          {
            title: "Autorizaciones",
            description: "Permisos de horas y excepciones.",
            href: planningModulePath("/settings/authorizations"),
          },
        ]}
        futureNote="La estructura global de empresa, personal y acceso vive en el modulo independiente de Empresa y configuracion global."
      />
    </DashboardShell>
  );
}
