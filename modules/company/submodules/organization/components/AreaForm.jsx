"use client";

import { Plus } from "lucide-react";

import styles from "@/modules/company/submodules/organization/styles/components/AreaForm.module.scss";

export default function AreaForm({
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
      <label className="catalog-field">
        <span className="catalog-label">Nombre</span>
        <input
          value={form.name}
          onChange={(event) => onFieldChange("name", event.target.value)}
          className="catalog-input"
          placeholder="Ej. Administrativa"
          required
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Descripción</span>
        <textarea
          value={form.description}
          onChange={(event) => onFieldChange("description", event.target.value)}
          className="catalog-input"
          placeholder="Ej. Área transversal para procesos internos y apoyo a la operación."
          rows={4}
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
          <span>{form.isActive ? "Activa" : "Inactiva"}</span>
        </button>
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
