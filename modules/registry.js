import {
  canAccessRequestPath,
  COMPANY_EMPLOYEES_PATH,
  PLANNING_EXCEPTIONS_PATH,
  isCompanyEmployeeOnlyUser,
  isPlanningExceptionsUser,
} from "@/lib/access-control";
import { ACADEMY_MODULE } from "@/modules/academy/module";
import { COMPANY_MODULE } from "@/modules/company/module";
import { PLANNING_MODULE } from "@/modules/planner/module";
import { BUSINESS_MODULE } from "@/modules/business/module";
import {
  hasAccessPermission,
  isAdminAccessUser,
} from "@/modules/company/submodules/access/lib/permissions";

export const MODULE_DEFINITIONS = [
  {
    ...BUSINESS_MODULE,
    status: "Disponible",
    description: "Productos, existencias, bodegas y futuros datos comerciales.",
    bullets: ["Inventario", "Bodegas", "Cajas offline", "Sincronización"],
    icon: "package-search",
  },
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
  {
    ...ACADEMY_MODULE,
    status: "Disponible",
    description: "Administración de cursos, contenidos y capacitación interna.",
    bullets: ["Cursos", "Capítulos y lecciones", "Evaluaciones", "Configuración"],
    icon: "graduation-cap",
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
    return MODULE_DEFINITIONS
      .filter((module) => module.key !== BUSINESS_MODULE.key && module.key !== ACADEMY_MODULE.key)
      .map((module) => {
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

    if (module.key === BUSINESS_MODULE.key) {
      return isAdminAccessUser(user);
    }

    if (module.key === ACADEMY_MODULE.key) {
      return canAccessRequestPath(user, module.homeHref);
    }

    return true;
  }).map((module) => {
    return asModuleCard(module);
  });
}
