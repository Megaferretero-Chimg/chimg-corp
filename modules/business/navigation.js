import { businessModulePath } from "@/modules/business/routes";

export const BUSINESS_MODULE_NAVIGATION = [
  {
    title: "Inicio",
    href: businessModulePath("/home"),
    items: [
      {
        href: businessModulePath("/home"),
        label: "Resumen general",
        description: "Vista del módulo de negocio",
        permission: "business.home.view",
      },
    ],
  },
  {
    title: "Inventario",
    href: businessModulePath("/inventory"),
    items: [
      {
        href: businessModulePath("/inventory"),
        label: "Productos y existencias",
        description: "Catálogo y carga desde Excel",
        permission: "business.inventory.view",
      },
      {
        href: businessModulePath("/warehouses"),
        label: "Bodegas",
        description: "Administración de ubicaciones de stock",
        permission: "business.warehouses.view",
      },
      {
        href: businessModulePath("/customers"),
        label: "Clientes",
        description: "Catálogo empresarial para las cajas",
        permission: "business.inventory.view",
      },
    ],
  },
  {
    title: "Contingencia",
    href: businessModulePath("/devices"),
    items: [
      {
        href: businessModulePath("/devices"),
        label: "Dispositivos",
        description: "Llaves y estado de cajas",
        permission: "business.devices.view",
      },
      {
        href: businessModulePath("/sync"),
        label: "Documentos recibidos",
        description: "Guías y clientes creados offline",
        permission: "business.syncDocuments.view",
      },
    ],
  },
];
