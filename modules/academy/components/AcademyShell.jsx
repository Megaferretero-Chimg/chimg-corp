import AccessDenied from "@/components/auth/AccessDenied";
import ModuleShell from "@/components/shell/ModuleShell";
import { requireRequestAccess } from "@/lib/access-control";
import { ACADEMY_ADMIN, ACADEMY_COURSES_PATH, ACADEMY_MODULE, ACADEMY_SETTINGS_PATH } from "@/modules/academy/module";

export default async function AcademyShell({ path, title, description, showHeader = true, children }) {
  const { user, isAllowed } = await requireRequestAccess(path);

  if (!isAllowed) return <AccessDenied />;

  const navigation = [
    { title: "Resumen", href: ACADEMY_ADMIN.href },
    { title: "Cursos", href: ACADEMY_COURSES_PATH },
    { title: "Configuración", href: ACADEMY_SETTINGS_PATH },
  ].map(({ title, href }) => ({
    title, href, items: [{ label: title, href }],
  }));

  return (
    <ModuleShell
      moduleConfig={{
        ...ACADEMY_MODULE,
        navigation,
        currentUser: {
          name: user.employeeName || user.username || "Usuario",
          email: user.email || "",
        },
      }}
      showHeader={showHeader}
      title={title}
      description={description}
    >
      {typeof children === "function" ? children() : children}
    </ModuleShell>
  );
}
