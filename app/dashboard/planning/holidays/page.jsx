import DashboardShell from "@/components/dashboard/DashboardShell";
import HolidaysCalendar from "@/components/planning/HolidaysCalendar";

export const metadata = {
  title: "Feriados | Control de Asistencia",
};

export default function PlanningHolidaysPage() {
  return (
    <DashboardShell
      title="Feriados"
      description="Calendario mensual de feriados reales para calcular dias laborables, horarios y extraordinarias."
    >
      <HolidaysCalendar />
    </DashboardShell>
  );
}
