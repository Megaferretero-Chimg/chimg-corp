import { companyModulePath } from "@/modules/company/routes";

export const COMPANY_MODULE_NAVIGATION = [
  {
    title: "Inicio",
    href: companyModulePath("/home"),
    items: [
      {
        href: companyModulePath("/home"),
        label: "Resumen general",
        description: "Vista del módulo global",
        permission: "company.home.view",
      },
    ],
  },
  {
    title: "Estructura empresarial",
    href: companyModulePath("/organization"),
    items: [
      {
        href: companyModulePath("/areas"),
        label: "Áreas",
        description: "Unidades funcionales de la empresa",
        permission: "company.areas.view",
      },
      {
        href: companyModulePath("/roles"),
        label: "Cargos",
        description: "Responsabilidades y funciones",
        permission: "company.roles.view",
      },
      {
        href: companyModulePath("/branches"),
        label: "Sucursales",
        description: "Sedes y contexto operativo",
        permission: "company.branches.view",
      },
      {
        href: companyModulePath("/employees"),
        label: "Empleados",
        description: "Personas asignadas a la estructura",
        permission: "company.employees.view",
      },
      {
        href: companyModulePath("/structure"),
        label: "Organigrama",
        description: "Jerarquías y responsables",
        permission: "company.structure.view",
      },
    ],
  },
  {
    title: "Acceso",
    href: companyModulePath("/access"),
    items: [
      {
        href: companyModulePath("/users"),
        label: "Usuarios",
        description: "Cuentas de acceso a la plataforma",
        permission: "company.users.view",
      },
      {
        href: companyModulePath("/permissions"),
        label: "Perfiles de acceso",
        description: "Permisos disponibles para usuarios",
        permission: "company.accessRoles.view",
      },
    ],
  },
];
