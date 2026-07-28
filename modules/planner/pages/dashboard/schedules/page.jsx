import ModuleShell from "@/components/shell/ModuleShell";
import SchedulePlanner from "@/modules/planner/components/planning/SchedulePlanner";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";

export const metadata = {
  title: "Horarios | Control de Asistencia",
};

export default async function DashboardSchedulesPage({ searchParams }) {
  const user = await requireAuthenticatedUser();
  const {
    month = "",
    groupId = "",
    week = "",
  } = await searchParams;

  return (
    <ModuleShell
      title="Planificacion semanal"
      description="Organiza horarios semanales por grupo de trabajo en una sola matriz para gestionar el equipo correcto."
    >
      <SchedulePlanner
        basePath="/schedules"
        initialFilters={{ month, groupId, week }}
        capabilities={{
          canManageSchedules: hasAccessPermission(user, "planner.schedules.manage"),
          canRequestPlanningUnlock: hasAccessPermission(user, "planner.schedules.manage"),
          canPasteSchedules: hasAccessPermission(user, "planner.schedules.weekly.view"),
          canApprovePlanning: hasAccessPermission(user, "planner.updates.manage"),
          canExportSchedule: hasAccessPermission(user, "planner.schedules.export"),
          canCreateQuickTemplates: hasAccessPermission(user, "planner.schedules.quickTemplates.create"),
          canCreateAdjustments: hasAccessPermission(user, "planner.schedules.adjustments.create"),
          canDeleteAnyPendingExceptions: hasAccessPermission(user, "planner.exceptions.approve"),
          canOpenMonthlyDetail: hasAccessPermission(user, "planner.schedules.details.view"),
          showSummaries: hasAccessPermission(user, "planner.schedules.summaries.view"),
          showHours: hasAccessPermission(user, "planner.schedules.hours.view"),
          showFinancials: hasAccessPermission(user, "planner.schedules.financial.view"),
        }}
      />
    </ModuleShell>
  );
}
