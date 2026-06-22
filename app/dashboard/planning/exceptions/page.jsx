import DashboardShell from "@/components/dashboard/DashboardShell";
import ExceptionManager from "@/components/planning/ExceptionManager";

export const metadata = {
  title: "Ajustes y excepciones | Control de Asistencia",
};

export default function PlanningExceptionsPage() {
  return (
    <DashboardShell
      title="Ajustes y excepciones"
      description="Registra permisos, salidas tempranas, ausencias justificadas y novedades que explican diferencias de asistencia sin tratarlas como sanciones."
    >
      <ExceptionManager
        eyebrow="Planificacion"
        title="Ajustes y excepciones"
        description="Deja trazabilidad de que ocurrio, por que se autorizo y como debe leerse en asistencia o nomina cuando falten horas planificadas."
      />
    </DashboardShell>
  );
}
