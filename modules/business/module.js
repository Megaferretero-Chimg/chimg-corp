import {
  canSwitchModules,
  hasAccessPermission,
} from "@/modules/company/submodules/access/lib/permissions";
import { BUSINESS_MODULE_NAVIGATION } from "@/modules/business/navigation";
import { businessModulePath } from "@/modules/business/routes";

export const BUSINESS_MODULE = {
  key: "business",
  title: "Negocio",
  homeHref: businessModulePath("/home"),
  modulesHref: "/modules",
  navigation: BUSINESS_MODULE_NAVIGATION,
};

function currentUserSummary(user = {}) {
  return {
    name: user.employeeName || user.username || "Usuario",
    email: user.email || "",
  };
}

export function getBusinessModuleForUser(user) {
  const navigation = BUSINESS_MODULE_NAVIGATION
    .map((section) => {
      const items = section.items.filter((item) => !item.permission || hasAccessPermission(user, item.permission));

      return {
        ...section,
        href: items.some((item) => item.href === section.href) ? section.href : items[0]?.href || section.href,
        items,
      };
    })
    .filter((section) => section.items.length);

  return {
    ...BUSINESS_MODULE,
    homeHref: navigation[0]?.items[0]?.href || BUSINESS_MODULE.homeHref,
    canSwitchModules: canSwitchModules(user),
    currentUser: currentUserSummary(user),
    navigation,
  };
}
