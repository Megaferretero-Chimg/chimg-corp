import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import AttendanceComparisonDetail from "@/modules/planner/components/attendance/AttendanceComparisonDetail";
import ModuleShell from "@/components/shell/ModuleShell";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import { planningModulePath } from "@/modules/planner/routes";

export const metadata = {
  title: "Reporte de asistencia | Control de Asistencia",
};

function buildReturnHref(filters) {
  const params = new URLSearchParams();
  const onlyAdditional = Boolean(filters.onlyAdditional);
  const onlyLate = !onlyAdditional && Boolean(filters.onlyLate);
  const onlyIssues = !onlyAdditional && !onlyLate && Boolean(filters.onlyIssues);

  params.set("month", filters.month || formatEcuadorMonthKey());

  if (filters.branchCode) params.set("branchCode", filters.branchCode);
  if (filters.areaCode) params.set("areaCode", filters.areaCode);
  if (filters.roleCode) params.set("roleCode", filters.roleCode);
  if (onlyIssues) params.set("onlyIssues", "1");
  if (onlyLate) params.set("onlyLate", "1");
  if (onlyAdditional) params.set("onlyAdditional", "1");

  return `${planningModulePath("/attendance/comparison")}?${params.toString()}`;
}

export default async function AttendanceComparisonDetailPage({ params, searchParams }) {
  const { employeeId } = await params;
  const {
    month = "",
    branchCode = "",
    areaCode = "",
    roleCode = "",
    onlyIssues = "",
    onlyLate = "",
    onlyAdditional = "",
  } = await searchParams;
  const initialFilters = {
    month,
    branchCode,
    areaCode,
    roleCode,
    onlyIssues: onlyIssues === "1",
    onlyLate: onlyLate === "1",
    onlyAdditional: onlyAdditional === "1",
  };

  return (
    <ModuleShell
      title="Reporte de asistencia"
      description="Detalle diario del horario asignado, picadas registradas y novedades detectadas."
      actions={(
        <Link href={buildReturnHref(initialFilters)}>
          <ArrowLeft size={16} />
          Resumen
        </Link>
      )}
    >
      <AttendanceComparisonDetail
        employeeId={employeeId}
        initialFilters={initialFilters}
      />
    </ModuleShell>
  );
}
