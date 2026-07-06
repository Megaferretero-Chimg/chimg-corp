"use client";

import { CheckSquare, Layers3, Plus } from "lucide-react";

import styles from "@/modules/company/submodules/access/styles/components/UserTypeManagement.module.scss";

export default function UserTypeForm({
  form,
  permissionCatalog,
  scopeTypes,
  isEditing,
  isSaving,
  canSubmit,
  onCancel,
  onFieldChange,
  onPermissionToggle,
  onPermissionGroupToggle,
  onSubmit,
}) {
  const selectedPermissions = new Set(form.permissions || []);

  return (
    <form onSubmit={onSubmit} className="catalog-form-grid">
      <label className="catalog-field">
        <span className="catalog-label">Nombre del rol</span>
        <input
          value={form.name}
          onChange={(event) => onFieldChange("name", event.target.value)}
          className="catalog-input"
          placeholder="Ej. Supervisor"
          required
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Código</span>
        <input
          value={form.code}
          onChange={(event) => onFieldChange("code", event.target.value)}
          className="catalog-input"
          placeholder="Se genera desde el nombre"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Descripción</span>
        <textarea
          value={form.description}
          onChange={(event) => onFieldChange("description", event.target.value)}
          className="catalog-input"
          placeholder="Uso general del rol de acceso"
          rows={4}
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Alcance operativo</span>
        <select
          value={form.scopeType}
          onChange={(event) => onFieldChange("scopeType", event.target.value)}
          className="catalog-select"
        >
          {scopeTypes.map((scope) => (
            <option key={scope.value} value={scope.value}>
              {scope.label}
            </option>
          ))}
        </select>
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Ruta inicial</span>
        <input
          value={form.landingPath}
          onChange={(event) => onFieldChange("landingPath", event.target.value)}
          className="catalog-input"
          placeholder="/modules"
        />
      </label>

      <label className="catalog-field">
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

      <section className={styles.permissionMatrix}>
        <div className={styles.permissionHeader}>
          <div>
            <span className="catalog-label">Permisos del rol</span>
            <p>Selecciona módulos, páginas y acciones habilitadas para este perfil.</p>
          </div>
          <div className={styles.permissionCounter}>
            <CheckSquare size={16} />
            {selectedPermissions.size}
          </div>
        </div>

        {permissionCatalog.map((module) => (
          <div key={module.moduleKey} className={styles.permissionModule}>
            <div className={styles.permissionModuleTitle}>
              <Layers3 size={16} />
              <strong>{module.moduleLabel}</strong>
            </div>

            <div className={styles.permissionGroups}>
              {module.groups.map((group) => {
                const groupPermissionKeys = group.permissions.map((permission) => permission.key);
                const checkedCount = groupPermissionKeys.filter((permission) => selectedPermissions.has(permission)).length;
                const isGroupChecked = checkedCount === groupPermissionKeys.length;

                return (
                  <article key={group.key} className={styles.permissionGroup}>
                    <div className={styles.permissionGroupHeader}>
                      <div>
                        <strong>{group.label}</strong>
                        <p>{group.description}</p>
                      </div>
                      <button
                        type="button"
                        className={`catalog-switch ${isGroupChecked ? "is-active" : ""}`}
                        onClick={() => onPermissionGroupToggle(group)}
                        aria-pressed={isGroupChecked}
                      >
                        <span className="catalog-switchKnob" />
                        <span>{checkedCount}/{groupPermissionKeys.length}</span>
                      </button>
                    </div>

                    <div className={styles.permissionChecks}>
                      {group.permissions.map((permission) => (
                        <label key={permission.key} className={styles.permissionCheck}>
                          <input
                            type="checkbox"
                            checked={selectedPermissions.has(permission.key)}
                            onChange={() => onPermissionToggle(permission.key)}
                          />
                          <span>{permission.label}</span>
                        </label>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </section>

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
