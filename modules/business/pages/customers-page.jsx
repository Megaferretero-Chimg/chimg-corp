import ModuleShell from "@/components/shell/ModuleShell";
import { requireAuthenticatedUser } from "@/lib/access-control";
import CustomerManagement from "@/modules/business/components/customers/CustomerManagement";
import { getBusinessModuleForUser } from "@/modules/business/module";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";

export const metadata = { title: "Clientes | Negocio" };

export default async function CustomersPage() {
  const user = await requireAuthenticatedUser();
  return <ModuleShell moduleConfig={getBusinessModuleForUser(user)} title="Clientes" description="Carga el catálogo empresarial y publica la información que utilizarán las cajas."><CustomerManagement canImport={hasAccessPermission(user, "business.inventory.import")} canPublish={hasAccessPermission(user, "business.inventory.publish")} /></ModuleShell>;
}
