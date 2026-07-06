import UploadAttendanceForm from "@/modules/planner/components/attendance/UploadAttendanceForm";
import ModuleShell from "@/components/shell/ModuleShell";

export const metadata = {
  title: "Cargar picadas | Control de Asistencia",
};

export default function AttendanceUploadsPage() {
  return (
    <ModuleShell
      title="Cargar picadas"
      description="Sube el archivo del biométrico, selecciona la sucursal de origen y revisa la normalización antes de publicar picadas."
    >
      <UploadAttendanceForm />
    </ModuleShell>
  );
}
