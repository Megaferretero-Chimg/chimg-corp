import DashboardShell from "@/components/dashboard/DashboardShell";
import ExceptionManager from "@/components/planning/ExceptionManager";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getPlanningModuleForUser } from "@/lib/modules/planning/module";

export const metadata = {
  title: "Ajustes y excepciones | Control de Asistencia",
};

export default async function PlanningExceptionsPage() {
  const user = await requireAuthenticatedUser();

  return (
    <DashboardShell
      title="Ajustes y excepciones"
      description="Registra permisos, salidas tempranas, ausencias justificadas y novedades que explican diferencias de asistencia sin tratarlas como sanciones."
      moduleConfig={getPlanningModuleForUser(user)}
    >
      <ExceptionManager
        eyebrow="Planificacion"
        title="Ajustes y excepciones"
        description="Deja trazabilidad de que ocurrio, por que se autorizo y como debe leerse en asistencia o nomina cuando falten horas planificadas."
        currentUserAccessRole={user.accessRole}
      />
    </DashboardShell>
  );
}
