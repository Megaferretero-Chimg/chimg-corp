import MonthlyClosureView from "@/modules/planner/components/attendance/MonthlyClosureView";
import ModuleShell from "@/components/shell/ModuleShell";

export const metadata = {
  title: "Control operativo | Control de Asistencia",
};

export default function OperationsPage() {
  return (
    <ModuleShell
      title="Control operativo"
      description="Cruce final de horas para completar laborables con horas suplementarias o extraordinarias cuando haga falta."
    >
      <MonthlyClosureView view="cross" />
    </ModuleShell>
  );
}
