"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, KeyRound, Plus } from "lucide-react";

import AutocompleteSelect from "@/components/ui/AutocompleteSelect";
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
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const employeeOptions = useMemo(() => employees
    .filter((employee) => {
      const isCurrentEmployee = employee.id === form.employeeId;
      const isAssignedToAnotherUser = assignedEmployeeIds.has(employee.id) && !isCurrentEmployee;

      return isCurrentEmployee || (!isAssignedToAnotherUser && employee.isActive !== false);
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName, "es"))
    .map((employee) => ({
      value: employee.id,
      label: employee.fullName,
    })), [assignedEmployeeIds, employees, form.employeeId]);

  return (
    <form onSubmit={onSubmit} className={`catalog-form-grid ${styles.formGrid}`}>
      <div className="catalog-field">
        <AutocompleteSelect
          label="Empleado vinculado"
          value={form.employeeId}
          options={employeeOptions}
          onChange={(value) => onFieldChange("employeeId", value)}
          disabled={isEditing}
          className={styles.selectField}
          controlClassName={styles.selectControl}
          placeholder="Sin empleado vinculado"
          searchPlaceholder="Escribe el nombre del empleado"
          emptyText="No encontramos empleados disponibles"
        />
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

      <div className="catalog-field">
        <label htmlFor="user-password" className="catalog-label">
          {isEditing ? "Nueva clave" : "Clave temporal"}
        </label>
        <div className={styles.passwordControl}>
          <input
            id="user-password"
            type={isPasswordVisible ? "text" : "password"}
            value={form.password}
            onChange={(event) => onFieldChange("password", event.target.value)}
            className={`catalog-input ${styles.passwordInput}`}
            placeholder={isEditing ? "Dejar en blanco para conservar" : "Mínimo 6 caracteres"}
            autoComplete="new-password"
            required={!isEditing}
          />
          <button
            type="button"
            className={styles.visibilityToggle}
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            aria-label={isPasswordVisible ? "Ocultar clave" : "Mostrar clave"}
            aria-pressed={isPasswordVisible}
          >
            {isPasswordVisible
              ? <EyeOff size={18} aria-hidden="true" />
              : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>

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
