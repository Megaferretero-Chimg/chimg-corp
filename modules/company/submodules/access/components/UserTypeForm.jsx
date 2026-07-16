"use client";

import { useMemo, useState } from "react";
import { CheckSquare, ChevronDown, FileCheck2, Layers3, Plus } from "lucide-react";

import styles from "@/modules/company/submodules/access/styles/components/UserTypeManagement.module.scss";

function buildPermissionTree(permissionCatalog, type, isVisible = () => true) {
  return permissionCatalog
    .map((module) => ({
      ...module,
      groups: module.groups
        .map((group) => ({
          ...group,
          permissions: group.permissions.filter((permission) => permission.type === type && isVisible(permission)),
        }))
        .filter((group) => group.permissions.length),
    }))
    .filter((module) => module.groups.length);
}

function actionIsAvailable(permission, selectedPages) {
  const requiredPages = Array.isArray(permission.requiresAnyPage) ? permission.requiresAnyPage : [];

  return requiredPages.length > 0 && requiredPages.some((pageKey) => selectedPages.has(pageKey));
}

function reconcilePageDependencies(permissionCatalog, permissions) {
  const permissionsByKey = new Map(permissionCatalog.flatMap((module) =>
    module.groups.flatMap((group) => group.permissions.map((permission) => [permission.key, permission])),
  ));
  const selected = new Set(permissions);
  const selectedPages = new Set([...selected].filter((key) => permissionsByKey.get(key)?.type === "page"));

  return [...selected].filter((key) => {
    const permission = permissionsByKey.get(key);

    return permission?.type === "page" || (
      permission?.type === "action" && actionIsAvailable(permission, selectedPages)
    );
  }).sort();
}

function PermissionTree({
  title,
  description,
  icon: Icon,
  countLabel,
  modules,
  selectedPermissions,
  onSelectionChange,
  emptyMessage = "",
}) {
  const [expandedModules, setExpandedModules] = useState(() => new Set(
    modules
      .filter((module) => module.groups.some((group) =>
        group.permissions.some((permission) => selectedPermissions.has(permission.key))))
      .map((module) => module.moduleKey),
  ));
  const [expandedGroups, setExpandedGroups] = useState(() => new Set(
    modules.flatMap((module) => module.groups
      .filter((group) => group.permissions.some((permission) => selectedPermissions.has(permission.key)))
      .map((group) => group.key)),
  ));
  const selectedCount = modules.reduce(
    (total, module) => total + module.groups.reduce(
      (groupTotal, group) => groupTotal + group.permissions.filter((permission) => selectedPermissions.has(permission.key)).length,
      0,
    ),
    0,
  );

  function toggleExpanded(setter, key) {
    setter((current) => {
      const next = new Set(current);

      if (next.has(key)) next.delete(key);
      else next.add(key);

      return next;
    });
  }

  function setKeys(keys, shouldSelect) {
    const next = new Set(selectedPermissions);
    keys.forEach((key) => {
      if (shouldSelect) next.add(key);
      else next.delete(key);
    });
    onSelectionChange([...next].sort());
  }

  return (
    <section className={styles.permissionMatrix}>
      <div className={styles.permissionHeader}>
        <div>
          <span className="catalog-label">{title}</span>
          <p>{description}</p>
        </div>
        <div className={styles.permissionCounter}>
          <Icon size={16} />
          <span>{selectedCount} {countLabel}</span>
        </div>
      </div>

      <div className={styles.permissionTree}>
        {!modules.length && emptyMessage ? (
          <div className={styles.permissionEmptyState}>
            <CheckSquare size={18} />
            <span>{emptyMessage}</span>
          </div>
        ) : null}
        {modules.map((module) => {
          const moduleKeys = module.groups.flatMap((group) => group.permissions.map((permission) => permission.key));
          const moduleCheckedCount = moduleKeys.filter((key) => selectedPermissions.has(key)).length;
          const moduleIsChecked = moduleCheckedCount === moduleKeys.length;
          const moduleIsExpanded = expandedModules.has(module.moduleKey);

          return (
            <article key={module.moduleKey} className={styles.treeModule}>
              <div className={styles.treeModuleHeader}>
                <label className={styles.treeCheckbox}>
                  <input
                    type="checkbox"
                    checked={moduleIsChecked}
                    data-partial={moduleCheckedCount > 0 && !moduleIsChecked ? "true" : "false"}
                    onChange={(event) => {
                      setKeys(moduleKeys, event.target.checked);
                      if (event.target.checked) {
                        setExpandedModules((current) => new Set(current).add(module.moduleKey));
                      }
                    }}
                  />
                  <Layers3 size={16} />
                  <strong>{module.moduleLabel}</strong>
                </label>
                <button
                  type="button"
                  className={styles.treeExpandButton}
                  onClick={() => toggleExpanded(setExpandedModules, module.moduleKey)}
                  aria-expanded={moduleIsExpanded}
                  aria-label={`${moduleIsExpanded ? "Contraer" : "Expandir"} ${module.moduleLabel}`}
                >
                  <span>{moduleCheckedCount}/{moduleKeys.length}</span>
                  <ChevronDown size={17} />
                </button>
              </div>

              {moduleIsExpanded ? (
                <div className={styles.treeSections}>
                  {module.groups.map((group) => {
                    const groupKeys = group.permissions.map((permission) => permission.key);
                    const groupCheckedCount = groupKeys.filter((key) => selectedPermissions.has(key)).length;
                    const groupIsChecked = groupCheckedCount === groupKeys.length;
                    const groupIsExpanded = expandedGroups.has(group.key);

                    return (
                      <div key={group.key} className={styles.treeSection}>
                        <div className={styles.treeSectionHeader}>
                          <label className={styles.treeCheckbox}>
                            <input
                              type="checkbox"
                              checked={groupIsChecked}
                              data-partial={groupCheckedCount > 0 && !groupIsChecked ? "true" : "false"}
                              onChange={(event) => {
                                setKeys(groupKeys, event.target.checked);
                                if (event.target.checked) {
                                  setExpandedGroups((current) => new Set(current).add(group.key));
                                }
                              }}
                            />
                            <span>
                              <strong>{group.label}</strong>
                              <small>{group.description}</small>
                            </span>
                          </label>
                          <button
                            type="button"
                            className={styles.treeExpandButton}
                            onClick={() => toggleExpanded(setExpandedGroups, group.key)}
                            aria-expanded={groupIsExpanded}
                            aria-label={`${groupIsExpanded ? "Contraer" : "Expandir"} ${group.label}`}
                          >
                            <span>{groupCheckedCount}/{groupKeys.length}</span>
                            <ChevronDown size={16} />
                          </button>
                        </div>

                        {groupIsExpanded ? (
                          <div className={styles.treeLeaves}>
                            {group.permissions.map((permission) => (
                              <label key={permission.key} className={styles.treeLeaf}>
                                <input
                                  type="checkbox"
                                  checked={selectedPermissions.has(permission.key)}
                                  onChange={(event) => setKeys([permission.key], event.target.checked)}
                                />
                                <span>{permission.label}</span>
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function UserTypeForm({
  form,
  permissionCatalog,
  isEditing,
  isSaving,
  canSubmit,
  onCancel,
  onFieldChange,
  onSubmit,
}) {
  const selectedPermissions = useMemo(() => new Set(form.permissions || []), [form.permissions]);
  const selectedPagePermissions = useMemo(() => new Set(
    permissionCatalog.flatMap((module) => module.groups.flatMap((group) =>
      group.permissions
        .filter((permission) => permission.type === "page" && selectedPermissions.has(permission.key))
        .map((permission) => permission.key),
    )),
  ), [permissionCatalog, selectedPermissions]);
  const pageModules = useMemo(() => buildPermissionTree(permissionCatalog, "page"), [permissionCatalog]);
  const actionModules = useMemo(() => buildPermissionTree(
    permissionCatalog,
    "action",
    (permission) => actionIsAvailable(permission, selectedPagePermissions),
  ), [permissionCatalog, selectedPagePermissions]);

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

      <PermissionTree
        title="1. Páginas permitidas"
        description="Selecciona primero las pantallas a las que podrá entrar este perfil."
        icon={FileCheck2}
        countLabel="páginas"
        modules={pageModules}
        selectedPermissions={selectedPermissions}
        onSelectionChange={(permissions) => onFieldChange(
          "permissions",
          reconcilePageDependencies(permissionCatalog, permissions),
        )}
      />

      <PermissionTree
        title="2. Acciones permitidas"
        description="Solo se muestran las operaciones disponibles dentro de las páginas seleccionadas."
        icon={CheckSquare}
        countLabel="acciones"
        modules={actionModules}
        selectedPermissions={selectedPermissions}
        onSelectionChange={(permissions) => onFieldChange("permissions", permissions)}
        emptyMessage="Selecciona al menos una página con acciones disponibles para continuar."
      />

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
