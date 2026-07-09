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
          { key: "company.areas.manage", label: "Gestionar áreas", type: "action" },
          { key: "company.roles.view", label: "Ver cargos", type: "page", path: "/modules/company/roles" },
          { key: "company.roles.manage", label: "Gestionar cargos", type: "action" },
          { key: "company.branches.view", label: "Ver sucursales", type: "page", path: "/modules/company/branches" },
          { key: "company.branches.manage", label: "Gestionar sucursales", type: "action" },
          { key: "company.structure.view", label: "Ver estructura", type: "page", path: "/modules/company/structure" },
          { key: "company.structure.manage", label: "Editar estructura", type: "action" },
        ],
      },
      {
        key: "company.people",
        label: "Personas",
        description: "Empleados vinculados a la estructura empresarial.",
        permissions: [
          { key: "company.employees.view", label: "Ver empleados", type: "page", path: "/modules/company/employees" },
          { key: "company.employees.create", label: "Crear empleados", type: "action" },
          { key: "company.employees.update", label: "Editar empleados", type: "action" },
          { key: "company.employees.delete", label: "Eliminar empleados", type: "action" },
        ],
      },
      {
        key: "company.access",
        label: "Acceso",
        description: "Usuarios, perfiles y permisos de plataforma.",
        permissions: [
          { key: "company.access.view", label: "Ver acceso", type: "page", path: "/modules/company/access" },
          { key: "company.users.view", label: "Ver usuarios", type: "page", path: "/modules/company/users" },
          { key: "company.users.manage", label: "Gestionar usuarios", type: "action" },
          { key: "company.accessRoles.view", label: "Ver perfiles de acceso", type: "page", path: "/modules/company/permissions" },
          { key: "company.accessRoles.manage", label: "Gestionar perfiles de acceso", type: "action" },
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
          { key: "planner.schedules.view", label: "Ver planificacion semanal", type: "page", path: "/modules/planning/schedules" },
          { key: "planner.schedules.summary.view", label: "Ver resumen de planificacion", type: "page", path: "/modules/planning/planning" },
          { key: "planner.schedules.manage", label: "Gestionar horarios", type: "action" },
          { key: "planner.timeOff.view", label: "Ver vacaciones", type: "page", path: "/modules/planning/planning/time-off" },
          { key: "planner.timeOff.manage", label: "Gestionar vacaciones", type: "action" },
          { key: "planner.holidays.view", label: "Ver feriados", type: "page", path: "/modules/planning/planning/holidays" },
          { key: "planner.holidays.manage", label: "Gestionar feriados", type: "action" },
          { key: "planner.updates.view", label: "Ver pendientes aprobacion", type: "page", path: "/modules/planning/updates" },
          { key: "planner.updates.manage", label: "Gestionar pendientes", type: "action" },
          { key: "planner.exceptions.view", label: "Ver todos los ajustes y excepciones", type: "page", path: "/modules/planning/planning/exceptions" },
          { key: "planner.exceptions.manage", label: "Gestionar ajustes y excepciones", type: "action" },
        ],
      },
      {
        key: "planner.attendance",
        label: "Asistencia real",
        description: "Carga, revision y cruce de picadas.",
        permissions: [
          { key: "planner.attendance.view", label: "Ver asistencia", type: "page", path: "/modules/planning/attendance" },
          { key: "planner.attendance.upload", label: "Cargar picadas", type: "action" },
          { key: "planner.attendance.review", label: "Revisar picadas", type: "action" },
          { key: "planner.attendance.close", label: "Cerrar asistencia", type: "action" },
          { key: "planner.operations.view", label: "Ver control operativo", type: "page", path: "/modules/planning/operations" },
          { key: "planner.operations.manage", label: "Gestionar control operativo", type: "action" },
        ],
      },
      {
        key: "planner.payroll",
        label: "Nómina y costos",
        description: "Costos, estimaciones, pagos y exportables.",
        permissions: [
          { key: "planner.payroll.view", label: "Ver nómina", type: "page", path: "/modules/planning/payroll" },
          { key: "planner.payroll.manage", label: "Gestionar nómina", type: "action" },
          { key: "planner.payroll.export", label: "Exportar nómina", type: "action" },
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
          { key: "planner.settings.manage", label: "Gestionar configuración", type: "action" },
        ],
      },
    ],
  },
];

export const ALL_ACCESS_PERMISSIONS = ACCESS_PERMISSION_CATALOG.flatMap((module) =>
  module.groups.flatMap((group) => group.permissions.map((permission) => permission.key)),
);

export const PAGE_PERMISSION_REQUIREMENTS = ACCESS_PERMISSION_CATALOG.flatMap((module) =>
  module.groups.flatMap((group) =>
    group.permissions
      .filter((permission) => permission.type === "page" && permission.path)
      .map((permission) => ({
        path: permission.path,
        permission: permission.key,
      })),
  ),
).sort((left, right) => right.path.length - left.path.length);

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

export function getDefaultPermissionsForRole(code) {
  return normalizePermissions(DEFAULT_ROLE_PERMISSIONS[normalizeAccessRole(code)] || []);
}

export function resolvePermissionsForAccessRole(accessRole, explicitPermissions = null) {
  if (isAdminAccessRole(accessRole)) {
    return ALL_ACCESS_PERMISSIONS;
  }

  const normalizedExplicitPermissions = normalizePermissions(explicitPermissions);

  if (normalizedExplicitPermissions.length) {
    return normalizedExplicitPermissions;
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

export function getRequiredPermissionForPath(pathname) {
  const path = String(pathname || "").split("?")[0].replace(/\/+$/, "") || "/";

  return PAGE_PERMISSION_REQUIREMENTS.find((requirement) =>
    path === requirement.path || path.startsWith(`${requirement.path}/`),
  )?.permission || "";
}
