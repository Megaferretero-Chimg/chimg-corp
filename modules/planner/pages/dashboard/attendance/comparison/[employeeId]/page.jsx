import AttendanceComparisonDetail from "@/modules/planner/components/attendance/AttendanceComparisonDetail";
import ModuleShell from "@/components/shell/ModuleShell";

export const metadata = {
  title: "Reporte de asistencia | Control de Asistencia",
};

export default async function AttendanceComparisonDetailPage({ params, searchParams }) {
  const { employeeId } = await params;
  const {
    month = "",
    branchCode = "",
    areaCode = "",
    roleCode = "",
  } = await searchParams;

  return (
    <ModuleShell
      title="Reporte de asistencia"
      description="Detalle diario del horario asignado, picadas registradas y novedades detectadas."
    >
      <AttendanceComparisonDetail
        employeeId={employeeId}
        initialFilters={{ month, branchCode, areaCode, roleCode }}
      />
    </ModuleShell>
  );
}
