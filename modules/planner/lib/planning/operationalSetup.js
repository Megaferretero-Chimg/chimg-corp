import { Area } from "@/modules/company/models";
import { Role } from "@/modules/company/models";
import { BaseScheduleTemplate } from "@/modules/planner/models";

export const OPERATIONAL_AREAS = [
  {
    code: "ADMIN",
    name: "ADMINISTRATIVO",
    description: "Contabilidad, cartera, compras, marketing, compras publicas y pagos.",
  },
  {
    code: "COM",
    name: "COMERCIAL",
    description: "Atencion comercial, caja, ventas de tienda y cobertura de sucursales.",
  },
  {
    code: "OPER",
    name: "OPERACIONES",
    description: "Operaciones de bodega, despacho, transporte, tecnicos y jefatura logistica.",
  },
];

export const OPERATIONAL_ROLES = [
  { code: "CARTER", name: "CARTERA", areaCode: "ADMIN", description: "Gestion de cartera y cobros." },
  { code: "COMPR", name: "COMPRAS", areaCode: "ADMIN", description: "Gestion de compras comerciales." },
  { code: "CONTA", name: "CONTABILIDAD", areaCode: "ADMIN", description: "Contabilidad y control administrativo." },
  { code: "CONTAD", name: "CONTADORA", areaCode: "ADMIN", description: "Responsable contable." },
  { code: "COMPU", name: "COMPRAS PUBLICAS", areaCode: "ADMIN", description: "Procesos de compras publicas." },
  { code: "GERGEN", name: "GERENTE GENERAL", areaCode: "ADMIN", description: "Gerencia general sin horas suplementarias ni extraordinarias." },
  { code: "GERENT", name: "GERENTE", areaCode: "ADMIN", description: "Gerencia administrativa." },
  { code: "JEFADM", name: "JEFATURA ADMINISTRATIVA", areaCode: "ADMIN", description: "Jefatura administrativa." },
  { code: "MARKET", name: "MARKETING", areaCode: "ADMIN", description: "Marketing y comunicacion." },
  { code: "PAGOS", name: "PAGOS", areaCode: "ADMIN", description: "Pagos y tesoreria operativa." },
  { code: "CAJERO", name: "CAJERO", areaCode: "COM", description: "Caja y facturacion comercial." },
  { code: "JEFSUC", name: "JEFE DE SUCURSAL", areaCode: "COM", description: "Jefatura comercial de sucursal." },
  { code: "VENDED", name: "VENDEDOR", areaCode: "COM", description: "Atencion y venta comercial." },
  { code: "BODEG", name: "BODEGUERO", areaCode: "OPER", description: "Operacion de bodega y despacho." },
  { code: "CHOFER", name: "CHOFER", areaCode: "OPER", description: "Transporte y entregas de bodega." },
  { code: "JEFLOG", name: "JEFATURA LOGISTICA", areaCode: "OPER", description: "Jefatura de logistica y bodega." },
  { code: "TECBOD", name: "TECNICO", areaCode: "OPER", description: "Tecnico asignado a bodega." },
];

function workdayTemplate({
  name,
  startTime,
  lunchStartTime = "13:00",
  lunchEndTime = "14:00",
  endTime,
}) {
  const [lunchStartHours, lunchStartMinutes] = lunchStartTime.split(":").map(Number);
  const [lunchEndHours, lunchEndMinutes] = lunchEndTime.split(":").map(Number);
  const lunchDurationMinutes = Math.max(
    0,
    lunchEndHours * 60 + lunchEndMinutes - (lunchStartHours * 60 + lunchStartMinutes),
  );

  return {
    name,
    areaCode: "",
    areaName: "",
    roleCode: "",
    rotationGroup: "",
    weeklyRows: [
      {
        dayOfWeek: 1,
        label: "Horario",
        dayType: "workday",
        startTime,
        lunchDurationMinutes,
        lunchStartTime,
        lunchEndTime,
        hasLunch: true,
        endTime,
        authorizedExtraMinutes: 0,
        graceMinutes: 10,
      },
    ],
    notes: "Plantilla base cargada desde configuracion operativa.",
    isActive: true,
  };
}

export const OPERATIONAL_TEMPLATES = [
  workdayTemplate({
    name: "08H00 A 13H00 14H00 A 17H00",
    startTime: "08:00",
    endTime: "17:00",
  }),
  workdayTemplate({
    name: "09H00 A 13H00 14H30 A 19H00",
    startTime: "09:00",
    lunchEndTime: "14:30",
    endTime: "19:00",
  }),
  workdayTemplate({
    name: "08H00 A 13H00 14H00 A 18H00",
    startTime: "08:00",
    endTime: "18:00",
  }),
];

export async function seedOperationalSetup() {
  const areaResults = await Promise.all(
    OPERATIONAL_AREAS.map((area) =>
      Area.findOneAndUpdate(
        { code: area.code },
        { $set: { ...area, isActive: true } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ),
    ),
  );
  const areasByCode = new Map(areaResults.map((area) => [area.code, area]));

  const roleResults = await Promise.all(
    OPERATIONAL_ROLES.map((role) => {
      const area = areasByCode.get(role.areaCode);

      return Role.findOneAndUpdate(
        { code: role.code },
        { $set: { ...role, areaName: area?.name || role.areaCode, isActive: true } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
    }),
  );
  const templateResults = await Promise.all(
    OPERATIONAL_TEMPLATES.map((template) => {
      return BaseScheduleTemplate.findOneAndUpdate(
        {
          name: template.name,
        },
        {
          $set: {
            ...template,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
    }),
  );

  return {
    areas: areaResults.length,
    roles: roleResults.length,
    templates: templateResults.length,
  };
}
