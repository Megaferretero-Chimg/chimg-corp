import ModuleShell from "@/components/shell/ModuleShell";
import ExceptionManager from "@/modules/planner/components/planning/ExceptionManager";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getPlanningModuleForUser } from "@/modules/planner/module";

export const metadata = {
  title: "Todos los ajustes y excepciones | Control de Asistencia",
};

export default async function PlanningExceptionsPage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      title="Todos los ajustes y excepciones"
      description="CRUD completo para crear, editar, resolver o anular ajustes y excepciones por empleado."
      moduleConfig={getPlanningModuleForUser(user)}
    >
      <ExceptionManager
        eyebrow="Novedades"
        title="Todos los ajustes y excepciones"
        description="Consulta todo el historial mensual y gestiona los registros que explican permisos, trabajo externo, cambios de horario o descuentos."
        currentUserAccessRole={user.accessRole}
        listTitle="Todos los registros"
      />
    </ModuleShell>
  );
}
