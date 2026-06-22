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
      {
        href: planningModulePath("/attendance/monthly-closure"),
        label: "Cierre de mes",
        description: "Copia fija de horas para nomina",
      },
    ],
  },
  {
    title: "Operación",
    href: planningModulePath("/operations"),
    items: [
      {
        href: planningModulePath("/operations/weekly-tracking"),
        label: "Seguimiento semanal",
        description: "Validación del cumplimiento real",
      },
      {
        href: planningModulePath("/operations/incidents"),
        label: "Incidencias",
        description: "Enfermedad, ausencia y reemplazos",
      },
      {
        href: planningModulePath("/operations/coverage"),
        label: "Cobertura por área y rol",
        description: "Demanda vs disponibilidad",
      },
    ],
  },
  {
    title: "Nómina y costos",
    href: planningModulePath("/payroll"),
    items: [
      {
        href: planningModulePath("/payroll/planned-cost"),
        label: "Costo planificado",
        description: "Presupuesto por sucursal y área",
      },
      {
        href: planningModulePath("/payroll/executed-cost"),
        label: "Costo ejecutado",
        description: "Impacto real del mes",
      },
      {
        href: planningModulePath("/payroll/by-employee"),
        label: "Resumen por empleado",
        description: "Detalle individual del período",
      },
    ],
  },
  {
    title: "Reportes",
    href: planningModulePath("/reports"),
    items: [
      {
        href: planningModulePath("/reports/monthly"),
        label: "Mensual",
        description: "Cierre y resultados del mes",
      },
      {
        href: planningModulePath("/reports/weekly"),
        label: "Semanal",
        description: "Seguimiento periódico",
      },
      {
        href: planningModulePath("/reports/employees"),
        label: "Por empleado",
        description: "Trazabilidad individual",
      },
      {
        href: planningModulePath("/reports/branches"),
        label: "Por sucursal",
        description: "Comparativo entre sedes",
      },
      {
        href: planningModulePath("/reports/organization"),
        label: "Por área y rol",
        description: "Vista organizativa",
      },
      {
        href: planningModulePath("/reports/plan-vs-real"),
        label: "Planificado vs real",
        description: "Brechas y cumplimiento",
      },
    ],
  },
  {
    title: "Configuracion operativa",
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
