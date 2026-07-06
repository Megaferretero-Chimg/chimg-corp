import { redirect } from "next/navigation";

export const metadata = {
  title: "Reglas de horario | Control de Asistencia",
};

export default function SettingsAuthorizationsRedirectPage() {
  redirect("/modules/planning/settings/schedule-rules");
}
