"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Edit3, Plus, Search, Trash2 } from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import CatalogPageLoader from "@/components/catalog/CatalogPageLoader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import HydrationGate from "@/components/ui/HydrationGate";
import UserTypeForm from "./UserTypeForm";
import styles from "@/modules/company/submodules/access/styles/components/UserTypeManagement.module.scss";

const INITIAL_FORM = {
  code: "",
  name: "",
  description: "",
  permissions: [],
  scopeType: "company",
  landingPath: "/modules",
  isActive: true,
};

function mapTypeToForm(userType) {
  return {
    code: userType.code || "",
    name: userType.name || "",
    description: userType.description || "",
    permissions: userType.permissions || [],
    scopeType: "company",
    landingPath: "/modules",
    isActive: true,
  };
}

export default function UserTypeManagement() {
  const [userTypes, setUserTypes] = useState([]);
  const [permissionCatalog, setPermissionCatalog] = useState([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [search, setSearch] = useState("");
  const [editingTypeId, setEditingTypeId] = useState("");
  const [typeToDelete, setTypeToDelete] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoadingTypes, setIsLoadingTypes] = useState(true);
  const [notice, setNotice] = useState(null);
  const [isSaving, startSavingTransition] = useTransition();
  const [, startLoadingTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);

  function clearNoticeTimers() {
    if (noticeExitTimeoutRef.current) {
      window.clearTimeout(noticeExitTimeoutRef.current);
      noticeExitTimeoutRef.current = null;
    }

    if (noticeRemoveTimeoutRef.current) {
      window.clearTimeout(noticeRemoveTimeoutRef.current);
      noticeRemoveTimeoutRef.current = null;
    }
  }

  function dismissNotice() {
    clearNoticeTimers();
    setNotice((current) => (current ? { ...current, isLeaving: true } : null));
    noticeRemoveTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeRemoveTimeoutRef.current = null;
    }, 240);
  }

  function showNotice(type, message) {
    clearNoticeTimers();
    setNotice({ type, message, isLeaving: false });
    noticeExitTimeoutRef.current = window.setTimeout(() => {
      dismissNotice();
    }, 4000);
  }

  useEffect(() => {
    return () => {
      clearNoticeTimers();
    };
  }, []);

  useEffect(() => {
    startLoadingTransition(async () => {
      try {
        const response = await fetch("/api/company/user-types");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo cargar la lista de perfiles de acceso.");
        }

        setUserTypes(payload.userTypes || []);
        setPermissionCatalog(payload.permissionCatalog || []);
      } catch (requestError) {
        setNotice({ type: "error", message: requestError.message, isLeaving: false });
      } finally {
        setIsLoadingTypes(false);
      }
    });
  }, []);

  const filteredTypes = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return userTypes;
    }

    return userTypes.filter((type) =>
      [type.code, type.name, type.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [search, userTypes]);

  const canSubmit = useMemo(() => Boolean(form.name.trim()), [form.name]);

  async function refreshTypes() {
    setIsLoadingTypes(true);
    const response = await fetch("/api/company/user-types");
    const payload = await response.json();

    if (!response.ok) {
      setIsLoadingTypes(false);
      throw new Error(payload.error || "No se pudo recargar la lista de perfiles de acceso.");
    }

    setUserTypes(payload.userTypes || []);
    setPermissionCatalog(payload.permissionCatalog || []);
    setIsLoadingTypes(false);
  }

  function updateField(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function togglePermission(permissionKey) {
    setForm((current) => {
      const permissions = new Set(current.permissions || []);

      if (permissions.has(permissionKey)) {
        permissions.delete(permissionKey);
      } else {
        permissions.add(permissionKey);
      }

      return {
        ...current,
        permissions: [...permissions].sort(),
      };
    });
  }

  function togglePermissionGroup(group) {
    const groupPermissions = group.permissions.map((permission) => permission.key);

    setForm((current) => {
      const permissions = new Set(current.permissions || []);
      const hasAll = groupPermissions.every((permission) => permissions.has(permission));

      groupPermissions.forEach((permission) => {
        if (hasAll) {
          permissions.delete(permission);
        } else {
          permissions.add(permission);
        }
      });

      return {
        ...current,
        permissions: [...permissions].sort(),
      };
    });
  }

  function openCreateDrawer() {
    setEditingTypeId("");
    setForm(INITIAL_FORM);
    setIsDrawerOpen(true);
  }

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setEditingTypeId("");
    setForm(INITIAL_FORM);
  }, []);

  function handleSubmit(event) {
    event.preventDefault();

    startSavingTransition(async () => {
      try {
        const method = editingTypeId ? "PATCH" : "POST";
        const endpoint = editingTypeId ? `/api/company/user-types/${editingTypeId}` : "/api/company/user-types";
        const { code: _code, ...payloadForm } = form;
        const response = await fetch(endpoint, {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payloadForm),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar el perfil de acceso.");
        }

        await refreshTypes();
        showNotice(
          "success",
          editingTypeId
            ? "Perfil de acceso actualizado correctamente."
            : "Perfil de acceso creado correctamente.",
        );
        closeDrawer();
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  function handleEdit(userType) {
    setEditingTypeId(userType.id);
    setForm(mapTypeToForm(userType));
    setIsDrawerOpen(true);
  }

  function confirmDelete() {
    if (!typeToDelete) {
      return;
    }

    startSavingTransition(async () => {
      try {
        const response = await fetch(`/api/company/user-types/${typeToDelete.id}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo eliminar el perfil de acceso.");
        }

        await refreshTypes();
        showNotice("success", "Perfil de acceso eliminado correctamente.");
        setTypeToDelete(null);
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  return (
    <HydrationGate fallback={null}>
      {isLoadingTypes ? (
        <CatalogPageLoader formVisible={false} />
      ) : (
        <div className="catalog-page-shell">
          <FloatingNotice notice={notice} onClose={dismissNotice} />

          <div className={`catalog-page-body ${styles.fullWidthBody}`}>
            <div className="catalog-table-column">
              <section className={`catalog-panel page-entrance page-entrance-delay-sm ${styles.tablePanel}`}>
                <div className="catalog-toolbar">
                  <p className="catalog-count">
                    {filteredTypes.length} perfil{filteredTypes.length === 1 ? "" : "es"} de acceso
                    {search.trim() ? ` de ${userTypes.length}` : ""}
                  </p>

                  <label className="catalog-search">
                    <Search size={16} />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar perfil"
                      className="catalog-search-input"
                      disabled={isLoadingTypes || isSaving}
                    />
                  </label>

                  <button
                    type="button"
                    className="catalog-button-primary"
                    onClick={openCreateDrawer}
                    aria-haspopup="dialog"
                    aria-expanded={isDrawerOpen}
                    aria-label="Crear perfil de acceso"
                    title="Crear perfil de acceso"
                  >
                    <Plus size={16} />
                    Crear
                  </button>
                </div>

                {filteredTypes.length ? (
                  <div className={`catalog-table-shell ${styles.tableShell}`}>
                    <div className="catalog-table-scroll">
                      <table className={`catalog-table ${styles.table}`}>
                        <colgroup>
                          <col className={styles.typeColumn} />
                          <col className={styles.descriptionColumn} />
                          <col className={styles.permissionsColumn} />
                          <col className={styles.actionsColumn} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>Perfil</th>
                            <th>Descripción</th>
                            <th>Permisos</th>
                            <th>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTypes.map((userType) => (
                            <tr key={userType.id}>
                              <td>
                                <div className={styles.typeIdentity}>
                                  <strong className={styles.typeName}>{userType.name}</strong>
                                  {userType.isProtected ? (
                                    <span className={styles.protectedBadge}>Protegido</span>
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                <div className={styles.description}>
                                  {userType.description || "Descripción pendiente"}
                                </div>
                              </td>
                              <td>
                                <div className={styles.permissionSummary}>
                                  <strong>{userType.permissions?.length || 0}</strong>
                                  <span>permiso{userType.permissions?.length === 1 ? "" : "s"}</span>
                                </div>
                              </td>
                              <td>
                                <div className="catalog-row-actions">
                                  <button
                                    type="button"
                                    onClick={() => handleEdit(userType)}
                                    className="catalog-icon-button"
                                    title={userType.isProtected ? "Este perfil de acceso no se puede editar" : "Editar perfil"}
                                    aria-label={`Editar ${userType.name}`}
                                    disabled={userType.isProtected}
                                  >
                                    <Edit3 size={16} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setTypeToDelete(userType)}
                                    className="catalog-icon-button danger"
                                    title={userType.isProtected ? "Este perfil de acceso no se puede eliminar" : "Eliminar perfil"}
                                    aria-label={`Eliminar ${userType.name}`}
                                    disabled={userType.isProtected}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="catalog-empty-state">
                    No encontramos perfiles de acceso con ese criterio.
                  </div>
                )}
              </section>
            </div>
          </div>

          <CatalogDrawer
            isOpen={isDrawerOpen}
            eyebrow={editingTypeId ? "Modo edición" : "Nuevo registro"}
            title={editingTypeId ? "Editar perfil de acceso" : "Formulario de perfil de acceso"}
            onClose={closeDrawer}
          >
            <UserTypeForm
              form={form}
              permissionCatalog={permissionCatalog}
              isEditing={Boolean(editingTypeId)}
              isSaving={isSaving}
              canSubmit={canSubmit}
              onFieldChange={updateField}
              onPermissionToggle={togglePermission}
              onPermissionGroupToggle={togglePermissionGroup}
              onCancel={closeDrawer}
              onSubmit={handleSubmit}
            />
          </CatalogDrawer>

          <ConfirmDialog
            isOpen={Boolean(typeToDelete)}
            title="Eliminar perfil de acceso"
            message={`¿Deseas eliminar el perfil "${typeToDelete?.name || ""}"? Los usuarios existentes conservarán su etiqueta actual.`}
            confirmLabel={isSaving ? "Eliminando..." : "Eliminar"}
            isPending={isSaving}
            onCancel={() => setTypeToDelete(null)}
            onConfirm={confirmDelete}
          />
        </div>
      )}
    </HydrationGate>
  );
}
