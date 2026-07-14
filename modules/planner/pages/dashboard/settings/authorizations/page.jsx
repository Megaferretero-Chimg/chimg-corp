import ModuleShell from "@/components/shell/ModuleShell";
import AuthorizationSettingsManager from "@/modules/planner/components/planning/AuthorizationSettingsManager";

export const metadata = {
  title: "Autorizaciones | Control de Asistencia",
};

export default function SettingsAuthorizationsPage() {
  return (
    <ModuleShell
      title="Autorizaciones"
      description="Reglas globales para determinar que horas y excepciones requieren aprobacion."
    >
      <AuthorizationSettingsManager />
    </ModuleShell>
  );
}
