"use client";

import { Plus } from "lucide-react";

import SelectInput from "@/components/ui/SelectInput";
import styles from "@/modules/company/submodules/organization/styles/components/RoleForm.module.scss";

export default function RoleForm({
  areas,
  roles,
  form,
  isEditing,
  isSaving,
  canSubmit,
  onFieldChange,
  onCancel,
  onSubmit,
}) {
  return (
    <form onSubmit={onSubmit} className={`catalog-form-grid ${styles.formGrid}`}>
      <div className="catalog-field">
        <SelectInput
          label="Área"
          value={form.areaCode}
          onChange={(event) => onFieldChange("areaCode", event.target.value)}
          className={styles.selectField}
          labelClassName="catalog-label"
          controlClassName={styles.selectControl}
          required
        >
          <option value="">Selecciona un área</option>
          {areas.map((area) => (
            <option key={area.id} value={area.code}>
              {area.name}
            </option>
          ))}
        </SelectInput>
      </div>

      <label className="catalog-field">
        <span className="catalog-label">Nombre</span>
        <input
          value={form.name}
          onChange={(event) => onFieldChange("name", event.target.value)}
          className="catalog-input"
          placeholder="Ej. Jefe de ventas"
          required
        />
      </label>

      <div className="catalog-field">
        <SelectInput
          label="Supervisor directo"
          value={form.supervisorRoleCode}
          onChange={(event) => onFieldChange("supervisorRoleCode", event.target.value)}
          className={styles.selectField}
          labelClassName="catalog-label"
          controlClassName={styles.selectControl}
        >
          <option value="">Sin supervisor directo</option>
          {roles.map((role) => (
            <option key={role.id} value={role.code}>
              {role.areaName ? `${role.name} · ${role.areaName}` : role.name}
            </option>
          ))}
        </SelectInput>
      </div>

      <label className="catalog-field">
        <span className="catalog-label">Descripción</span>
        <textarea
          value={form.description}
          onChange={(event) => onFieldChange("description", event.target.value)}
          className="catalog-input"
          placeholder="Ej. Responsable de coordinar equipo, cobertura y cumplimiento operativo."
          rows={4}
        />
      </label>

      <div className="catalog-actions catalog-actions-end">
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
