export const ACCESS_SCOPE_TYPES = [
  {
    value: "company",
    label: "Toda la empresa",
    description: "Puede actuar sobre toda la información autorizada.",
  },
  {
    value: "branch",
    label: "Sucursal",
    description: "Queda limitado a una o varias sucursales.",
  },
  {
    value: "area",
    label: "Área",
    description: "Queda limitado a una o varias áreas funcionales.",
  },
  {
    value: "team",
    label: "Equipo directo",
    description: "Queda limitado a su equipo o cadena de responsabilidad.",
  },
  {
    value: "self",
    label: "Propio usuario",
    description: "Solo puede consultar o gestionar su propia información.",
  },
];

export const ACCESS_PERMISSION_CATALOG = [
  {
    moduleKey: "company",
    moduleLabel: "Empresa",
    groups: [
      {
        key: "company.home",
        label: "Inicio",
        description: "Resumen general de la empresa.",
        permissions: [
          { key: "company.home.view", label: "Ver inicio", type: "page", path: "/modules/company/home" },
        ],
      },
      {
        key: "company.organization",
        label: "Organización",
        description: "Áreas, cargos, sucursales y organigrama.",
        permissions: [
          { key: "company.organization.view", label: "Ver organización", type: "page", path: "/modules/company/organization" },
          { key: "company.areas.view", label: "Ver áreas", type: "page", path: "/modules/company/areas" },
          { key: "company.areas.manage", label: "Gestionar áreas", type: "action", requiresAnyPage: ["company.areas.view"] },
          { key: "company.roles.view", label: "Ver cargos", type: "page", path: "/modules/company/roles" },
          { key: "company.roles.manage", label: "Gestionar cargos", type: "action", requiresAnyPage: ["company.roles.view"] },
          { key: "company.branches.view", label: "Ver sucursales", type: "page", path: "/modules/company/branches" },
          { key: "company.branches.manage", label: "Gestionar sucursales", type: "action", requiresAnyPage: ["company.branches.view"] },
          { key: "company.structure.view", label: "Ver estructura", type: "page", path: "/modules/company/structure" },
          { key: "company.structure.manage", label: "Editar estructura", type: "action", requiresAnyPage: ["company.structure.view"] },
        ],
      },
      {
        key: "company.people",
        label: "Personas",
        description: "Empleados vinculados a la estructura empresarial.",
        permissions: [
          { key: "company.employees.view", label: "Ver empleados", type: "page", path: "/modules/company/employees" },
          { key: "company.employees.create", label: "Crear empleados", type: "action", requiresAnyPage: ["company.employees.view"] },
          { key: "company.employees.update", label: "Editar empleados", type: "action", requiresAnyPage: ["company.employees.view"] },
          { key: "company.employees.delete", label: "Eliminar empleados", type: "action", requiresAnyPage: ["company.employees.view"] },
        ],
      },
      {
        key: "company.access",
        label: "Acceso",
        description: "Usuarios, perfiles y permisos de plataforma.",
        permissions: [
          { key: "company.access.view", label: "Ver acceso", type: "page", path: "/modules/company/access" },
          { key: "company.users.view", label: "Ver usuarios", type: "page", path: "/modules/company/users" },
          { key: "company.users.manage", label: "Gestionar usuarios", type: "action", requiresAnyPage: ["company.users.view"] },
          { key: "company.accessRoles.view", label: "Ver perfiles de acceso", type: "page", path: "/modules/company/permissions" },
          { key: "company.accessRoles.manage", label: "Gestionar perfiles de acceso", type: "action", requiresAnyPage: ["company.accessRoles.view"] },
        ],
      },
    ],
  },
  {
    moduleKey: "planner",
    moduleLabel: "Planificación",
    groups: [
      {
        key: "planner.home",
        label: "Inicio",
        description: "Resumen operativo de planificación.",
        permissions: [
          { key: "planner.home.view", label: "Ver inicio", type: "page", path: "/modules/planning/home" },
        ],
      },
      {
        key: "planner.schedules",
        label: "Planificación",
        description: "Horarios, vacaciones, feriados, novedades y excepciones.",
        permissions: [
          { key: "planner.schedules.weekly.view", label: "Ver planificación semanal", type: "page", path: "/modules/planning/schedules" },
          { key: "planner.schedules.view", label: "Ver otras vistas de horarios", type: "page" },
          { key: "planner.schedules.summary.view", label: "Ver resumen de planificacion", type: "page", path: "/modules/planning/planning" },
          { key: "planner.schedules.manage", label: "Gestionar horarios", type: "action", requiresAnyPage: ["planner.schedules.weekly.view", "planner.schedules.view"] },
          { key: "planner.schedules.export", label: "Exportar planificación", type: "action", requiresAnyPage: ["planner.schedules.weekly.view", "planner.schedules.view"] },
          { key: "planner.schedules.quickTemplates.create", label: "Crear plantillas rápidas", type: "action", requiresAnyPage: ["planner.schedules.weekly.view"] },
          { key: "planner.schedules.adjustments.create", label: "Crear ajustes desde el horario", type: "action", requiresAnyPage: ["planner.schedules.weekly.view"] },
          { key: "planner.schedules.details.view", label: "Abrir detalle mensual", type: "action", requiresAnyPage: ["planner.schedules.weekly.view", "planner.schedules.view"] },
          { key: "planner.schedules.summaries.view", label: "Ver resúmenes semanales", type: "action", requiresAnyPage: ["planner.schedules.weekly.view"] },
          { key: "planner.schedules.hours.view", label: "Ver horas planificadas", type: "action", requiresAnyPage: ["planner.schedules.weekly.view", "planner.schedules.view"] },
          { key: "planner.schedules.financial.view", label: "Ver información monetaria", type: "action", requiresAnyPage: ["planner.schedules.weekly.view", "planner.schedules.summary.view", "planner.schedules.view"] },
          { key: "planner.timeOff.view", label: "Ver y solicitar vacaciones", type: "page", path: "/modules/planning/planning/time-off" },
          { key: "planner.timeOff.manage", label: "Resolver y eliminar vacaciones", type: "action", requiresAnyPage: ["planner.timeOff.view"] },
          { key: "planner.holidays.view", label: "Ver feriados", type: "page", path: "/modules/planning/planning/holidays" },
          { key: "planner.holidays.manage", label: "Gestionar feriados", type: "action", requiresAnyPage: ["planner.holidays.view"] },
          { key: "planner.updates.view", label: "Ver pendientes aprobacion", type: "page", path: "/modules/planning/updates" },
          { key: "planner.updates.manage", label: "Gestionar pendientes", type: "action", requiresAnyPage: ["planner.updates.view"] },
          { key: "planner.exceptions.view", label: "Ver todos los ajustes y excepciones", type: "page", path: "/modules/planning/planning/exceptions" },
          { key: "planner.exceptions.create", label: "Crear ajustes y excepciones", type: "action", requiresAnyPage: ["planner.exceptions.view"] },
          { key: "planner.exceptions.viewAll", label: "Ver registros creados por otros usuarios", type: "action", requiresAnyPage: ["planner.exceptions.view"] },
          { key: "planner.exceptions.deleteOwn", label: "Eliminar registros propios pendientes", type: "action", requiresAnyPage: ["planner.exceptions.view"] },
          { key: "planner.exceptions.approve", label: "Modificar, resolver y anular registros", type: "action", requiresAnyPage: ["planner.exceptions.view"] },
        ],
      },
      {
        key: "planner.attendance",
        label: "Asistencia real",
        description: "Carga, revision y cruce de picadas.",
        permissions: [
          { key: "planner.attendance.view", label: "Ver asistencia", type: "page", path: "/modules/planning/attendance" },
          { key: "planner.attendance.upload", label: "Cargar picadas", type: "action", requiresAnyPage: ["planner.attendance.view"] },
          { key: "planner.attendance.review", label: "Revisar picadas", type: "action", requiresAnyPage: ["planner.attendance.view"] },
          { key: "planner.attendance.close", label: "Cerrar asistencia", type: "action", requiresAnyPage: ["planner.attendance.view"] },
          { key: "planner.operations.view", label: "Ver control operativo", type: "page", path: "/modules/planning/operations" },
          { key: "planner.operations.manage", label: "Gestionar control operativo", type: "action", requiresAnyPage: ["planner.operations.view"] },
        ],
      },
      {
        key: "planner.payroll",
        label: "Nómina y costos",
        description: "Costos, estimaciones, pagos y exportables.",
        permissions: [
          { key: "planner.payroll.view", label: "Ver nómina", type: "page", path: "/modules/planning/payroll" },
          { key: "planner.payroll.manage", label: "Gestionar nómina", type: "action", requiresAnyPage: ["planner.payroll.view"] },
          { key: "planner.payroll.export", label: "Exportar nómina", type: "action", requiresAnyPage: ["planner.payroll.view"] },
        ],
      },
      {
        key: "planner.reports",
        label: "Historial",
        description: "Trazabilidad operativa y auditoría de acciones.",
        permissions: [
          { key: "planner.history.view", label: "Ver historial operativo", type: "page", path: "/modules/planning/history" },
        ],
      },
      {
        key: "planner.settings",
        label: "Configuración",
        description: "Reglas laborales, autorizaciones y plantillas.",
        permissions: [
          { key: "planner.settings.view", label: "Ver configuración", type: "page", path: "/modules/planning/settings" },
          { key: "planner.settings.manage", label: "Gestionar configuración", type: "action", requiresAnyPage: ["planner.settings.view"] },
        ],
      },
    ],
  },
];

export const ALL_ACCESS_PERMISSIONS = ACCESS_PERMISSION_CATALOG.flatMap((module) =>
  module.groups.flatMap((group) => group.permissions.map((permission) => permission.key)),
);

const PRIMARY_PAGE_PERMISSION_REQUIREMENTS = ACCESS_PERMISSION_CATALOG.flatMap((module) =>
  module.groups.flatMap((group) =>
    group.permissions
      .filter((permission) => permission.type === "page" && permission.path)
      .map((permission) => ({
        path: permission.path,
        permission: permission.key,
      })),
  ),
).sort((left, right) => right.path.length - left.path.length);

export const ACCESS_PAGE_CATALOG = [
  {
    moduleKey: "company",
    moduleLabel: "Empresa y configuración",
    pages: [
      ["Entrada al módulo", "/modules/company", "company.home.view"],
      ["Inicio", "/modules/company/home", "company.home.view"],
      ["Organización", "/modules/company/organization", "company.organization.view"],
      ["Áreas", "/modules/company/areas", "company.areas.view"],
      ["Cargos", "/modules/company/roles", "company.roles.view"],
      ["Sucursales", "/modules/company/branches", "company.branches.view"],
      ["Estructura organizacional", "/modules/company/structure", "company.structure.view"],
      ["Empleados", "/modules/company/employees", "company.employees.view"],
      ["Acceso", "/modules/company/access", "company.access.view"],
      ["Usuarios", "/modules/company/users", "company.users.view"],
      ["Roles de acceso", "/modules/company/permissions", "company.accessRoles.view"],
    ],
  },
  {
    moduleKey: "planner",
    moduleLabel: "Planificación",
    pages: [
      ["Entrada al módulo", "/modules/planning", "planner.home.view"],
      ["Inicio", "/modules/planning/home", "planner.home.view"],
      ["Planificación semanal", "/modules/planning/schedules", "planner.schedules.weekly.view"],
      ["Resumen de planificación", "/modules/planning/planning", "planner.schedules.summary.view"],
      ["Planificación semanal (ruta auxiliar)", "/modules/planning/planning/weekly", "planner.schedules.view"],
      ["Planificación mensual", "/modules/planning/planning/monthly", "planner.schedules.view"],
      ["Detalle mensual por empleado", "/modules/planning/planning/monthly/[employeeId]", "planner.schedules.view"],
      ["Vacaciones programadas", "/modules/planning/planning/time-off", "planner.timeOff.view"],
      ["Feriados", "/modules/planning/planning/holidays", "planner.holidays.view"],
      ["Pendientes de aprobación", "/modules/planning/updates", "planner.updates.view"],
      ["Ajustes y excepciones", "/modules/planning/planning/exceptions", "planner.exceptions.view"],
      ["Empleados de planificación", "/modules/planning/employees", "planner.schedules.view"],
      ["Asistencia", "/modules/planning/attendance", "planner.attendance.view"],
      ["Cargar picadas", "/modules/planning/attendance/uploads", "planner.attendance.view"],
      ["Detalle de carga", "/modules/planning/attendance/uploads/[id]", "planner.attendance.view"],
      ["Cargas (ruta auxiliar)", "/modules/planning/uploads", "planner.attendance.view"],
      ["Detalle de carga (ruta auxiliar)", "/modules/planning/uploads/[id]", "planner.attendance.view"],
      ["Revisar picadas", "/modules/planning/attendance/review", "planner.attendance.view"],
      ["Horario vs. picadas", "/modules/planning/attendance/comparison", "planner.attendance.view"],
      ["Comparación por empleado", "/modules/planning/attendance/comparison/[employeeId]", "planner.attendance.view"],
      ["Cierre mensual de asistencia", "/modules/planning/attendance/monthly-closure", "planner.attendance.view"],
      ["Control operativo", "/modules/planning/operations", "planner.operations.view"],
      ["Cobertura", "/modules/planning/operations/coverage", "planner.operations.view"],
      ["Incidencias", "/modules/planning/operations/incidents", "planner.operations.view"],
      ["Seguimiento semanal", "/modules/planning/operations/weekly-tracking", "planner.operations.view"],
      ["Pre-nómina", "/modules/planning/operations/monthly-payroll", "planner.operations.view"],
      ["Resumen mensual", "/modules/planning/operations/monthly-summary", "planner.operations.view"],
      ["Detalle de resumen mensual", "/modules/planning/operations/monthly-summary/[month]", "planner.operations.view"],
      ["Cierre mensual operativo", "/modules/planning/operations/monthly-closure", "planner.operations.view"],
      ["Revisión", "/modules/planning/review", "planner.operations.view"],
      ["Cierre", "/modules/planning/closure", "planner.operations.view"],
      ["Conciliación", "/modules/planning/reconciliation", "planner.operations.view"],
      ["Nómina y costos", "/modules/planning/payroll", "planner.payroll.view"],
      ["Estimación de nómina", "/modules/planning/payroll/estimate", "planner.payroll.view"],
      ["Nómina por empleado", "/modules/planning/payroll/by-employee", "planner.payroll.view"],
      ["Horas extra", "/modules/planning/payroll/overtime", "planner.payroll.view"],
      ["Costo planificado", "/modules/planning/payroll/planned-cost", "planner.payroll.view"],
      ["Análisis de costo planificado", "/modules/planning/payroll/planned-cost/analysis", "planner.payroll.view"],
      ["Costo ejecutado", "/modules/planning/payroll/executed-cost", "planner.payroll.view"],
      ["Reportes", "/modules/planning/reports", "planner.history.view"],
      ["Reporte mensual", "/modules/planning/reports/monthly", "planner.history.view"],
      ["Reporte semanal", "/modules/planning/reports/weekly", "planner.history.view"],
      ["Reporte por empleado", "/modules/planning/reports/employees", "planner.history.view"],
      ["Reporte por sucursal", "/modules/planning/reports/branches", "planner.history.view"],
      ["Reporte organizacional", "/modules/planning/reports/organization", "planner.history.view"],
      ["Planificado vs. real", "/modules/planning/reports/plan-vs-real", "planner.history.view"],
      ["Historial operativo", "/modules/planning/history", "planner.history.view"],
      ["Configuración de planificación", "/modules/planning/settings", "planner.settings.view"],
      ["Grupos de trabajo", "/modules/planning/settings/work-groups", "planner.settings.view"],
      ["Plantillas de horarios", "/modules/planning/settings/base-schedules", "planner.settings.view"],
      ["Horarios por cargo", "/modules/planning/settings/role-schedules", "planner.settings.view"],
      ["Reglas de horario", "/modules/planning/settings/schedule-rules", "planner.settings.view"],
      ["Áreas de planificación", "/modules/planning/settings/areas", "planner.settings.view"],
      ["Sucursales de planificación", "/modules/planning/settings/branches", "planner.settings.view"],
      ["Cargos de planificación", "/modules/planning/settings/roles", "planner.settings.view"],
      ["Usuarios de planificación", "/modules/planning/settings/users", "planner.settings.view"],
      ["Feriados de configuración", "/modules/planning/settings/holidays", "planner.settings.view"],
      ["Autorizaciones (redirección)", "/modules/planning/settings/authorizations", "planner.settings.view"],
      ["Reglas laborales (redirección)", "/modules/planning/settings/labor-rules", "planner.settings.view"],
      ["Reglas de picadas (redirección)", "/modules/planning/settings/punch-rules", "planner.settings.view"],
    ],
  },
].map((module) => ({
  ...module,
  pages: module.pages.map(([label, path, permission]) => ({ label, path, permission })),
}));

export const PAGE_PERMISSION_REQUIREMENTS = ACCESS_PAGE_CATALOG.flatMap((module) =>
  module.pages.map(({ path, permission }) => ({
    path: path.replace(/\[[^/]+\]/g, "").replace(/\/$/, ""),
    permission,
  })),
).concat(PRIMARY_PAGE_PERMISSION_REQUIREMENTS).sort((left, right) => right.path.length - left.path.length);

const KNOWN_PERMISSION_SET = new Set(ALL_ACCESS_PERMISSIONS);
const ADMIN_ACCESS_ROLE_CODES = new Set(["admin", "administrator", "administrador"]);

function normalizeAccessRole(value) {
  return String(value || "").trim().toLowerCase();
}

export function isAdminAccessRole(value) {
  return ADMIN_ACCESS_ROLE_CODES.has(normalizeAccessRole(value));
}

export function isAdminAccessUser(user = {}) {
  return isAdminAccessRole(user?.accessRole) || isAdminAccessRole(user?.accessRoleLabel);
}

export const DEFAULT_ROLE_PERMISSIONS = {
  admin: ALL_ACCESS_PERMISSIONS,
  payroll_manager: ALL_ACCESS_PERMISSIONS.filter((permission) => permission.startsWith("planner.")),
  supervisor: [
    "company.home.view",
    "company.employees.view",
    "company.organization.view",
    "company.branches.view",
    "company.areas.view",
    "company.structure.view",
    "company.roles.view",
    "planner.home.view",
    "planner.schedules.view",
    "planner.schedules.summary.view",
    "planner.schedules.manage",
    "planner.updates.view",
    "planner.updates.manage",
    "planner.exceptions.view",
    "planner.exceptions.manage",
    "planner.attendance.view",
    "planner.attendance.review",
    "planner.operations.view",
    "planner.history.view",
  ],
  operator: [
    "planner.home.view",
    "planner.schedules.view",
    "planner.schedules.summary.view",
    "planner.updates.view",
    "planner.updates.manage",
    "planner.attendance.view",
    "planner.attendance.upload",
    "planner.attendance.review",
  ],
  planning_exceptions: [
    "planner.exceptions.view",
    "planner.exceptions.manage",
  ],
  viewer: [
    "company.home.view",
    "company.employees.view",
    "company.organization.view",
    "company.structure.view",
    "planner.home.view",
    "planner.schedules.view",
    "planner.schedules.summary.view",
    "planner.updates.view",
    "planner.attendance.view",
    "planner.history.view",
  ],
};

export function normalizePermissions(value) {
  const permissions = Array.isArray(value) ? value : [];
  return [...new Set(
    permissions
      .map((permission) => String(permission || "").trim())
      .filter((permission) => KNOWN_PERMISSION_SET.has(permission)),
  )].sort();
}

export function normalizePermissionDependencies(value) {
  const normalized = normalizePermissions(value);
  const permissionsByKey = new Map(ACCESS_PERMISSION_CATALOG.flatMap((module) =>
    module.groups.flatMap((group) => group.permissions.map((permission) => [permission.key, permission])),
  ));
  const selectedPages = new Set(normalized.filter((key) => permissionsByKey.get(key)?.type === "page"));

  return normalized.filter((key) => {
    const permission = permissionsByKey.get(key);

    if (permission?.type === "page") return true;
    if (permission?.type !== "action") return false;

    const requiredPages = Array.isArray(permission.requiresAnyPage) ? permission.requiresAnyPage : [];

    return requiredPages.some((pageKey) => selectedPages.has(pageKey));
  });
}

export function getDefaultPermissionsForRole(code) {
  return normalizePermissions(DEFAULT_ROLE_PERMISSIONS[normalizeAccessRole(code)] || []);
}

export function resolvePermissionsForAccessRole(accessRole, explicitPermissions = null) {
  if (isAdminAccessRole(accessRole)) {
    return ALL_ACCESS_PERMISSIONS;
  }

  if (Array.isArray(explicitPermissions)) {
    return normalizePermissions(explicitPermissions);
  }

  return getDefaultPermissionsForRole(accessRole);
}

export function hasAccessPermission(user, permission) {
  if (!permission) {
    return true;
  }

  if (isAdminAccessUser(user)) {
    return true;
  }

  return new Set(resolvePermissionsForAccessRole(user?.accessRole, user?.permissions)).has(permission);
}

export function getAccessibleModuleKeys(user) {
  const routeModuleKeyByPermissionModule = {
    company: "company",
    planner: "planning",
  };

  return ACCESS_PAGE_CATALOG
    .filter((module) => module.pages.some((page) => hasAccessPermission(user, page.permission)))
    .map((module) => routeModuleKeyByPermissionModule[module.moduleKey] || module.moduleKey);
}

export function canSwitchModules(user) {
  return getAccessibleModuleKeys(user).length > 1;
}

export function getRequiredPermissionForPath(pathname) {
  const path = String(pathname || "").split("?")[0].replace(/\/+$/, "") || "/";

  return PAGE_PERMISSION_REQUIREMENTS.find((requirement) =>
    path === requirement.path || path.startsWith(`${requirement.path}/`),
  )?.permission || "";
}
