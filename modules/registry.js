import {
  COMPANY_EMPLOYEES_PATH,
  PLANNING_EXCEPTIONS_PATH,
  isCompanyEmployeeOnlyUser,
  isPlanningExceptionsUser,
} from "@/lib/access-control";
import { COMPANY_MODULE } from "@/modules/company/module";
import { PLANNING_MODULE } from "@/modules/planner/module";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";

export const MODULE_DEFINITIONS = [
  {
    ...PLANNING_MODULE,
    status: "Disponible",
    description: "Horarios, asistencia, costos y seguimiento operativo del período.",
    bullets: ["Planificación", "Asistencia", "Nómina", "Reportes"],
    icon: "calendar-range",
  },
  {
    ...COMPANY_MODULE,
    status: "Disponible",
    description: "Áreas, cargos, sedes, personal y acceso a la plataforma.",
    bullets: ["Áreas", "Cargos", "Sucursales", "Empleados"],
    icon: "building-2",
  },
];

function asModuleCard(module) {
  return {
    ...module,
    href: module.href || module.homeHref || "/modules",
  };
}

export function getModuleCardsForUser(user) {
  if (isPlanningExceptionsUser(user)) {
    return MODULE_DEFINITIONS
      .filter((module) => module.key === PLANNING_MODULE.key)
      .map((module) => ({
        ...module,
        href: PLANNING_EXCEPTIONS_PATH,
        bullets: ["Ajustes y excepciones"],
      }))
      .map(asModuleCard);
  }

  if (isCompanyEmployeeOnlyUser(user)) {
    return MODULE_DEFINITIONS.map((module) => {
      if (module.key !== COMPANY_MODULE.key) {
        return asModuleCard(module);
      }

      return asModuleCard({
        ...module,
        href: COMPANY_EMPLOYEES_PATH,
        description: "Gestión de empleados autorizada para tu perfil.",
        bullets: ["Empleados"],
      });
    });
  }

  return MODULE_DEFINITIONS.filter((module) => {
    if (module.key === COMPANY_MODULE.key) {
      return hasAccessPermission(user, "company.home.view") ||
        hasAccessPermission(user, "company.employees.view") ||
        hasAccessPermission(user, "company.organization.view") ||
        hasAccessPermission(user, "company.structure.view") ||
        hasAccessPermission(user, "company.access.view");
    }

    if (module.key === PLANNING_MODULE.key) {
      return hasAccessPermission(user, "planner.home.view") ||
        hasAccessPermission(user, "planner.schedules.weekly.view") ||
        hasAccessPermission(user, "planner.schedules.view") ||
        hasAccessPermission(user, "planner.attendance.view") ||
        hasAccessPermission(user, "planner.reports.view");
    }

    return true;
  }).map(asModuleCard);
}
