import ModuleShell from "@/components/shell/ModuleShell";
import AttendanceComparisonView from "@/modules/planner/components/attendance/AttendanceComparisonView";

export const metadata = {
  title: "Cruce horario vs picadas | Control de Asistencia",
};

export default function AttendanceComparisonPage() {
  return (
    <ModuleShell
      title="Cruce horario vs picadas"
      description="Cruza el horario planificado con las picadas cargadas para detectar novedades y diferencias."
    >
      <AttendanceComparisonView />
    </ModuleShell>
  );
}
