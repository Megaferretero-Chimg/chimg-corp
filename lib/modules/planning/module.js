import { DASHBOARD_NAVIGATION, getDashboardNavigationForAccessRole } from "@/lib/dashboard/navigation";
import { planningModulePath } from "@/lib/modules/planning/routes";

export const PLANNING_MODULE = {
  key: "planning",
  title: "Planificación y control operativo",
  homeHref: planningModulePath("/home"),
  modulesHref: "/modules",
  navigation: DASHBOARD_NAVIGATION,
};

export function getPlanningModuleForUser(user) {
  return {
    ...PLANNING_MODULE,
    navigation: getDashboardNavigationForAccessRole(user?.accessRole),
  };
}
