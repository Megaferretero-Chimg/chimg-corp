import ModuleShell from "@/components/shell/ModuleShell";
import { requireAuthenticatedUser } from "@/lib/access-control";
import DeviceManagement from "@/modules/business/components/devices/DeviceManagement";
import { getBusinessModuleForUser } from "@/modules/business/module";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";

export const metadata = { title: "Dispositivos | Negocio" };

export default async function DevicesPage() {
  const user = await requireAuthenticatedUser();
  return <ModuleShell moduleConfig={getBusinessModuleForUser(user)} title="Dispositivos de contingencia" description="Activa cajas, asigna bodegas y supervisa su última sincronización."><DeviceManagement canManage={hasAccessPermission(user, "business.devices.manage")} /></ModuleShell>;
}
