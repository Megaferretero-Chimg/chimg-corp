import ModuleShell from "@/components/shell/ModuleShell";
import LaborRulesManager from "@/modules/planner/components/planning/LaborRulesManager";

export const metadata = {
  title: "Reglas laborales | Control de Asistencia",
};

export default function SettingsLaborRulesPage() {
  return (
    <ModuleShell
      title="Reglas laborales"
      description="Parametros de jornada, descansos, recargos y feriados para el modulo operativo."
    >
      <LaborRulesManager />
    </ModuleShell>
  );
}
