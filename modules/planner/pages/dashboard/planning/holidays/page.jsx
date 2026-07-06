import ModuleShell from "@/components/shell/ModuleShell";
import HolidaysCalendar from "@/modules/planner/components/planning/HolidaysCalendar";

export const metadata = {
  title: "Feriados | Control de Asistencia",
};

export default function PlanningHolidaysPage() {
  return (
    <ModuleShell
      title="Feriados"
      description="Calendario mensual de feriados reales para calcular dias laborables, horarios y extraordinarias."
    >
      <HolidaysCalendar />
    </ModuleShell>
  );
}
