import NormalizeAttendanceView from "@/modules/planner/components/attendance/NormalizeAttendanceView";
import ModuleShell from "@/components/shell/ModuleShell";

export const metadata = {
  title: "Revisar carga | Control de Asistencia",
};

export default async function AttendanceUploadNormalizationPage({ params }) {
  const { id } = await params;

  return (
    <ModuleShell
      title="Revisar carga"
      description="Revisa los empleados detectados, guarda la normalización y publica las picadas válidas en el sistema."
    >
      <NormalizeAttendanceView uploadId={id} />
    </ModuleShell>
  );
}
