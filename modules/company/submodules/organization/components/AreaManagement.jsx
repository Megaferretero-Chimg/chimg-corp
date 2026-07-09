"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  BriefcaseBusiness,
  Edit3,
  Layers3,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import CatalogPageLoader from "@/components/catalog/CatalogPageLoader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import HydrationGate from "@/components/ui/HydrationGate";
import AreaForm from "./AreaForm";
import styles from "@/modules/company/submodules/organization/styles/components/AreaManagement.module.scss";

const INITIAL_FORM = {
  code: "",
  name: "",
  description: "",
  isActive: true,
};

function mapAreaToForm(area) {
  return {
    code: area.code || "",
    name: area.name || "",
    description: area.description || "",
    isActive: Boolean(area.isActive),
  };
}

export default function AreaManagement() {
  const [areas, setAreas] = useState([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [search, setSearch] = useState("");
  const [editingAreaId, setEditingAreaId] = useState("");
  const [areaToDelete, setAreaToDelete] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoadingAreas, setIsLoadingAreas] = useState(true);
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
        const areasResponse = await fetch("/api/company/areas");
        const areasPayload = await areasResponse.json();

        if (!areasResponse.ok) {
          throw new Error(areasPayload.error || "No se pudo cargar la lista de áreas.");
        }

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
        setIsLoadingAreas(false);
      }
    });
  }, []);

  const filteredAreas = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return areas;
    }

    return areas.filter((area) =>
      [area.code, area.name, area.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [areas, search]);

  const canSubmit = useMemo(() => {
    return Boolean(form.name.trim());
  }, [form.name]);

  async function refreshAreas() {
    setIsLoadingAreas(true);
    const areasResponse = await fetch("/api/company/areas");
    const areasPayload = await areasResponse.json();

    if (!areasResponse.ok) {
      setIsLoadingAreas(false);
      throw new Error(areasPayload.error || "No se pudo recargar la lista de áreas.");
    }

    setAreas(areasPayload.areas || []);
    setIsLoadingAreas(false);
  }

  function updateField(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function resetForm() {
    setEditingAreaId("");
    setForm(INITIAL_FORM);
  }

  function openCreateDrawer() {
    resetForm();
    setIsDrawerOpen(true);
  }

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setEditingAreaId("");
    setForm(INITIAL_FORM);
  }, []);

  function handleSubmit(event) {
    event.preventDefault();

    startSavingTransition(async () => {
      try {
        const method = editingAreaId ? "PATCH" : "POST";
        const endpoint = editingAreaId ? `/api/company/areas/${editingAreaId}` : "/api/company/areas";
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
          throw new Error(payload.error || "No se pudo guardar el área.");
        }

        await refreshAreas();
        showNotice(
          "success",
          editingAreaId
            ? "Área actualizada correctamente."
            : "Área creada correctamente.",
        );
        closeDrawer();
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  function handleEdit(area) {
    setEditingAreaId(area.id);
    setForm(mapAreaToForm(area));
    setIsDrawerOpen(true);
  }

  function requestDelete(area) {
    setAreaToDelete(area);
  }

  function confirmDelete() {
    if (!areaToDelete) {
      return;
    }

    startSavingTransition(async () => {
      try {
        const response = await fetch(`/api/company/areas/${areaToDelete.id}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo eliminar el área.");
        }

        await refreshAreas();
        showNotice("success", "Área eliminada correctamente.");

        if (editingAreaId === areaToDelete.id) {
          closeDrawer();
        }

        setAreaToDelete(null);
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  return (
    <HydrationGate fallback={null}>
      {isLoadingAreas ? (
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
                      {filteredAreas.length} área{filteredAreas.length === 1 ? "" : "s"}
                      {search.trim() ? ` de ${areas.length}` : ""}
                    </p>
                  </div>

                  <label className="catalog-search">
                    <Search size={16} />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar área"
                      className="catalog-search-input"
                      disabled={isLoadingAreas || isSaving}
                    />
                  </label>

                  <button
                    type="button"
                    className="catalog-button-primary"
                    onClick={openCreateDrawer}
                    aria-haspopup="dialog"
                    aria-expanded={isDrawerOpen}
                    aria-label="Crear área"
                    title="Crear área"
                  >
                    <Plus size={16} />
                    Crear
                  </button>
                </div>

                {filteredAreas.length ? (
                  <div className="catalog-table-shell">
                    <div className="catalog-table-scroll">
                      <table className="catalog-table">
                        <thead>
                          <tr>
                            <th>Área</th>
                            <th>Descripción</th>
                            <th>Estado</th>
                            <th>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAreas.map((area) => (
                            <tr key={area.id}>
                              <td>
                                <div className={styles.areaIdentity}>
                                  <div className={styles.areaCode}>
                                    <Layers3 size={14} />
                                    {area.code}
                                  </div>
                                  <strong className={styles.areaName}>{area.name}</strong>
                                </div>
                              </td>
                              <td>
                                <div className={styles.areaDescription}>
                                  <span>
                                    <BriefcaseBusiness size={14} style={{ marginRight: "0.42rem", verticalAlign: "text-bottom" }} />
                                    {area.description || "Descripción pendiente"}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <span className={`catalog-status-badge ${area.isActive ? "is-active" : "is-inactive"}`}>
                                  {area.isActive ? "Activa" : "Inactiva"}
                                </span>
                              </td>
                              <td>
                                <div className="catalog-row-actions">
                                  <button
                                    type="button"
                                    onClick={() => handleEdit(area)}
                                    className="catalog-icon-button"
                                    title="Editar área"
                                    aria-label={`Editar ${area.name}`}
                                  >
                                    <Edit3 size={16} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => requestDelete(area)}
                                    className="catalog-icon-button danger"
                                    title="Eliminar área"
                                    aria-label={`Eliminar ${area.name}`}
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
                    No encontramos áreas con ese criterio. Si aún no hay registros, crea la primera desde el formulario.
                  </div>
                )}
              </section>
            </div>
          </div>

          <CatalogDrawer
            isOpen={isDrawerOpen}
            eyebrow={editingAreaId ? "Modo edición" : "Nuevo registro"}
            title={editingAreaId ? "Editar área" : "Formulario de área"}
            onClose={closeDrawer}
          >
            <AreaForm
              form={form}
              isEditing={Boolean(editingAreaId)}
              isSaving={isSaving}
              canSubmit={canSubmit}
              onFieldChange={updateField}
              onCancel={closeDrawer}
              onSubmit={handleSubmit}
            />
          </CatalogDrawer>
          <ConfirmDialog
            isOpen={Boolean(areaToDelete)}
            title="Eliminar área"
            message={`¿Deseas eliminar el área "${areaToDelete?.name || ""}"? Esta acción no se puede deshacer.`}
            confirmLabel={isSaving ? "Eliminando..." : "Eliminar"}
            isPending={isSaving}
            onCancel={() => setAreaToDelete(null)}
            onConfirm={confirmDelete}
          />
        </div>
      )}
    </HydrationGate>
  );
}
