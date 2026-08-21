import ModuleShell from "@/components/shell/ModuleShell";
import { requireAuthenticatedUser } from "@/lib/access-control";
import WarehouseManagement from "@/modules/business/components/warehouses/WarehouseManagement";
import { getBusinessModuleForUser } from "@/modules/business/module";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";

export const metadata = { title: "Bodegas | Negocio" };

export default async function WarehousesPage() {
  const user = await requireAuthenticatedUser();

  return (
    <ModuleShell
      moduleConfig={getBusinessModuleForUser(user)}
      title="Bodegas"
      description="Administra las ubicaciones de inventario y los nombres con los que llegan desde el archivo Excel."
    >
      <WarehouseManagement canManage={hasAccessPermission(user, "business.warehouses.manage")} />
    </ModuleShell>
  );
}
