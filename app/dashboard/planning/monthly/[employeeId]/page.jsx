import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import DashboardShell from "@/components/dashboard/DashboardShell";
import EmployeeScheduleDetail from "@/components/planning/EmployeeScheduleDetail";
import { planningModulePath } from "@/lib/modules/planning/routes";

export const metadata = {
  title: "Detalle de horario | Control de Asistencia",
};

function buildReturnUrl(monthKey, filters = {}) {
  const params = new URLSearchParams();

  if (monthKey) {
    params.set("month", monthKey);
  }

  if (filters.branchCode) {
    params.set("branchCode", filters.branchCode);
  }

  if (filters.areaCode) {
    params.set("areaCode", filters.areaCode);
  }

  if (filters.roleCode) {
    params.set("roleCode", filters.roleCode);
  }

  const query = params.toString();

  return `${planningModulePath("/planning/monthly")}${query ? `?${query}` : ""}`;
}

export default async function EmployeeMonthlySchedulePage({ params, searchParams }) {
  const { employeeId } = await params;
  const {
    month = "",
    branchCode = "",
    areaCode = "",
    roleCode = "",
  } = await searchParams;
  const returnHref = buildReturnUrl(month, { branchCode, areaCode, roleCode });

  return (
    <DashboardShell
      title="Detalle de horario"
      description="Revisa el mes planificado por empleado, separado por semanas y días."
      actions={(
        <Link href={returnHref}>
          <ArrowLeft size={16} />
          Volver
        </Link>
      )}
    >
      <EmployeeScheduleDetail
        employeeId={employeeId}
        initialMonth={month}
      />
    </DashboardShell>
  );
}
