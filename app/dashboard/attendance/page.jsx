import DashboardShell from "@/components/dashboard/DashboardShell";
import AttendanceHomeView from "@/components/attendance/AttendanceHomeView";

export const metadata = {
  title: "Asistencia | Control de Asistencia",
};

export default function AttendancePage() {
  return (
    <DashboardShell
      title="Asistencia"
      description="Módulo orientado a capturar, revisar y comparar las picadas con la planificación."
    >
      <AttendanceHomeView />
    </DashboardShell>
  );
}
