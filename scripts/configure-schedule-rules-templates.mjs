import mongoose from "mongoose";

import Area from "../modules/company/models/Area.js";
import Role from "../modules/company/models/Role.js";
import BaseScheduleTemplate from "../modules/planner/models/BaseScheduleTemplate.js";
import LaborRuleConfig from "../modules/planner/models/LaborRuleConfig.js";

const ROLE_LUNCH_RULES = new Map([
  ["ADMIN|CARTER", 60],
  ["ADMIN|COMPR", 60],
  ["ADMIN|CONTA", 60],
  ["ADMIN|CONGEN", 60],
  ["ADMIN|CONTAD", 60],
  ["ADMIN|COMPU", 60],
  ["ADMIN|GERAF", 60],
  ["ADMIN|GERENT", 60],
  ["ADMIN|GERGEN", 60],
  ["ADMIN|JEFADM", 60],
  ["ADMIN|JEFTAL", 60],
  ["ADMIN|MARKET", 60],
  ["ADMIN|PAGOS", 60],
  ["ADMIN|AUXCON", 60],
  ["ADMIN|ASIADM", 60],
  ["ADMIN|RESPMC", 60],
  ["ADMIN|TESOR", 60],
  ["COM|AVSP", 90],
  ["COM|CAJERO", 90],
  ["COM|GERCOM", 90],
  ["COM|JEFSUC", 90],
  ["COM|RCARTE", 90],
  ["COM|RMARK", 90],
  ["COM|RVENTP", 90],
  ["COM|VENDED", 90],
  ["COM|VZONAL", 90],
  ["CTRL|DELPDP", 60],
  ["CTRL|DELSST", 60],
  ["OPER|BODEG", 90],
  ["OPER|BODOP", 90],
  ["OPER|CHOFER", 60],
  ["OPER|GEROPE", 90],
  ["OPER|JEFADQ", 90],
  ["OPER|JEFLOG", 90],
  ["OPER|JLOGOP", 90],
  ["OPER|RESCOM", 90],
  ["OPER|RESIMP", 90],
  ["OPER|TECBOD", 60],
]);

const ROLE_LUNCH_RULE_LIST = [
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "CARTER", roleName: "CARTERA", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "COMPR", roleName: "COMPRAS", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "CONTA", roleName: "CONTABILIDAD", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "CONGEN", roleName: "CONTADOR GENERAL", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "CONTAD", roleName: "CONTADORA", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "COMPU", roleName: "COMPRAS PUBLICAS", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "GERAF", roleName: "GERENTE ADMINISTRATIVO FINANCIERO", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "GERENT", roleName: "GERENTE", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "GERGEN", roleName: "GERENTE GENERAL", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "JEFADM", roleName: "JEFATURA", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "JEFTAL", roleName: "JEFE DE TALENTO HUMANO", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "MARKET", roleName: "MARKETING", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "PAGOS", roleName: "PAGOS", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "AUXCON", roleName: "AUXILIAR CONTABLE", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "ASIADM", roleName: "ASISTENTE ADMINISTRATIVA", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "RESPMC", roleName: "RESPONSABLE DE PROCESOS Y MC", lunchDurationMinutes: 60 },
  { areaCode: "ADMIN", areaName: "ADMINISTRATIVA FINANCIERA", roleCode: "TESOR", roleName: "TESORERO", lunchDurationMinutes: 60 },
  { areaCode: "COM", areaName: "COMERCIAL", roleCode: "AVSP", roleName: "ASISTENTES DE VENTAS SECTOR PÚBLICO", lunchDurationMinutes: 90 },
  { areaCode: "COM", areaName: "COMERCIAL", roleCode: "CAJERO", roleName: "CAJERO", lunchDurationMinutes: 90 },
  { areaCode: "COM", areaName: "COMERCIAL", roleCode: "GERCOM", roleName: "GERENTE COMERCIAL", lunchDurationMinutes: 90 },
  { areaCode: "COM", areaName: "COMERCIAL", roleCode: "JEFSUC", roleName: "JEFE DE SUCURSAL", lunchDurationMinutes: 90 },
  { areaCode: "COM", areaName: "COMERCIAL", roleCode: "RCARTE", roleName: "RESPONSABLE DE CARTERA", lunchDurationMinutes: 90 },
  { areaCode: "COM", areaName: "COMERCIAL", roleCode: "RMARK", roleName: "RESPONSABLE DE MARKETING", lunchDurationMinutes: 90 },
  { areaCode: "COM", areaName: "COMERCIAL", roleCode: "RVENTP", roleName: "RESPONSABLE VENTAS SECTOR PÚBLICO", lunchDurationMinutes: 90 },
  { areaCode: "COM", areaName: "COMERCIAL", roleCode: "VENDED", roleName: "VENDEDOR", lunchDurationMinutes: 90 },
  { areaCode: "COM", areaName: "COMERCIAL", roleCode: "VZONAL", roleName: "VENDEDORES ZONALES", lunchDurationMinutes: 90 },
  { areaCode: "CTRL", areaName: "CONTROL", roleCode: "DELPDP", roleName: "DELEGADO DE PDP", lunchDurationMinutes: 60 },
  { areaCode: "CTRL", areaName: "CONTROL", roleCode: "DELSST", roleName: "DELEGADO DE SEGURIDAD Y SALUD EN EL TRABAJO", lunchDurationMinutes: 60 },
  { areaCode: "OPER", areaName: "OPERACIONES", roleCode: "BODEG", roleName: "BODEGUERO", lunchDurationMinutes: 90 },
  { areaCode: "OPER", areaName: "OPERACIONES", roleCode: "BODOP", roleName: "BODEGUEROS", lunchDurationMinutes: 90 },
  { areaCode: "OPER", areaName: "OPERACIONES", roleCode: "CHOFER", roleName: "CHOFER", lunchDurationMinutes: 60 },
  { areaCode: "OPER", areaName: "OPERACIONES", roleCode: "GEROPE", roleName: "GERENTE DE OPERACIONES", lunchDurationMinutes: 90 },
  { areaCode: "OPER", areaName: "OPERACIONES", roleCode: "JEFADQ", roleName: "JEFE DE ADQUISICIONES", lunchDurationMinutes: 90 },
  { areaCode: "OPER", areaName: "OPERACIONES", roleCode: "JEFLOG", roleName: "JEFE DE LOGÍSTICA", lunchDurationMinutes: 90 },
  { areaCode: "OPER", areaName: "OPERACIONES", roleCode: "JLOGOP", roleName: "JEFE DE LOGÍSTICA", lunchDurationMinutes: 90 },
  { areaCode: "OPER", areaName: "OPERACIONES", roleCode: "RESCOM", roleName: "RESPONSABLE COMPRAS NACIONALES", lunchDurationMinutes: 90 },
  { areaCode: "OPER", areaName: "OPERACIONES", roleCode: "RESIMP", roleName: "RESPONSABLE IMPORTACIONES", lunchDurationMinutes: 90 },
  { areaCode: "OPER", areaName: "OPERACIONES", roleCode: "TECBOD", roleName: "TECNICO", lunchDurationMinutes: 60 },
];

const PAYROLL_NEUTRAL_ROLE_RULE_LIST = [
  {
    areaCode: "ADMIN",
    areaName: "ADMINISTRATIVA FINANCIERA",
    roleCode: "JEFADM",
    roleName: "JEFATURA",
    label: "Ajustado al plan por jefatura",
    scheduleAffectsSalary: false,
    appliesSupplementaryHours: false,
    appliesExtraordinaryHours: false,
  },
  {
    areaCode: "ADMIN",
    areaName: "ADMINISTRATIVA FINANCIERA",
    roleCode: "GERGEN",
    roleName: "GERENTE GENERAL",
    label: "Ajustado al plan por gerencia",
    scheduleAffectsSalary: false,
    appliesSupplementaryHours: false,
    appliesExtraordinaryHours: false,
  },
];

const ROLE_NOTES = new Map([
  ["OPER|BODEG", "OPERACIONES/BODEGUERO usa 90 minutos de almuerzo."],
  ["OPER|CHOFER", "OPERACIONES/CHOFER usa 60 minutos de almuerzo."],
  ["OPER|TECBOD", "OPERACIONES/TECNICO usa 60 minutos de almuerzo."],
]);

const ADMIN_REFERENCE_ROLE_CODES = new Set(["ASIADM", "GERGEN", "JEFADM"]);
const COMMERCIAL_STORE_ROLE_CODES = new Set(["CAJERO", "JEFSUC", "VENDED"]);

function row(dayOfWeek, dayType, startTime = "", endTime = "", lunchDurationMinutes = 0, authorizedExtraMinutes = 0) {
  const isWorkingDay = dayType === "workday" || dayType === "weekend_overtime";

  return {
    dayOfWeek,
    dayType,
    startTime: isWorkingDay ? startTime : "",
    lunchDurationMinutes: isWorkingDay ? lunchDurationMinutes : 0,
    hasLunch: isWorkingDay && lunchDurationMinutes > 0,
    endTime: isWorkingDay ? endTime : "",
    authorizedExtraMinutes: isWorkingDay ? authorizedExtraMinutes : 0,
    graceMinutes: 10,
  };
}

function weekdayRows({ startTime, endTime, lunchDurationMinutes, authorizedExtraMinutes = 60 }) {
  return [1, 2, 3, 4, 5].map((dayOfWeek) =>
    row(dayOfWeek, "workday", startTime, endTime, lunchDurationMinutes, authorizedExtraMinutes),
  );
}

function weeklyRows({ startTime, endTime, lunchDurationMinutes, saturday = false, sunday = false }) {
  return [
    ...weekdayRows({ startTime, endTime, lunchDurationMinutes }),
    saturday ? row(6, "weekend_overtime", "08:00", "14:00", 0, 360) : row(6, "off_day"),
    sunday ? row(0, "weekend_overtime", "08:00", "14:00", 0, 360) : row(0, "off_day"),
  ];
}

function baseRows({ startTime, endTime, lunchDurationMinutes, authorizedExtraMinutes = 60 }) {
  return [
    ...weekdayRows({ startTime, endTime, lunchDurationMinutes, authorizedExtraMinutes }),
    row(6, "off_day"),
    row(0, "off_day"),
  ];
}

function template({ name, area, role, rotationGroup, rows, notes }) {
  return {
    name,
    areaCode: area.code,
    areaName: area.name,
    roleCode: role.code,
    roleName: role.name,
    rotationGroup,
    weeklyRows: rows,
    notes,
    isActive: true,
  };
}

function buildTemplatesForRole(area, role) {
  const key = `${area.code}|${role.code}`;
  const lunchDurationMinutes = ROLE_LUNCH_RULES.get(key)
    ?? 60;
  const note = [
    "Lunes a viernes: 8h normales + 1h suplementaria autorizada.",
    ROLE_NOTES.get(key),
  ].filter(Boolean).join(" ");

  if (area.code === "ADMIN") {
    if (ADMIN_REFERENCE_ROLE_CODES.has(role.code)) {
      return [
        template({
          name: `ADMINISTRATIVO ${role.name} REFERENCIAL 08H00`,
          area,
          role,
          rotationGroup: "ADMIN_BASE",
          rows: baseRows({ startTime: "08:00", endTime: "18:00", lunchDurationMinutes, authorizedExtraMinutes: 0 }),
          notes: "Horario referencial de lunes a viernes. No requiere picadas y no genera horas suplementarias ni extraordinarias.",
        }),
      ];
    }

    return [
      template({
        name: `ADMINISTRATIVO ${role.name} BASE 08H00`,
        area,
        role,
        rotationGroup: "ADMIN_BASE",
        rows: baseRows({ startTime: "08:00", endTime: "18:00", lunchDurationMinutes }),
        notes: `${note} Sabado y domingo quedan como descanso opcional; si hay picadas, se calculan como extraordinarias sin almuerzo planificado.`,
      }),
    ];
  }

  if (area.code === "COM" && !COMMERCIAL_STORE_ROLE_CODES.has(role.code)) {
    return [];
  }

  if (area.code === "COM") {
    return [
      template({
        name: `COMERCIAL ${role.name} BASE SEMANA A 07H00`,
        area,
        role,
        rotationGroup: `COM_${role.code}_BASE`,
        rows: baseRows({ startTime: "07:00", endTime: "18:00", lunchDurationMinutes }),
        notes: `${note} Fin de semana libre.`,
      }),
      template({
        name: `COMERCIAL ${role.name} BASE SEMANA B 08H00`,
        area,
        role,
        rotationGroup: `COM_${role.code}_BASE`,
        rows: baseRows({ startTime: "08:00", endTime: "19:00", lunchDurationMinutes }),
        notes: `${note} Alternativa de entrada con fin de semana libre.`,
      }),
      template({
        name: `COMERCIAL ${role.name} SABADO SEMANA A 07H00`,
        area,
        role,
        rotationGroup: `COM_${role.code}_SABADO`,
        rows: weeklyRows({ startTime: "07:00", endTime: "18:00", lunchDurationMinutes, saturday: true }),
        notes: `${note} Semana A con sabado extraordinario.`,
      }),
      template({
        name: `COMERCIAL ${role.name} SABADO SEMANA B 08H00`,
        area,
        role,
        rotationGroup: `COM_${role.code}_SABADO`,
        rows: weeklyRows({ startTime: "08:00", endTime: "19:00", lunchDurationMinutes, saturday: true }),
        notes: `${note} Semana B con sabado extraordinario.`,
      }),
      template({
        name: `COMERCIAL ${role.name} DOMINGO SEMANA A 07H00`,
        area,
        role,
        rotationGroup: `COM_${role.code}_DOMINGO`,
        rows: weeklyRows({ startTime: "07:00", endTime: "18:00", lunchDurationMinutes, sunday: true }),
        notes: `${note} Semana A con domingo extraordinario y sabado libre.`,
      }),
      template({
        name: `COMERCIAL ${role.name} DOMINGO SEMANA B 08H00`,
        area,
        role,
        rotationGroup: `COM_${role.code}_DOMINGO`,
        rows: weeklyRows({ startTime: "08:00", endTime: "19:00", lunchDurationMinutes, sunday: true }),
        notes: `${note} Semana B con domingo extraordinario y sabado libre.`,
      }),
      template({
        name: `COMERCIAL ${role.name} SABADO DOMINGO SEMANA A 07H00`,
        area,
        role,
        rotationGroup: `COM_${role.code}_FIN_SEMANA_COMPLETO`,
        rows: weeklyRows({ startTime: "07:00", endTime: "18:00", lunchDurationMinutes, saturday: true, sunday: true }),
        notes: `${note} Caso excepcional con sabado y domingo extraordinarios.`,
      }),
      template({
        name: `COMERCIAL ${role.name} SABADO DOMINGO SEMANA B 08H00`,
        area,
        role,
        rotationGroup: `COM_${role.code}_FIN_SEMANA_COMPLETO`,
        rows: weeklyRows({ startTime: "08:00", endTime: "19:00", lunchDurationMinutes, saturday: true, sunday: true }),
        notes: `${note} Caso excepcional alterno con sabado y domingo extraordinarios.`,
      }),
    ];
  }

  if (area.code === "OPER" && role.code === "BODEG") {
    return [
      template({
        name: "BODEGA BODEGUERO BASE SEMANA A 07H00",
        area,
        role,
        rotationGroup: "OPER_BODEG_BASE",
        rows: baseRows({ startTime: "07:00", endTime: "18:00", lunchDurationMinutes }),
        notes: `${note} Fin de semana libre.`,
      }),
      template({
        name: "BODEGA BODEGUERO BASE SEMANA B 08H00",
        area,
        role,
        rotationGroup: "OPER_BODEG_BASE",
        rows: baseRows({ startTime: "08:00", endTime: "19:00", lunchDurationMinutes }),
        notes: `${note} Alternativa de entrada con fin de semana libre.`,
      }),
      template({
        name: "BODEGA BODEGUERO SABADO SEMANA A 07H00",
        area,
        role,
        rotationGroup: "OPER_BODEG_SABADO",
        rows: weeklyRows({ startTime: "07:00", endTime: "18:00", lunchDurationMinutes, saturday: true }),
        notes: `${note} Semana A con sabado extraordinario.`,
      }),
      template({
        name: "BODEGA BODEGUERO SABADO SEMANA B 08H00",
        area,
        role,
        rotationGroup: "OPER_BODEG_SABADO",
        rows: weeklyRows({ startTime: "08:00", endTime: "19:00", lunchDurationMinutes, saturday: true }),
        notes: `${note} Semana B con sabado extraordinario.`,
      }),
      template({
        name: "BODEGA BODEGUERO DOMINGO SEMANA A 07H00",
        area,
        role,
        rotationGroup: "OPER_BODEG_DOMINGO",
        rows: weeklyRows({ startTime: "07:00", endTime: "18:00", lunchDurationMinutes, sunday: true }),
        notes: `${note} Semana A con domingo extraordinario y sabado libre.`,
      }),
      template({
        name: "BODEGA BODEGUERO DOMINGO SEMANA B 08H00",
        area,
        role,
        rotationGroup: "OPER_BODEG_DOMINGO",
        rows: weeklyRows({ startTime: "08:00", endTime: "19:00", lunchDurationMinutes, sunday: true }),
        notes: `${note} Semana B con domingo extraordinario y sabado libre.`,
      }),
      template({
        name: "BODEGA BODEGUERO SABADO DOMINGO SEMANA A 07H00",
        area,
        role,
        rotationGroup: "OPER_BODEG_FIN_SEMANA_COMPLETO",
        rows: weeklyRows({ startTime: "07:00", endTime: "18:00", lunchDurationMinutes, saturday: true, sunday: true }),
        notes: `${note} Caso excepcional con sabado y domingo extraordinarios.`,
      }),
      template({
        name: "BODEGA BODEGUERO SABADO DOMINGO SEMANA B 08H00",
        area,
        role,
        rotationGroup: "OPER_BODEG_FIN_SEMANA_COMPLETO",
        rows: weeklyRows({ startTime: "08:00", endTime: "19:00", lunchDurationMinutes, saturday: true, sunday: true }),
        notes: `${note} Caso excepcional alterno con sabado y domingo extraordinarios.`,
      }),
    ];
  }

  if (area.code === "OPER") {
    return [
      template({
        name: `BODEGA ${role.name} BASE SEMANA A 07H00`,
        area,
        role,
        rotationGroup: `OPER_${role.code}_BASE`,
        rows: baseRows({ startTime: "07:00", endTime: "17:00", lunchDurationMinutes }),
        notes: `${note} Fin de semana libre; se asigna solo si la operacion lo requiere.`,
      }),
      template({
        name: `BODEGA ${role.name} BASE SEMANA B 08H00`,
        area,
        role,
        rotationGroup: `OPER_${role.code}_BASE`,
        rows: baseRows({ startTime: "08:00", endTime: "18:00", lunchDurationMinutes }),
        notes: `${note} Alternativa de entrada para escalonar cobertura.`,
      }),
      template({
        name: `BODEGA ${role.name} SABADO SEMANA A 07H00`,
        area,
        role,
        rotationGroup: `OPER_${role.code}_SABADO`,
        rows: weeklyRows({ startTime: "07:00", endTime: "17:00", lunchDurationMinutes, saturday: true }),
        notes: `${note} Semana A con sabado extraordinario.`,
      }),
      template({
        name: `BODEGA ${role.name} SABADO SEMANA B 08H00`,
        area,
        role,
        rotationGroup: `OPER_${role.code}_SABADO`,
        rows: weeklyRows({ startTime: "08:00", endTime: "18:00", lunchDurationMinutes, saturday: true }),
        notes: `${note} Semana B con sabado extraordinario.`,
      }),
      template({
        name: `BODEGA ${role.name} DOMINGO SEMANA A 07H00`,
        area,
        role,
        rotationGroup: `OPER_${role.code}_DOMINGO`,
        rows: weeklyRows({ startTime: "07:00", endTime: "17:00", lunchDurationMinutes, sunday: true }),
        notes: `${note} Semana A con domingo extraordinario y sabado libre.`,
      }),
      template({
        name: `BODEGA ${role.name} DOMINGO SEMANA B 08H00`,
        area,
        role,
        rotationGroup: `OPER_${role.code}_DOMINGO`,
        rows: weeklyRows({ startTime: "08:00", endTime: "18:00", lunchDurationMinutes, sunday: true }),
        notes: `${note} Semana B con domingo extraordinario y sabado libre.`,
      }),
      template({
        name: `BODEGA ${role.name} SABADO DOMINGO SEMANA A 07H00`,
        area,
        role,
        rotationGroup: `OPER_${role.code}_FIN_SEMANA_COMPLETO`,
        rows: weeklyRows({ startTime: "07:00", endTime: "17:00", lunchDurationMinutes, saturday: true, sunday: true }),
        notes: `${note} Caso excepcional con sabado y domingo extraordinarios.`,
      }),
      template({
        name: `BODEGA ${role.name} SABADO DOMINGO SEMANA B 08H00`,
        area,
        role,
        rotationGroup: `OPER_${role.code}_FIN_SEMANA_COMPLETO`,
        rows: weeklyRows({ startTime: "08:00", endTime: "18:00", lunchDurationMinutes, saturday: true, sunday: true }),
        notes: `${note} Caso excepcional alterno con sabado y domingo extraordinarios.`,
      }),
    ];
  }

  return [];
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI no esta definido.");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  await LaborRuleConfig.findOneAndUpdate(
    { key: "default" },
    {
      $set: {
        key: "default",
        companyStartTime: "07:00",
        companyEndTime: "19:00",
        dailyBaseHours: 8,
        weeklyBaseHours: 40,
        defaultGraceMinutes: 10,
        maxSupplementaryMinutesPerDay: 60,
        maxSupplementaryMinutesPerWeek: 300,
        maxExtraordinaryDaysPerMonth: 5,
        supplementaryMultiplier: 1.5,
        extraordinaryMultiplier: 2,
        paidVacationAsWorkday: true,
        vacationIncludesSupplementaryHour: false,
        roleLunchRules: ROLE_LUNCH_RULE_LIST,
        payrollNeutralRoleRules: PAYROLL_NEUTRAL_ROLE_RULE_LIST,
        notes: "Defaults operativos: 8h normales + 1h suplementaria autorizada de lunes a viernes. Sabados, domingos y feriados trabajados se tratan como extraordinarios. OPERACIONES/CHOFER y OPERACIONES/TECNICO usan 60 min de almuerzo.",
      },
    },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  const [areas, roles] = await Promise.all([
    Area.find({ code: { $in: ["ADMIN", "COM", "OPER"] } }).lean(),
    Role.find({ areaCode: { $in: ["ADMIN", "COM", "OPER"] } }).lean(),
  ]);
  const areasByCode = new Map(areas.map((area) => [area.code, area]));
  const rolesByArea = roles.reduce((map, role) => {
    if (!map.has(role.areaCode)) {
      map.set(role.areaCode, []);
    }

    map.get(role.areaCode).push(role);
    return map;
  }, new Map());
  const templates = [];

  for (const areaCode of ["ADMIN", "COM", "OPER"]) {
    const area = areasByCode.get(areaCode);

    if (!area) {
      continue;
    }

    for (const role of rolesByArea.get(areaCode) || []) {
      templates.push(...buildTemplatesForRole(area, role));
    }
  }

  const keepKeys = new Set(templates.map((item) => `${item.areaCode}|${item.roleCode}|${item.name}`));

  await BaseScheduleTemplate.updateMany(
    {},
    { $set: { isActive: false } },
  );

  for (const item of templates) {
    await BaseScheduleTemplate.findOneAndUpdate(
      { areaCode: item.areaCode, roleCode: item.roleCode, name: item.name },
      { $set: item },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  }

  const staleTemplates = await BaseScheduleTemplate.find({
    areaCode: { $in: ["ADMIN", "COM", "OPER"] },
    isActive: false,
  }).lean();

  console.log(JSON.stringify({
    rules: "updated",
    templatesUpserted: templates.length,
    activeTemplateKeys: keepKeys.size,
    inactiveTemplates: staleTemplates.length,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
