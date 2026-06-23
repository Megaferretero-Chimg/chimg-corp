import { planningModulePath } from "@/lib/modules/planning/routes";

export const DASHBOARD_NAVIGATION = [
  {
    title: "Inicio",
    href: planningModulePath("/home"),
    items: [
      {
        href: planningModulePath("/home"),
        label: "Resumen general",
        description: "Vista ejecutiva del sistema",
      },
    ],
  },
  {
    title: "Planificación",
    href: planningModulePath("/planning"),
    items: [
      {
        href: planningModulePath("/planning/monthly"),
        label: "Programacion de horarios",
        description: "Asignacion por empleado y mes",
      },
      {
        href: planningModulePath("/planning/exceptions"),
        label: "Ajustes y excepciones",
        description: "Cambios por empleado o situación",
      },
      {
        href: planningModulePath("/planning/time-off"),
        label: "Vacaciones programadas",
        description: "Solicitudes anticipadas por empleado",
      },
    ],
  },
  {
    title: "Asistencia",
    href: planningModulePath("/attendance"),
    items: [
      {
        href: planningModulePath("/attendance/uploads"),
        label: "Cargar picadas",
        description: "Importación desde biométrico",
      },
      {
        href: planningModulePath("/attendance/review"),
        label: "Revisar picadas",
        description: "Normalización y control",
      },
      {
        href: planningModulePath("/attendance/comparison"),
        label: "Comparar con horario",
        description: "Planificado vs ejecutado",
      },
    ],
  },
  {
    title: "Operación",
    href: planningModulePath("/operations/monthly-closure"),
    items: [
      {
        href: planningModulePath("/operations/monthly-closure"),
        label: "Cruce de horas",
        description: "Completar laborables cuando haga falta",
      },
      {
        href: planningModulePath("/operations/monthly-payroll"),
        label: "Pre-nómina",
        description: "Tabla simple lista para nómina",
      },
      {
        href: planningModulePath("/operations/monthly-summary"),
        label: "Resumen de cierre",
        description: "Totales finales y descargas del mes",
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
      },
    ],
  },
  {
    title: "Reportes",
    href: planningModulePath("/reports/monthly"),
    items: [
      {
        href: planningModulePath("/reports/monthly"),
        label: "Reporte mensual",
        description: "Cierre, costos y exportables",
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
        description: "Horarios base por area y rol",
      },
      {
        href: planningModulePath("/settings/holidays"),
        label: "Feriados",
        description: "Calendario laboral mensual",
      },
      {
        href: planningModulePath("/settings/labor-rules"),
        label: "Reglas laborales",
        description: "Jornadas, descansos, feriados y recargos",
      },
      {
        href: planningModulePath("/settings/authorizations"),
        label: "Autorizaciones",
        description: "Control de extras y permisos",
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
