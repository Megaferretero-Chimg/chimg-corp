import DashboardShell from "@/components/dashboard/DashboardShell";
import SchedulePlanner from "@/components/planning/SchedulePlanner";

export const metadata = {
  title: "Programacion de horarios | Control de Asistencia",
};

export default async function PlanningMonthlyPage({ searchParams }) {
  const {
    month = "",
    branchCode = "",
    areaCode = "",
    roleCode = "",
  } = await searchParams;

  return (
    <DashboardShell
      title="Programacion de horarios"
      description="Administra turnos variables de almacen y bodega; las areas de horario fijo se resuelven desde su configuracion base."
    >
      <SchedulePlanner initialFilters={{ month, branchCode, areaCode, roleCode }} />
    </DashboardShell>
  );
}
