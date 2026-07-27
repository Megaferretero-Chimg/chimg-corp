"use client";

import Link from "next/link";
import { Edit3, ReceiptText, UserCheck, UserMinus } from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import { planningModulePath } from "@/modules/planner/routes";
import styles from "@/modules/company/submodules/people/styles/components/employees/EmployeeDetailModal.module.scss";

const DOCUMENT_TYPE_LABELS = {
  cedula: "Cedula",
  pasaporte: "Pasaporte",
};

const EMPLOYMENT_RELATION_LABELS = {
  nomina: "Nomina",
  prestacion_servicios: "Prestacion de servicios",
};

function formatValue(value) {
  return value || "Pendiente";
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatSupervisor(supervisor = {}) {
  if (supervisor.fullName && supervisor.roleName) {
    return `${supervisor.fullName} · ${supervisor.roleName}`;
  }

  return supervisor.fullName || supervisor.roleName || "";
}

function DetailSection({ title, items }) {
  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>{title}</h4>
      <dl className={styles.detailList}>
        {items.map(([label, value]) => (
          <div key={label} className={styles.detailItem}>
            <dt>{label}</dt>
            <dd>{formatValue(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function EmployeeDetailModal({ employee, onClose, onEdit, onDelete, onReactivate }) {
  const documentType = ["cedula", "pasaporte"].includes(employee?.documentType) ? employee.documentType : "cedula";
  const identityDetails = [
    ["Documento de identidad", DOCUMENT_TYPE_LABELS[documentType] || documentType],
    ["DNI", employee?.dni],
    ["Email personal", employee?.personalEmail],
    ["Numero de contacto", employee?.phone],
    ["Direccion", employee?.address],
  ];
  const biometricCodes = [
    employee?.biometricCode
      ? `${employee.branchName || employee.branchCode || "Sucursal principal"}: ${employee.biometricCode}`
      : "",
    ...(employee?.biometricAliases || []).map((alias) =>
      `${alias.branchName || alias.branchCode}: ${alias.biometricCode}`,
    ),
  ].filter(Boolean);
  const baseWorkDetails = [
    ["Relacion", EMPLOYMENT_RELATION_LABELS[employee?.employmentRelation] || "Nomina"],
    ["Sucursal", employee?.branchName || employee?.branch],
    ["Cargo principal", employee?.roleName],
    ["Supervisor directo", formatSupervisor(employee?.directSupervisor)],
    ["Funciones habilitadas", (employee?.roleAssignments || []).map((role) => role.name).join(", ")],
    ["Area", employee?.areaName],
    ["Sueldo", formatMoney(employee?.salary)],
    ["Códigos biométricos", biometricCodes.join(", ")],
    ["Fecha de ingreso", employee?.employmentStartDate],
  ];
  const workDetails = employee?.isActive === false
    ? [...baseWorkDetails, ["Fecha de salida", employee?.terminationDate], ["Fecha de nacimiento", employee?.birthDate]]
    : [...baseWorkDetails, ["Fecha de nacimiento", employee?.birthDate]];

  return (
    <CatalogDrawer
      isOpen={Boolean(employee)}
      eyebrow="Ficha del empleado"
      title={employee?.fullName || "Detalle del empleado"}
      onClose={onClose}
    >
      <div className={styles.card}>
        <div className={styles.summary}>
          <span className={`${styles.statusPill} ${employee?.isActive ? styles.active : styles.inactive}`}>
            {employee?.isActive ? "Activo" : "Inactivo"}
          </span>
          <p>{employee?.organizationLabel || "Estructura pendiente"}</p>
        </div>

        <DetailSection title="Datos personales" items={identityDetails} />
        <DetailSection title="Datos laborales" items={workDetails} />

        {employee ? (
          <div className={`catalog-actions catalog-actions-end ${styles.actions}`}>
            <Link
              href={`${planningModulePath("/payroll")}?employeeId=${employee.id}&employeeName=${encodeURIComponent(employee.fullName)}&mode=month`}
              className="catalog-button-ghost"
            >
              <ReceiptText size={16} />
              Ver nómina
            </Link>
            {employee.isActive !== false ? (
              <button type="button" className="catalog-button-ghost" onClick={() => onDelete(employee)}>
                <UserMinus size={16} />
                Despedir
              </button>
            ) : (
              <button type="button" className="catalog-button-ghost" onClick={() => onReactivate(employee)}>
                <UserCheck size={16} />
                Anular baja
              </button>
            )}
            <button type="button" className="catalog-button-primary" onClick={() => onEdit(employee)}>
              <Edit3 size={16} />
              Editar
            </button>
          </div>
        ) : null}
      </div>
    </CatalogDrawer>
  );
}
