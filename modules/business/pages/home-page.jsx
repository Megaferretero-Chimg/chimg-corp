import ModuleScaffold from "@/components/shell/ModuleScaffold";
import ModuleShell from "@/components/shell/ModuleShell";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getBusinessModuleForUser } from "@/modules/business/module";
import { businessModulePath } from "@/modules/business/routes";

export const metadata = { title: "Negocio | Control de Asistencia" };

export default async function BusinessHomePage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      moduleConfig={getBusinessModuleForUser(user)}
      title="Negocio"
      description="Datos comerciales y operativos que complementan la gestión de la empresa."
    >
      <ModuleScaffold
        eyebrow="Nuevo módulo"
        title="Información central para operar el negocio"
        description="Este espacio inicia con el control de productos, existencias y bodegas, y está preparado para incorporar clientes y otros catálogos más adelante."
        sections={[
          {
            title: "Inventario",
            description: "Carga el catálogo desde Excel y consulta las existencias separadas por bodega.",
            bullets: ["Productos consolidados", "Stock por ubicación", "Historial de cargas"],
            href: businessModulePath("/inventory"),
          },
          {
            title: "Bodegas",
            description: "Crea, edita, inactiva y elimina ubicaciones de inventario.",
            bullets: ["Alias del archivo", "Bodegas futuras", "Protección de existencias"],
            href: businessModulePath("/warehouses"),
          },
        ]}
        futureNote="La estructura del módulo permite añadir clientes y otros datos de negocio sin mezclar responsabilidades con Empresa o Planificación."
      />
    </ModuleShell>
  );
}
