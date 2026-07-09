"use client";

import { KeyRound, Plus } from "lucide-react";

import SelectInput from "@/components/ui/SelectInput";
import styles from "@/modules/company/submodules/access/styles/components/UserForm.module.scss";

export default function UserForm({
  form,
  employees,
  userTypes,
  assignedEmployeeIds,
  isEditing,
  isSaving,
  canSubmit,
  onCancel,
  onFieldChange,
  onSubmit,
}) {
  return (
    <form onSubmit={onSubmit} className={`catalog-form-grid ${styles.formGrid}`}>
      <div className="catalog-field">
        <SelectInput
          label="Empleado vinculado"
          value={form.employeeId}
          onChange={(event) => onFieldChange("employeeId", event.target.value)}
          disabled={isEditing}
          className={styles.selectField}
          labelClassName="catalog-label"
          controlClassName={styles.selectControl}
        >
          <option value="">Sin empleado vinculado</option>
          {employees.map((employee) => {
            const isAssigned = assignedEmployeeIds.has(employee.id) && employee.id !== form.employeeId;

            return (
              <option key={employee.id} value={employee.id} disabled={isAssigned || employee.isActive === false}>
                {employee.fullName}
                {employee.dni ? ` · ${employee.dni}` : ""}
                {isAssigned ? " · ya tiene usuario" : ""}
              </option>
            );
          })}
        </SelectInput>
      </div>

      <label className="catalog-field">
        <span className="catalog-label">Usuario</span>
        <input
          value={form.username}
          onChange={(event) => onFieldChange("username", event.target.value)}
          className="catalog-input"
          placeholder="usuario de acceso"
          required
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Email de acceso opcional</span>
        <input
          type="email"
          value={form.email}
          onChange={(event) => onFieldChange("email", event.target.value)}
          className="catalog-input"
          placeholder="correo@dominio.com"
        />
      </label>

      <div className="catalog-field">
        <SelectInput
          label="Rol de acceso"
          value={form.accessRole}
          onChange={(event) => onFieldChange("accessRole", event.target.value)}
          className={styles.selectField}
          labelClassName="catalog-label"
          controlClassName={styles.selectControl}
        >
          {userTypes.map((role) => (
            <option key={role.code} value={role.code}>
              {role.name}
            </option>
          ))}
        </SelectInput>
      </div>

      <label className="catalog-field">
        <span className="catalog-label">{isEditing ? "Nueva clave" : "Clave temporal"}</span>
        <input
          type="password"
          value={form.password}
          onChange={(event) => onFieldChange("password", event.target.value)}
          className="catalog-input"
          placeholder={isEditing ? "Dejar en blanco para conservar" : "Mínimo 6 caracteres"}
          required={!isEditing}
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
          {isEditing ? <KeyRound size={16} /> : <Plus size={16} />}
          {isSaving ? "Guardando..." : isEditing ? "Actualizar" : "Crear usuario"}
        </button>
      </div>
    </form>
  );
}
