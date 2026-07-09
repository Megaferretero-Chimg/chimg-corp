import AttendancePunchReview from "@/modules/planner/components/attendance/AttendancePunchReview";
import ModuleShell from "@/components/shell/ModuleShell";

export const metadata = {
  title: "Revisar picadas | Control de Asistencia",
};

export default function AttendanceReviewPage() {
  return (
    <ModuleShell
      title="Revisar picadas"
      description="Consulta las picadas cargadas desde el biométrico y revisa registros manuales ya auditados."
    >
      <AttendancePunchReview />
    </ModuleShell>
  );
}
