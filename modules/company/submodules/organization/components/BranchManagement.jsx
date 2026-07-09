"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Building2,
  Edit3,
  Landmark,
  MapPin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import CatalogPageLoader from "@/components/catalog/CatalogPageLoader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import HydrationGate from "@/components/ui/HydrationGate";
import BranchForm from "./BranchForm";
import styles from "@/modules/company/submodules/organization/styles/components/BranchManagement.module.scss";

const INITIAL_FORM = {
  code: "",
  name: "",
  city: "",
  address: "",
  isActive: true,
};

function mapBranchToForm(branch) {
  return {
    code: branch.code || "",
    name: branch.name || "",
    city: branch.city || "",
    address: branch.address || "",
    isActive: Boolean(branch.isActive),
  };
}

export default function BranchManagement() {
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [search, setSearch] = useState("");
  const [editingBranchId, setEditingBranchId] = useState("");
  const [branchToDelete, setBranchToDelete] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
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
        const response = await fetch("/api/company/branches");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo cargar la lista de sucursales.");
        }

        setBranches(payload.branches || []);
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
        setIsLoadingBranches(false);
      }
    });
  }, []);

  const filteredBranches = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return branches;
    }

    return branches.filter((branch) =>
      [branch.code, branch.name, branch.city, branch.address]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [branches, search]);
  const canSubmit = useMemo(() => {
    return Boolean(form.name.trim());
  }, [form.name]);

  async function refreshBranches() {
    setIsLoadingBranches(true);
    const response = await fetch("/api/company/branches");
    const payload = await response.json();

    if (!response.ok) {
      setIsLoadingBranches(false);
      throw new Error(payload.error || "No se pudo recargar la lista de sucursales.");
    }

    setBranches(payload.branches || []);
    setIsLoadingBranches(false);
  }

  function updateField(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function resetForm() {
    setEditingBranchId("");
    setForm(INITIAL_FORM);
  }

  function openCreateDrawer() {
    resetForm();
    setIsDrawerOpen(true);
  }

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setEditingBranchId("");
    setForm(INITIAL_FORM);
  }, []);

  function handleSubmit(event) {
    event.preventDefault();

    startSavingTransition(async () => {
      try {
        const method = editingBranchId ? "PATCH" : "POST";
        const endpoint = editingBranchId ? `/api/company/branches/${editingBranchId}` : "/api/company/branches";
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
          throw new Error(payload.error || "No se pudo guardar la sucursal.");
        }

        await refreshBranches();
        showNotice(
          "success",
          editingBranchId
            ? "Sucursal actualizada correctamente."
            : "Sucursal creada correctamente.",
        );
        closeDrawer();
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  function handleEdit(branch) {
    setEditingBranchId(branch.id);
    setForm(mapBranchToForm(branch));
    setIsDrawerOpen(true);
  }

  function requestDelete(branch) {
    setBranchToDelete(branch);
  }

  function confirmDelete() {
    if (!branchToDelete) {
      return;
    }

    startSavingTransition(async () => {
      try {
        const response = await fetch(`/api/company/branches/${branchToDelete.id}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo eliminar la sucursal.");
        }

        await refreshBranches();
        showNotice("success", "Sucursal eliminada correctamente.");

        if (editingBranchId === branchToDelete.id) {
          closeDrawer();
        }

        setBranchToDelete(null);
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  return (
    <HydrationGate fallback={null}>
      {isLoadingBranches ? (
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
                      {filteredBranches.length} sucursal{filteredBranches.length === 1 ? "" : "es"}
                      {search.trim() ? ` de ${branches.length}` : ""}
                    </p>
                  </div>

                  <label className="catalog-search">
                    <Search size={16} />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar sucursal"
                      className="catalog-search-input"
                      disabled={isLoadingBranches || isSaving}
                    />
                  </label>

                  <button
                    type="button"
                    className="catalog-button-primary"
                    onClick={openCreateDrawer}
                    aria-haspopup="dialog"
                    aria-expanded={isDrawerOpen}
                    aria-label="Crear sucursal"
                    title="Crear sucursal"
                  >
                    <Plus size={16} />
                    Crear
                  </button>
                </div>

                {filteredBranches.length ? (
                  <div className="catalog-table-shell">
                    <div className="catalog-table-scroll">
                      <table className="catalog-table">
                        <thead>
                          <tr>
                            <th>Sucursal</th>
                            <th>Ubicación</th>
                            <th>Estado</th>
                            <th>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredBranches.map((branch) => (
                            <tr key={branch.id}>
                              <td>
                                <div className={styles.branchIdentity}>
                                  <div className={styles.branchCode}>
                                    <Landmark size={14} />
                                    {branch.code}
                                  </div>
                                  <strong className={styles.branchName}>{branch.name}</strong>
                                </div>
                              </td>
                              <td>
                                <div className={styles.locationStack}>
                                  <span className={styles.locationItem}>
                                    <Building2 size={14} />
                                    {branch.city || "Ciudad pendiente"}
                                  </span>
                                  <span className={styles.locationItem}>
                                    <MapPin size={14} />
                                    {branch.address || "Dirección pendiente"}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <span className={`catalog-status-badge ${branch.isActive ? "is-active" : "is-inactive"}`}>
                                  {branch.isActive ? "Activa" : "Inactiva"}
                                </span>
                              </td>
                              <td>
                                <div className="catalog-row-actions">
                                  <button
                                    type="button"
                                    onClick={() => handleEdit(branch)}
                                    className="catalog-icon-button"
                                    title="Editar sucursal"
                                    aria-label={`Editar ${branch.name}`}
                                  >
                                    <Edit3 size={16} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => requestDelete(branch)}
                                    className="catalog-icon-button danger"
                                    title="Eliminar sucursal"
                                    aria-label={`Eliminar ${branch.name}`}
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
                    No encontramos sucursales con ese criterio. Si aún no hay registros, crea la primera desde el
                    formulario.
                  </div>
                )}
              </section>
            </div>
          </div>

          <CatalogDrawer
            isOpen={isDrawerOpen}
            eyebrow={editingBranchId ? "Modo edición" : "Nuevo registro"}
            title={editingBranchId ? "Editar sucursal" : "Formulario de sucursal"}
            onClose={closeDrawer}
          >
            <BranchForm
              form={form}
              isEditing={Boolean(editingBranchId)}
              isSaving={isSaving}
              canSubmit={canSubmit}
              onFieldChange={updateField}
              onCancel={closeDrawer}
              onSubmit={handleSubmit}
            />
          </CatalogDrawer>
          <ConfirmDialog
            isOpen={Boolean(branchToDelete)}
            title="Eliminar sucursal"
            message={`¿Deseas eliminar la sucursal "${branchToDelete?.name || ""}"? Esta acción no se puede deshacer.`}
            confirmLabel={isSaving ? "Eliminando..." : "Eliminar"}
            isPending={isSaving}
            onCancel={() => setBranchToDelete(null)}
            onConfirm={confirmDelete}
          />
        </div>
      )}
    </HydrationGate>
  );
}
