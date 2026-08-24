import ModuleShell from "@/components/shell/ModuleShell";
import { requireAuthenticatedUser } from "@/lib/access-control";
import InventoryManagement from "@/modules/business/components/inventory/InventoryManagement";
import { getBusinessModuleForUser } from "@/modules/business/module";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";

export const metadata = { title: "Inventario | Negocio" };

export default async function InventoryPage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      moduleConfig={getBusinessModuleForUser(user)}
      title="Inventario"
      description="Actualiza productos desde Excel y consulta el stock disponible en cada bodega."
    >
      <InventoryManagement
        canImport={hasAccessPermission(user, "business.inventory.import")}
        canPublish={hasAccessPermission(user, "business.inventory.publish")}
      />
    </ModuleShell>
  );
}
