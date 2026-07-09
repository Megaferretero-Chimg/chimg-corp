"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  BriefcaseBusiness,
  Building2,
  Edit3,
  Plus,
  Search,
  ShieldUser,
  Trash2,
} from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import CatalogPageLoader from "@/components/catalog/CatalogPageLoader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import HydrationGate from "@/components/ui/HydrationGate";
import RoleForm from "./RoleForm";
import styles from "@/modules/company/submodules/organization/styles/components/RoleManagement.module.scss";

const INITIAL_FORM = {
  code: "",
  name: "",
  areaCode: "",
  supervisorRoleCode: "",
  description: "",
};

function mapRoleToForm(role) {
  return {
    code: role.code || "",
    name: role.name || "",
    areaCode: role.areaCode || "",
    supervisorRoleCode: role.supervisorRoleCode || "",
    description: role.description || "",
  };
}

export default function RoleManagement() {
  const [roles, setRoles] = useState([]);
  const [areas, setAreas] = useState([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [search, setSearch] = useState("");
  const [editingRoleId, setEditingRoleId] = useState("");
  const [roleToDelete, setRoleToDelete] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoadingRoles, setIsLoadingRoles] = useState(true);
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

    setNotice((current) => {
      if (!current) {
        return null;
      }

      return {
        ...current,
        isLeaving: true,
      };
    });

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
      if (noticeExitTimeoutRef.current) {
        window.clearTimeout(noticeExitTimeoutRef.current);
      }

      if (noticeRemoveTimeoutRef.current) {
        window.clearTimeout(noticeRemoveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    startLoadingTransition(async () => {
      try {
        const [rolesResponse, areasResponse] = await Promise.all([
          fetch("/api/company/roles"),
          fetch("/api/company/areas"),
        ]);
        const [rolesPayload, areasPayload] = await Promise.all([
          rolesResponse.json(),
          areasResponse.json(),
        ]);

        if (!rolesResponse.ok) {
          throw new Error(rolesPayload.error || "No se pudo cargar la lista de cargos.");
        }

        if (!areasResponse.ok) {
          throw new Error(areasPayload.error || "No se pudo cargar la lista de áreas.");
        }

        setRoles(rolesPayload.roles || []);
        setAreas(areasPayload.areas || []);
      } catch (requestError) {
        clearNoticeTimers();
        setNotice({ type: "error", message: requestError.message, isLeaving: false });
        noticeExitTimeoutRef.current = window.setTimeout(() => {
          clearNoticeTimers();
          setNotice((current) => {
            if (!current) {
              return null;
            }

            return {
              ...current,
              isLeaving: true,
            };
          });

          noticeRemoveTimeoutRef.current = window.setTimeout(() => {
            setNotice(null);
            noticeRemoveTimeoutRef.current = null;
          }, 240);
        }, 4000);
      } finally {
        setIsLoadingRoles(false);
      }
    });
  }, []);

  const filteredRoles = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return roles;
    }

    return roles.filter((role) =>
      [role.code, role.name, role.areaName, role.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [roles, search]);

  const canSubmit = useMemo(() => {
    return Boolean(form.name.trim() && form.areaCode.trim());
  }, [form.areaCode, form.name]);
  const supervisorOptions = useMemo(() => {
    return roles
      .filter((role) => role.id !== editingRoleId)
      .sort((left, right) => {
        const areaComparison = (left.areaName || "").localeCompare(right.areaName || "", "es");

        return areaComparison || left.name.localeCompare(right.name, "es");
      });
  }, [editingRoleId, roles]);

  async function refreshData() {
    setIsLoadingRoles(true);
    const [rolesResponse, areasResponse] = await Promise.all([
      fetch("/api/company/roles"),
      fetch("/api/company/areas"),
    ]);
    const [rolesPayload, areasPayload] = await Promise.all([
      rolesResponse.json(),
      areasResponse.json(),
    ]);

    if (!rolesResponse.ok) {
      setIsLoadingRoles(false);
      throw new Error(rolesPayload.error || "No se pudo recargar la lista de cargos.");
    }

    if (!areasResponse.ok) {
      setIsLoadingRoles(false);
      throw new Error(areasPayload.error || "No se pudo recargar la lista de áreas.");
    }

    setRoles(rolesPayload.roles || []);
    setAreas(areasPayload.areas || []);
    setIsLoadingRoles(false);
  }

  function updateField(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function resetForm() {
    setEditingRoleId("");
    setForm(INITIAL_FORM);
  }

  function openCreateDrawer() {
    resetForm();
    setIsDrawerOpen(true);
  }

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setEditingRoleId("");
    setForm(INITIAL_FORM);
  }, []);

  function handleSubmit(event) {
    event.preventDefault();

    startSavingTransition(async () => {
      try {
        const method = editingRoleId ? "PATCH" : "POST";
        const endpoint = editingRoleId ? `/api/company/roles/${editingRoleId}` : "/api/company/roles";
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
          throw new Error(payload.error || "No se pudo guardar el cargo.");
        }

        await refreshData();
        showNotice(
          "success",
          editingRoleId
            ? "Cargo actualizado correctamente."
            : "Cargo creado correctamente.",
        );
        closeDrawer();
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  function handleEdit(role) {
    setEditingRoleId(role.id);
    setForm(mapRoleToForm(role));
    setIsDrawerOpen(true);
  }

  function handleRowClick(event, role) {
    if (event.target.closest("button, a")) return;

    handleEdit(role);
  }

  function requestDelete(role) {
    setRoleToDelete(role);
  }

  function confirmDelete() {
    if (!roleToDelete) {
      return;
    }

    startSavingTransition(async () => {
      try {
        const response = await fetch(`/api/company/roles/${roleToDelete.id}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo eliminar el cargo.");
        }

        await refreshData();
        showNotice("success", "Cargo eliminado correctamente.");

        if (editingRoleId === roleToDelete.id) {
          closeDrawer();
        }

        setRoleToDelete(null);
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  return (
    <HydrationGate fallback={null}>
      {isLoadingRoles ? (
        <CatalogPageLoader formVisible={false} />
      ) : (
        <div className="catalog-page-shell">
          <FloatingNotice notice={notice} onClose={dismissNotice} />

          <div className={`catalog-page-body ${styles.fullWidthBody}`}>
            <div className="catalog-table-column">
              <section className="catalog-panel page-entrance page-entrance-delay-sm">
                <div className="catalog-toolbar">
                  <div>
                    <p className="catalog-count">
                      {filteredRoles.length} cargo{filteredRoles.length === 1 ? "" : "s"}
                      {search.trim() ? ` de ${roles.length}` : ""}
                    </p>
                  </div>

                  <label className="catalog-search">
                    <Search size={16} />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar cargo"
                      className="catalog-search-input"
                      disabled={isLoadingRoles || isSaving}
                    />
                  </label>

                  <button
                    type="button"
                    className="catalog-button-primary"
                    onClick={openCreateDrawer}
                    aria-haspopup="dialog"
                    aria-expanded={isDrawerOpen}
                    aria-label="Crear cargo"
                    title="Crear cargo"
                  >
                    <Plus size={16} />
                    Crear
                  </button>
                </div>

                {filteredRoles.length ? (
                  <div className="catalog-table-shell">
                    <div className="catalog-table-scroll">
                      <table className="catalog-table">
                        <thead>
                          <tr>
                            <th>Cargo</th>
                            <th>Área</th>
                            <th>Supervisor</th>
                            <th>Descripción</th>
                            <th>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRoles.map((role) => (
                            <tr
                              key={role.id}
                              className={styles.clickableRow}
                              onClick={(event) => handleRowClick(event, role)}
                            >
                              <td>
                                <div className={styles.roleIdentity}>
                                  <div className={styles.roleCode}>
                                    <ShieldUser size={14} />
                                    {role.code}
                                  </div>
                                  <strong className={styles.roleName}>{role.name}</strong>
                                </div>
                              </td>
                              <td>
                                <span className={styles.roleArea}>
                                  <Building2 size={14} />
                                  {role.areaName || "Área pendiente"}
                                </span>
                              </td>
                              <td>
                                <span className={styles.roleArea}>
                                  <ShieldUser size={14} />
                                  {role.supervisorRoleName || "Sin supervisor"}
                                </span>
                              </td>
                              <td>
                                <div className={styles.roleDescription}>
                                  <span>
                                    <BriefcaseBusiness size={14} style={{ marginRight: "0.42rem", verticalAlign: "text-bottom" }} />
                                    {role.description || "Descripción pendiente"}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <div className="catalog-row-actions">
                                  <button
                                    type="button"
                                    onClick={() => handleEdit(role)}
                                    className="catalog-icon-button"
                                    title="Editar cargo"
                                    aria-label={`Editar ${role.name}`}
                                  >
                                    <Edit3 size={16} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => requestDelete(role)}
                                    className="catalog-icon-button danger"
                                    title="Eliminar cargo"
                                    aria-label={`Eliminar ${role.name}`}
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
                    No encontramos cargos con ese criterio. Si aún no hay registros, crea el primero desde el formulario.
                  </div>
                )}
              </section>
            </div>
          </div>

          <CatalogDrawer
            isOpen={isDrawerOpen}
            eyebrow={editingRoleId ? "Modo edición" : "Nuevo registro"}
            title={editingRoleId ? "Editar cargo" : "Formulario de cargo"}
            onClose={closeDrawer}
          >
            <RoleForm
              areas={areas}
              roles={supervisorOptions}
              form={form}
              isEditing={Boolean(editingRoleId)}
              isSaving={isSaving}
              canSubmit={canSubmit}
              onFieldChange={updateField}
              onCancel={closeDrawer}
              onSubmit={handleSubmit}
            />
          </CatalogDrawer>
          <ConfirmDialog
            isOpen={Boolean(roleToDelete)}
            title="Eliminar cargo"
            message={`¿Deseas eliminar el cargo "${roleToDelete?.name || ""}"? Esta acción no se puede deshacer.`}
            confirmLabel={isSaving ? "Eliminando..." : "Eliminar"}
            isPending={isSaving}
            onCancel={() => setRoleToDelete(null)}
            onConfirm={confirmDelete}
          />
        </div>
      )}
    </HydrationGate>
  );
}
