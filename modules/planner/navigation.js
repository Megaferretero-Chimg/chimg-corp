import { planningModulePath } from "@/modules/planner/routes";
import { PLANNING_EXCEPTIONS_ACCESS_ROLE } from "@/lib/access-roles";

export const DASHBOARD_NAVIGATION = [
  {
    title: "Inicio",
    href: planningModulePath("/home"),
    items: [
      {
        href: planningModulePath("/home"),
        label: "Resumen general",
        description: "Vista ejecutiva del sistema",
        permission: "planner.home.view",
      },
    ],
  },
  {
    title: "Planificación",
    href: planningModulePath("/schedules"),
    items: [
      {
        href: planningModulePath("/schedules"),
        label: "Planificacion semanal",
        description: "Horario aplicable por sucursal y semana",
        permission: "planner.schedules.view",
      },
      {
        href: planningModulePath("/planning/time-off"),
        label: "Vacaciones programadas",
        description: "Solicitudes anticipadas por empleado",
        permission: "planner.timeOff.view",
      },
      {
        href: planningModulePath("/planning/holidays"),
        label: "Feriados",
        description: "Calendario laboral mensual",
        permission: "planner.holidays.view",
      },
      {
        href: planningModulePath("/updates"),
        label: "Pendientes aprobacion",
        description: "Ajustes y excepciones por resolver",
        permission: "planner.updates.view",
      },
      {
        href: planningModulePath("/planning/exceptions"),
        label: "Todos los ajustes y excepciones",
        description: "CRUD completo por empleado y fecha",
        permission: "planner.exceptions.view",
      },
    ],
  },
  {
    title: "Control operativo",
    href: planningModulePath("/attendance/uploads"),
    items: [
      {
        href: planningModulePath("/attendance/uploads"),
        label: "Cargar picadas",
        description: "Importar archivos del biometrico",
        permission: "planner.attendance.view",
      },
      {
        href: planningModulePath("/attendance/review"),
        label: "Revisar picadas",
        description: "Ver y auditar picadas cargadas",
        permission: "planner.attendance.view",
      },
      {
        href: planningModulePath("/attendance/comparison"),
        label: "Horario vs picadas",
        description: "Comparar planificado contra asistencia real",
        permission: "planner.attendance.view",
      },
      {
        href: planningModulePath("/operations"),
        label: "Cruce de horas",
        description: "Completar laborables cuando haga falta",
        permission: "planner.operations.view",
      },
      {
        href: planningModulePath("/operations/monthly-payroll"),
        label: "Pre-nómina",
        description: "Tabla simple lista para nómina",
        permission: "planner.operations.view",
      },
      {
        href: planningModulePath("/operations/monthly-summary"),
        label: "Resumen de cierre",
        description: "Totales finales y descargas del mes",
        permission: "planner.operations.view",
      },
    ],
  },
  {
    title: "Nómina y costos",
    href: planningModulePath("/payroll"),
    items: [
      {
        href: planningModulePath("/payroll"),
        label: "Planificado vs ejecutado",
        description: "Variación de costos del mes",
        permission: "planner.payroll.view",
      },
    ],
  },
  {
    title: "Historial",
    href: planningModulePath("/history"),
    items: [
      {
        href: planningModulePath("/history"),
        label: "Historial operativo",
        description: "Trazabilidad de cambios y revisiones",
        permission: "planner.history.view",
      },
    ],
  },
  {
    title: "Configuracion",
    href: planningModulePath("/settings"),
    items: [
      {
        href: planningModulePath("/settings/base-schedules"),
        label: "Plantillas de horarios",
        description: "Horarios diarios reutilizables",
        permission: "planner.settings.view",
      },
      {
        href: planningModulePath("/settings/role-schedules"),
        label: "Horarios por cargo",
        description: "Horarios y efecto de picadas por cargo",
        permission: "planner.settings.view",
      },
      {
        href: planningModulePath("/settings/schedule-rules"),
        label: "Reglas de horario",
        description: "Tolerancia de atrasos",
        permission: "planner.settings.view",
      },
    ],
  },
];

export function findNavigationItem(pathname) {
  for (const section of DASHBOARD_NAVIGATION) {
    if (section.href === pathname) {
      return { href: section.href, label: section.title, description: section.title };
    }

    const match = section.items.find((item) => item.href === pathname);

    if (match) {
      return match;
    }
  }

  return null;
}

export function getDashboardNavigationForAccessRole(accessRole) {
  if (String(accessRole || "").trim().toLowerCase() !== PLANNING_EXCEPTIONS_ACCESS_ROLE) {
    return DASHBOARD_NAVIGATION;
  }

  const exceptionsItem = DASHBOARD_NAVIGATION
    .find((section) => section.title === "Planificación")
    ?.items.find((item) => item.href === planningModulePath("/planning/exceptions"));

  return [
    {
      title: "Planificación",
      href: planningModulePath("/planning/exceptions"),
      items: exceptionsItem ? [exceptionsItem] : [],
    },
  ];
}
