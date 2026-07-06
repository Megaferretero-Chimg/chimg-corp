import { format } from "date-fns";

import ModuleShell from "@/components/shell/ModuleShell";
import PayrollEstimateView from "@/modules/planner/components/payroll/PayrollEstimateView";

export const metadata = {
  title: "Estimación de Nómina | Control de Asistencia",
};

export default async function PayrollEstimatePage({ searchParams }) {
  const resolvedSearchParams = await searchParams;

  return (
    <ModuleShell
      title="Estimación de nómina"
      description="Revisa una proyección mensual basada en sueldo, horas suplementarias, extraordinarias y descuentos por ausencia."
    >
      <PayrollEstimateView
        initialEmployeeId={resolvedSearchParams?.employeeId || ""}
        initialEmployeeName={resolvedSearchParams?.employeeName || ""}
        initialMonth={resolvedSearchParams?.month || format(new Date(), "yyyy-MM")}
      />
    </ModuleShell>
  );
}
