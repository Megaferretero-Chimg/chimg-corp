import { COMPANY_MODULE_NAVIGATION } from "@/modules/company/navigation";
import { companyModulePath } from "@/modules/company/routes";
import { isCompanyEmployeeOnlyUser } from "@/lib/access-control";
import {
  canSwitchModules,
  hasAccessPermission,
} from "@/modules/company/submodules/access/lib/permissions";

export const COMPANY_MODULE = {
  key: "company",
  title: "Empresa y configuración global",
  homeHref: companyModulePath("/home"),
  modulesHref: "/modules",
  navigation: COMPANY_MODULE_NAVIGATION,
};

function currentUserSummary(user = {}) {
  return {
    name: user.employeeName || user.username || "Usuario",
    email: user.email || "",
  };
}

export function getCompanyModuleForUser(user) {
  if (!isCompanyEmployeeOnlyUser(user)) {
    const navigation = COMPANY_MODULE_NAVIGATION
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
      ...COMPANY_MODULE,
      homeHref: navigation[0]?.items[0]?.href || COMPANY_MODULE.homeHref,
      canSwitchModules: canSwitchModules(user),
      currentUser: currentUserSummary(user),
      navigation,
    };
  }

  return {
    ...COMPANY_MODULE,
    homeHref: companyModulePath("/employees"),
    canSwitchModules: canSwitchModules(user),
    currentUser: currentUserSummary(user),
    navigation: [
      {
        title: "Empresa",
        href: companyModulePath("/employees"),
        items: [
          {
            href: companyModulePath("/employees"),
            label: "Empleados",
            description: "Gestión de personal y estructura base",
          },
        ],
      },
    ],
  };
}
