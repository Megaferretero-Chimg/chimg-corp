"use client";

import { Plus, Trash2 } from "lucide-react";

import styles from "./RoleForm.module.scss";

export default function RoleForm({
  areas,
  form,
  isEditing,
  isSaving,
  canSubmit,
  onFieldChange,
  onCancel,
  onSubmit,
}) {
  const subroles = Array.isArray(form.subroles) ? form.subroles : [];

  function updateSubrole(index, field, value) {
    onFieldChange(
      "subroles",
      subroles.map((subrole, currentIndex) =>
        currentIndex === index ? { ...subrole, [field]: value } : subrole,
      ),
    );
  }

  function addSubrole() {
    onFieldChange("subroles", [
      ...subroles,
      { code: "", name: "", description: "", isActive: true },
    ]);
  }

  function removeSubrole(index) {
    onFieldChange("subroles", subroles.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <form onSubmit={onSubmit} className={`catalog-form-grid ${styles.formGrid}`}>
      <label className="catalog-field">
        <span className="catalog-label">Código</span>
        <input
          value={form.code}
          onChange={(event) => onFieldChange("code", event.target.value.toUpperCase())}
          className="catalog-input"
          placeholder="Se genera automáticamente si lo dejas vacío"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Área</span>
        <select
          value={form.areaCode}
          onChange={(event) => onFieldChange("areaCode", event.target.value)}
          className="catalog-select"
          required
        >
          <option value="">Selecciona un área</option>
          {areas.map((area) => (
            <option key={area.id} value={area.code}>
              {area.name}
            </option>
          ))}
        </select>
      </label>

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

      <div className={`catalog-field ${styles.subrolesField}`}>
        <div className={styles.subrolesHeader}>
          <span className="catalog-label">Subroles operativos</span>
          <button type="button" className="catalog-button-ghost" onClick={addSubrole}>
            <Plus size={16} />
            Agregar
          </button>
        </div>

        {subroles.length ? (
          <div className={styles.subrolesList}>
            {subroles.map((subrole, index) => (
              <div key={`${subrole.code || "subrole"}-${index}`} className={styles.subroleRow}>
                <input
                  value={subrole.code || ""}
                  onChange={(event) => updateSubrole(index, "code", event.target.value.toUpperCase())}
                  className="catalog-input"
                  placeholder="Código"
                />
                <input
                  value={subrole.name || ""}
                  onChange={(event) => updateSubrole(index, "name", event.target.value)}
                  className="catalog-input"
                  placeholder="Nombre del subrol"
                />
                <button
                  type="button"
                  className="catalog-icon-button danger"
                  onClick={() => removeSubrole(index)}
                  aria-label={`Eliminar subrol ${subrole.name || index + 1}`}
                  title="Eliminar subrol"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <span className={styles.subrolesHint}>
            Úsalo cuando este rol principal pueda cubrir varias funciones operativas, por ejemplo Ferretero, Acabados u Hogar dentro de Ventas.
          </span>
        )}
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
