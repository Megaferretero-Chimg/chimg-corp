import DashboardShell from "@/components/dashboard/DashboardShell";
import OperationalReview from "@/components/planning/OperationalReview";

export const metadata = {
  title: "Revision operativa | Control de Asistencia",
};

export default async function PlanningWeeklyPage({ searchParams }) {
  const {
    month = "",
    branchCode = "",
    areaCode = "",
    roleCode = "",
  } = await searchParams;

  return (
    <DashboardShell
      title="Revision operativa"
      description="Resumen mensual de horarios programados, cobertura semanal, dias extra y pendientes por empleado."
    >
      <OperationalReview initialFilters={{ month, branchCode, areaCode, roleCode }} />
    </DashboardShell>
  );
}
