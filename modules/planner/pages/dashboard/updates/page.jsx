import ModuleShell from "@/components/shell/ModuleShell";
import { requireAuthenticatedUser } from "@/lib/access-control";
import ExceptionManager from "@/modules/planner/components/planning/ExceptionManager";
import ScheduleUnlockRequestManager from "@/modules/planner/components/planning/ScheduleUnlockRequestManager";

export const metadata = {
  title: "Pendientes aprobacion | Control de Asistencia",
};

export default async function OperationalUpdatesPage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      title="Pendientes aprobacion"
      description=""
    >
      <ScheduleUnlockRequestManager />
      <ExceptionManager
        eyebrow=""
        title=""
        description=""
        currentUserAccessRole={user.accessRole}
        onlyPending
        compactPendingView
        showBulkDeleteButton={false}
        listTitle="Pendientes por resolver"
        emptyTitle="No hay novedades pendientes en este mes."
        emptyFilteredTitle="No hay pendientes para ese filtro."
        emptyDescription=""
        emptyFilteredDescription=""
      />
    </ModuleShell>
  );
}
