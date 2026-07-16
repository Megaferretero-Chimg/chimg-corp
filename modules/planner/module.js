import { DASHBOARD_NAVIGATION, getDashboardNavigationForAccessRole } from "@/modules/planner/navigation";
import { planningModulePath } from "@/modules/planner/routes";
import {
  canSwitchModules,
  hasAccessPermission,
} from "@/modules/company/submodules/access/lib/permissions";

export const PLANNING_MODULE = {
  key: "planning",
  title: "Planificación y control operativo",
  homeHref: planningModulePath("/home"),
  modulesHref: "/modules",
  navigation: DASHBOARD_NAVIGATION,
};

export function getPlanningModuleForUser(user) {
  const baseNavigation = getDashboardNavigationForAccessRole(user?.accessRole);
  const navigation = baseNavigation
    .map((section) => {
      const items = section.items.filter((item) => !item.permission || hasAccessPermission(user, item.permission));
      const sectionHrefIsAllowed = items.some((item) => item.href === section.href);

      return {
        ...section,
        href: sectionHrefIsAllowed ? section.href : items[0]?.href || section.href,
        items,
      };
    })
    .filter((section) => section.items.length);

  return {
    ...PLANNING_MODULE,
    homeHref: navigation[0]?.items[0]?.href || PLANNING_MODULE.homeHref,
    canSwitchModules: canSwitchModules(user),
    navigation,
  };
}
