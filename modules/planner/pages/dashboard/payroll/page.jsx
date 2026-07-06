import ModuleShell from "@/components/shell/ModuleShell";
import PayrollHomeView from "@/modules/planner/components/payroll/PayrollHomeView";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";

export const metadata = {
  title: "Nómina y costos | Control de Asistencia",
};

export default async function PayrollPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;

  return (
    <ModuleShell
      title="Nómina y costos"
      description="Comparativo del costo planificado contra el cierre mensual guardado, con variaciones por área y empleado."
    >
      <PayrollHomeView
        initialFilters={{
          month: resolvedSearchParams?.month || formatEcuadorMonthKey(),
          branchCode: resolvedSearchParams?.branchCode || "",
          areaCode: resolvedSearchParams?.areaCode || "",
        }}
      />
    </ModuleShell>
  );
}
