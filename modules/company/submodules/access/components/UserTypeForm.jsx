"use client";

import { CheckSquare, Layers3, Plus } from "lucide-react";

import styles from "@/modules/company/submodules/access/styles/components/UserTypeManagement.module.scss";

export default function UserTypeForm({
  form,
  permissionCatalog,
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
        <span className="catalog-label">Nombre del perfil</span>
        <input
          value={form.name}
          onChange={(event) => onFieldChange("name", event.target.value)}
          className="catalog-input"
          placeholder="Ej. Supervisor"
          required
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Descripción</span>
        <textarea
          value={form.description}
          onChange={(event) => onFieldChange("description", event.target.value)}
          className="catalog-input"
          placeholder="Ej. Puede planificar horarios, revisar novedades o consultar reportes."
          rows={4}
        />
      </label>

      <section className={styles.permissionMatrix}>
        <div className={styles.permissionHeader}>
          <div>
            <span className="catalog-label">Permisos del perfil</span>
            <p>Define qué pantallas puede abrir y qué acciones puede ejecutar. El alcance sobre empleados o grupos se asigna al usuario.</p>
          </div>
          <div className={styles.permissionCounter}>
            <CheckSquare size={16} />
            <span>{selectedPermissions.size} seleccionados</span>
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
          {isSaving ? "Guardando..." : isEditing ? "Actualizar perfil" : "Crear perfil"}
        </button>
      </div>
    </form>
  );
}
