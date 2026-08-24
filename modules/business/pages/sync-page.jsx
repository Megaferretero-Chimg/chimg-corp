import ModuleShell from "@/components/shell/ModuleShell";
import { requireAuthenticatedUser } from "@/lib/access-control";
import SyncDocumentsManagement from "@/modules/business/components/sync/SyncDocumentsManagement";
import { getBusinessModuleForUser } from "@/modules/business/module";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";

export const metadata = { title: "Documentos sincronizados | Negocio" };

export default async function SyncPage() {
  const user = await requireAuthenticatedUser();
  return <ModuleShell moduleConfig={getBusinessModuleForUser(user)} title="Documentos recibidos" description="Revisa las guías y clientes creados en las cajas sin conexión."><SyncDocumentsManagement canManage={hasAccessPermission(user, "business.syncDocuments.manage")} /></ModuleShell>;
}
