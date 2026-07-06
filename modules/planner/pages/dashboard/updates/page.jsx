import ModuleShell from "@/components/shell/ModuleShell";
import ExceptionManager from "@/modules/planner/components/planning/ExceptionManager";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getPlanningModuleForUser } from "@/modules/planner/module";

export const metadata = {
  title: "Pendientes aprobacion | Control de Asistencia",
};

export default async function OperationalUpdatesPage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      title="Pendientes aprobacion"
      description="Revisa los ajustes y excepciones que aun necesitan una resolucion administrativa."
      moduleConfig={getPlanningModuleForUser(user)}
    >
      <ExceptionManager
        eyebrow="Novedades"
        title="Pendientes aprobacion"
        description="Lista solo las novedades pendientes. Al resolver una, desaparece de esta bandeja y queda disponible en el CRUD completo."
        currentUserAccessRole={user.accessRole}
        onlyPending
        showCreateButton={false}
        showBulkDeleteButton={false}
        listTitle="Pendientes por resolver"
        emptyTitle="No hay novedades pendientes en este mes."
        emptyFilteredTitle="No hay pendientes para ese filtro."
        emptyDescription="Cuando exista un permiso, ajuste o excepcion pendiente, aparecera aqui para resolucion."
        emptyFilteredDescription="Prueba con otro empleado, cedula, sucursal, area o rol."
      />
    </ModuleShell>
  );
}
