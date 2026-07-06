import MonthlyClosureView from "@/modules/planner/components/attendance/MonthlyClosureView";
import ModuleShell from "@/components/shell/ModuleShell";

export const metadata = {
  title: "Cruce de horas | Control de Asistencia",
};

export default function OperationsMonthlyClosurePage() {
  return (
    <ModuleShell
      title="Cruce de horas"
      description="Ultimo ajuste operativo para completar laborables con horas suplementarias o extraordinarias cuando haga falta."
    >
      <MonthlyClosureView view="cross" />
    </ModuleShell>
  );
}
