import ModuleShell from "@/components/shell/ModuleShell";
import AttendanceHomeView from "@/modules/planner/components/attendance/AttendanceHomeView";

export const metadata = {
  title: "Asistencia | Control de Asistencia",
};

export default function AttendancePage() {
  return (
    <ModuleShell
      title="Asistencia"
      description="Módulo orientado a capturar, revisar y comparar las picadas con la planificación."
    >
      <AttendanceHomeView />
    </ModuleShell>
  );
}
