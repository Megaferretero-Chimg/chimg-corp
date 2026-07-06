import ModuleShell from "@/components/shell/ModuleShell";
import ExceptionManager from "@/modules/planner/components/planning/ExceptionManager";

export const metadata = {
  title: "Incidencias | Control de Asistencia",
};

export default function OperationsIncidentsPage() {
  return (
    <ModuleShell
      title="Incidencias"
      description="Registro operativo de novedades reales del mes."
    >
      <ExceptionManager
        eyebrow="Operacion"
        title="Incidencias y resoluciones"
        description="Registra ausencias, permisos, enfermedad, reemplazos y la resolucion tomada para que el control mensual tenga trazabilidad."
      />
    </ModuleShell>
  );
}
