"use client";

import { Plus } from "lucide-react";

import styles from "./EmployeeForm.module.scss";

const DOCUMENT_TYPES = [
  { value: "cedula", label: "Cedula" },
  { value: "pasaporte", label: "Pasaporte" },
  { value: "ruc", label: "RUC" },
];

const EMPLOYMENT_RELATIONS = [
  { value: "nomina", label: "Nomina" },
  { value: "prestacion_servicios", label: "Prestacion de servicios" },
];

export default function EmployeeForm({
  form,
  branches,
  roles,
  areaOptions,
  isEditing,
  isSaving,
  canSubmit,
  onCancel,
  onFieldChange,
  onBranchChange,
  onAreaChange,
  onRoleChange,
  onSubmit,
}) {
  const selectedRole = roles.find((role) => role.code === form.roleCode) || null;
  const filteredRoles = roles.filter((role) => role.areaCode === form.areaCode);
  const operationalSubroles = (selectedRole?.subroles || []).filter((subrole) => subrole.isActive !== false);
  const selectedOperationalCodes = new Set((form.roleAssignments || []).map((role) => role.code));

  function toggleOperationalSubrole(subrole) {
    const currentCodes = (form.roleAssignments || []).map((assignment) => assignment.code);
    const nextCodes = selectedOperationalCodes.has(subrole.code)
      ? currentCodes.filter((code) => code !== subrole.code)
      : [...currentCodes, subrole.code];

    onRoleChange(form.roleCode, nextCodes);
  }

  return (
    <form onSubmit={onSubmit} className={`catalog-form-grid ${styles.formGrid}`}>
      <label className="catalog-field">
        <span className="catalog-label">Documento de identidad</span>
        <select
          value={form.documentType}
          onChange={(event) => onFieldChange("documentType", event.target.value)}
          className="catalog-select"
        >
          {DOCUMENT_TYPES.map((documentType) => (
            <option key={documentType.value} value={documentType.value}>
              {documentType.label}
            </option>
          ))}
        </select>
      </label>

      <label className="catalog-field">
        <span className="catalog-label">DNI</span>
        <input
          value={form.dni}
          onChange={(event) => onFieldChange("dni", event.target.value)}
          className="catalog-input"
          placeholder="Numero de documento"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Nombre completo</span>
        <input
          value={form.fullName}
          onChange={(event) => onFieldChange("fullName", event.target.value)}
          className="catalog-input"
          placeholder="Ej. Maria Fernanda Perez"
          required
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Email personal</span>
        <input
          type="email"
          value={form.personalEmail}
          onChange={(event) => onFieldChange("personalEmail", event.target.value)}
          className="catalog-input"
          placeholder="correo@dominio.com"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Direccion</span>
        <input
          value={form.address}
          onChange={(event) => onFieldChange("address", event.target.value)}
          className="catalog-input"
          placeholder="Direccion domiciliaria"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Numero de contacto</span>
        <input
          value={form.phone}
          onChange={(event) => onFieldChange("phone", event.target.value)}
          className="catalog-input"
          placeholder="Telefono o celular"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Relacion de dependencia</span>
        <select
          value={form.employmentRelation}
          onChange={(event) => onFieldChange("employmentRelation", event.target.value)}
          className="catalog-select"
        >
          {EMPLOYMENT_RELATIONS.map((relation) => (
            <option key={relation.value} value={relation.value}>
              {relation.label}
            </option>
          ))}
        </select>
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Sucursal</span>
        <select
          value={form.branchId}
          onChange={(event) => onBranchChange(event.target.value)}
          className="catalog-select"
        >
          <option value="">Selecciona una sucursal</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Área</span>
        <select
          value={form.areaCode}
          onChange={(event) => onAreaChange(event.target.value)}
          className="catalog-select"
        >
          <option value="">Selecciona un área</option>
          {areaOptions.map((area) => (
            <option key={area.code} value={area.code}>
              {area.name}
            </option>
          ))}
        </select>
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Rol principal</span>
        <select
          value={form.roleCode}
          onChange={(event) => onRoleChange(event.target.value, [])}
          className="catalog-select"
          disabled={!form.areaCode}
        >
          <option value="">{form.areaCode ? "Selecciona un rol" : "Selecciona un área primero"}</option>
          {filteredRoles.map((role) => (
            <option key={role.id} value={role.code}>
              {role.name}
            </option>
          ))}
        </select>
      </label>

      {operationalSubroles.length ? (
        <div className="catalog-field">
          <span className="catalog-label">Coberturas operativas</span>
          <div className={styles.rolePicker}>
            {operationalSubroles.map((subrole) => {
              const isSelected = selectedOperationalCodes.has(subrole.code);

              return (
                <button
                  key={subrole.code}
                  type="button"
                  className={`${styles.roleOption} ${isSelected ? styles.roleOptionSelected : ""}`}
                  onClick={() => toggleOperationalSubrole(subrole)}
                  aria-pressed={isSelected}
                >
                  <span>{subrole.name}</span>
                  <small>{selectedRole.name}</small>
                </button>
              );
            })}
          </div>
          {form.roleAssignments?.length ? (
            <span className={styles.roleHint}>Estas coberturas se usan para planificación semanal. El rol principal se mantiene como {selectedRole.name}.</span>
          ) : (
            <span className={styles.roleHint}>Selecciona las coberturas que esta persona puede ejercer en planificación.</span>
          )}
        </div>
      ) : null}

      <label className="catalog-field">
        <span className="catalog-label">Sueldo</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={form.salary}
          onChange={(event) => onFieldChange("salary", event.target.value)}
          className="catalog-input"
          placeholder="0.00"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Fecha de nacimiento</span>
        <input
          type="date"
          value={form.birthDate}
          onChange={(event) => onFieldChange("birthDate", event.target.value)}
          className="catalog-input"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Biometrico</span>
        <input
          value={form.biometricCode}
          onChange={(event) => onFieldChange("biometricCode", event.target.value)}
          className="catalog-input"
          placeholder="Codigo del biometrico"
        />
      </label>

      <label className={`catalog-field ${styles.statusField}`}>
        <span className="catalog-label">Estado</span>
        <button
          type="button"
          className={`catalog-switch ${form.isActive ? "is-active" : ""}`}
          onClick={() => onFieldChange("isActive", !form.isActive)}
          aria-pressed={form.isActive}
        >
          <span className="catalog-switchKnob" />
          <span>{form.isActive ? "Activo" : "Inactivo"}</span>
        </button>
      </label>

      <div className={`catalog-actions catalog-actions-end ${styles.actions}`}>
        <button type="button" onClick={onCancel} disabled={isSaving} className="catalog-button-ghost">
          Cancelar
        </button>
        <button type="submit" disabled={isSaving || !canSubmit} className="catalog-button-primary">
          <Plus size={16} />
          {isSaving ? "Guardando..." : isEditing ? "Actualizar" : "Crear"}
        </button>
      </div>
    </form>
  );
}
