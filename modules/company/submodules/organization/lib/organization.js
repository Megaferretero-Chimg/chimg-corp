export const BRANCH_OPTIONS = ["MATRIZ", "SALCEDO"];

export const COMPANY_PLANNING_RULES = {
  companyOperatingHours: "07:00-19:00",
  regularDailyHours: 8,
  regularWeeklyHours: 40,
  suggestedDailyBudgetHours: 9,
  supplementaryHoursPerDayLimit: 1,
  mandatoryRestDaysPerWeek: 2,
  holidayOvertimeMultiplierLabel: "Feriado = extraordinaria doble",
};

export const ORGANIZATION_AREAS = [
  {
    code: "ventas",
    label: "Ventas",
    lunchMinutes: 90,
    notes: "Cobertura comercial con turnos intercalados por semana.",
    roles: [
      {
        code: "cajera",
        label: "Cajera",
        scheduleProfile: "07:00-18:00 / 08:30-18:00",
        lunchMinutes: 90,
        weeklyRotation: "Intercalado semanal",
        authorizedExtraHoursPerDay: 1,
      },
      {
        code: "acabados",
        label: "Acabados",
        scheduleProfile: "07:00-17:00 / 08:00-18:00 / 09:00-19:00",
        lunchMinutes: 90,
        weeklyRotation: "Intercalado semanal",
        authorizedExtraHoursPerDay: 1,
      },
      {
        code: "ferretero",
        label: "Ferretero",
        scheduleProfile: "07:00-17:00 / 08:00-18:00 / 09:00-19:00",
        lunchMinutes: 90,
        weeklyRotation: "Intercalado semanal",
        authorizedExtraHoursPerDay: 1,
      },
      {
        code: "jefe_ventas",
        label: "Jefe de ventas",
        scheduleProfile: "07:00-18:00 / 08:00-19:00",
        lunchMinutes: 60,
        weeklyRotation: "Alterna con backup cada semana",
        authorizedExtraHoursPerMonth: 2,
      },
    ],
  },
  {
    code: "operaciones",
    label: "Operaciones",
    lunchMinutes: 60,
    notes: "Cobertura operativa con máximo de 2 días extraordinarios.",
    roles: [
      {
        code: "jefe_bodega",
        label: "Jefe de bodega",
        scheduleProfile: "07:00-18:00 / 08:00-19:00",
        lunchMinutes: 60,
        weeklyRotation: "Alterna con backup cada semana",
        authorizedExtraHoursPerMonth: 2,
      },
      {
        code: "bodeguero",
        label: "Bodeguero",
        scheduleProfile: "07:00-17:00 / 08:00-18:00",
        lunchMinutes: 60,
        maxExtraordinaryDaysPerMonth: 2,
      },
      {
        code: "chofer",
        label: "Chofer",
        scheduleProfile: "07:00-17:00 / 08:00-18:00",
        lunchMinutes: 60,
        maxExtraordinaryDaysPerMonth: 2,
      },
    ],
  },
  {
    code: "administrativos",
    label: "Administrativos",
    lunchMinutes: 60,
    notes: "Ingreso base a las 08:00, salida a las 18:00 y control por presupuesto.",
    roles: [
      {
        code: "contadora",
        label: "Contadora",
        scheduleProfile: "08:00-18:00",
        lunchMinutes: 60,
        authorizedExtraHoursPerMonth: 2,
      },
      {
        code: "compras",
        label: "Compras",
        scheduleProfile: "08:00-18:00",
        lunchMinutes: 60,
        authorizedExtraHoursPerMonth: 2,
      },
      {
        code: "cartera",
        label: "Cartera",
        scheduleProfile: "08:00-18:00",
        lunchMinutes: 60,
        authorizedExtraHoursPerMonth: 2,
      },
      {
        code: "marketing",
        label: "Marketing",
        scheduleProfile: "08:00-18:00",
        lunchMinutes: 60,
        authorizedExtraHoursPerMonth: 2,
      },
      {
        code: "compras_publicas",
        label: "Compras públicas",
        scheduleProfile: "08:00-18:00",
        lunchMinutes: 60,
        authorizedExtraHoursPerMonth: 2,
      },
      {
        code: "pagos",
        label: "Pagos",
        scheduleProfile: "08:00-18:00",
        lunchMinutes: 60,
        authorizedExtraHoursPerMonth: 2,
      },
    ],
  },
];

const AREA_MAP = new Map(ORGANIZATION_AREAS.map((area) => [area.code, area]));
const ROLE_MAP = new Map(
  ORGANIZATION_AREAS.flatMap((area) =>
    area.roles.map((role) => [`${area.code}:${role.code}`, { ...role, areaCode: area.code, areaName: area.label }]),
  ),
);

export function getAreaConfig(areaCode) {
  return AREA_MAP.get(String(areaCode || "").trim()) || null;
}

export function getRolesForArea(areaCode) {
  return getAreaConfig(areaCode)?.roles || [];
}

export function getRoleConfig(areaCode, roleCode) {
  return ROLE_MAP.get(`${String(areaCode || "").trim()}:${String(roleCode || "").trim()}`) || null;
}

export function resolveOrganizationLabels(areaCode, roleCode) {
  const area = getAreaConfig(areaCode);
  const role = getRoleConfig(areaCode, roleCode);

  return {
    areaCode: area?.code || "",
    areaName: area?.label || "",
    roleCode: role?.code || "",
    roleName: role?.label || "",
  };
}

export function buildOrganizationSummary(employeeLike) {
  const areaName = String(employeeLike?.areaName || "").trim();
  const roleName = String(employeeLike?.roleName || "").trim();
  const department = String(employeeLike?.department || "").trim();

  if (areaName && roleName) {
    return `${areaName} · ${roleName}`;
  }

  if (areaName) {
    return areaName;
  }

  if (department) {
    return department;
  }

  return "Sin estructura definida";
}
