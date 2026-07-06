import AttendancePunchReview from "@/modules/planner/components/attendance/AttendancePunchReview";
import ModuleShell from "@/components/shell/ModuleShell";

export const metadata = {
  title: "Revisar picadas | Control de Asistencia",
};

export default function AttendanceReviewPage() {
  return (
    <ModuleShell
      title="Revisar picadas"
      description="Consulta, agrega, edita o elimina picadas con auditoría obligatoria por cada cambio manual."
    >
      <AttendancePunchReview />
    </ModuleShell>
  );
}
