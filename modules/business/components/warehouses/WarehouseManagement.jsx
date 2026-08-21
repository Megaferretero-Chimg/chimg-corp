"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit3, MapPin, Plus, Search, Trash2, Warehouse } from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import styles from "@/modules/business/styles/components/WarehouseManagement.module.scss";

const EMPTY_FORM = { name: "", location: "", sourceNames: "", isActive: true };

export default function WarehouseManagement({ canManage = false }) {
  const [warehouses, setWarehouses] = useState([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setEditingId("");
    setForm(EMPTY_FORM);
  }, []);

  const loadWarehouses = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/business/warehouses");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudieron cargar las bodegas.");
      setWarehouses(payload.warehouses || []);
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/business/warehouses")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "No se pudieron cargar las bodegas.");
        return payload;
      })
      .then((payload) => {
        if (!cancelled) setWarehouses(payload.warehouses || []);
      })
      .catch((error) => {
        if (!cancelled) setNotice({ type: "error", message: error.message });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return warehouses;
    return warehouses.filter((item) => [item.code, item.name, item.location, ...(item.sourceNames || [])]
      .join(" ").toLowerCase().includes(value));
  }, [search, warehouses]);

  function openCreate() {
    setEditingId("");
    setForm(EMPTY_FORM);
    setIsDrawerOpen(true);
  }

  function openEdit(item) {
    setEditingId(item.id);
    setForm({
      name: item.name || "",
      location: item.location || "",
      sourceNames: (item.sourceNames || []).filter((alias) => alias !== item.name).join(", "),
      isActive: item.isActive !== false,
    });
    setIsDrawerOpen(true);
  }

  async function saveWarehouse(event) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const response = await fetch(editingId ? `/api/business/warehouses/${editingId}` : "/api/business/warehouses", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo guardar la bodega.");
      await loadWarehouses();
      closeDrawer();
      setNotice({ type: "success", message: editingId ? "Bodega actualizada correctamente." : "Bodega creada correctamente." });
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteWarehouse() {
    if (!deleteTarget) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/business/warehouses/${deleteTarget.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo eliminar la bodega.");
      setDeleteTarget(null);
      await loadWarehouses();
      setNotice({ type: "success", message: "Bodega eliminada correctamente." });
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={styles.stack}>
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <div><p className={styles.eyebrow}>Ubicaciones de inventario</p><h2>{filtered.length} bodega(s)</h2></div>
          <label className={styles.search}><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar bodega" /></label>
          {canManage ? <button type="button" className="catalog-button-primary" onClick={openCreate}><Plus size={17} /> Crear bodega</button> : null}
        </div>

        <div className={styles.grid}>
          {isLoading ? <p className={styles.empty}>Cargando bodegas...</p> : filtered.map((item) => (
            <article key={item.id} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.icon}><Warehouse size={21} /></span>
                <span className={`${styles.status} ${item.isActive ? styles.active : styles.inactive}`}>{item.isActive ? "Activa" : "Inactiva"}</span>
              </div>
              <div><span className={styles.code}>{item.code}</span><h3>{item.name}</h3></div>
              <p className={styles.location}><MapPin size={15} /> {item.location || "Ubicación no especificada"}</p>
              <div className={styles.stats}><span><strong>{item.productCount}</strong> productos</span><span><strong>{new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 }).format(item.totalQuantity)}</strong> unidades</span></div>
              <div className={styles.aliases}><span>Alias del Excel</span><p>{(item.sourceNames || []).join(", ") || item.name}</p></div>
              {canManage ? <div className={styles.actions}>
                <button type="button" onClick={() => openEdit(item)}><Edit3 size={16} /> Editar</button>
                <button type="button" className={styles.deleteButton} onClick={() => setDeleteTarget(item)}><Trash2 size={16} /> Eliminar</button>
              </div> : null}
            </article>
          ))}
          {!isLoading && !filtered.length ? <p className={styles.empty}>No hay bodegas que coincidan con la búsqueda.</p> : null}
        </div>
      </section>

      <CatalogDrawer isOpen={isDrawerOpen} eyebrow="Inventario" title={editingId ? "Editar bodega" : "Nueva bodega"} onClose={closeDrawer}>
        <form className={styles.form} onSubmit={saveWarehouse}>
          <label><span>Nombre</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. Bodega Quito" required /></label>
          <label><span>Ubicación</span><input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="Ciudad o referencia" /></label>
          <label><span>Alias usados en el Excel</span><textarea value={form.sourceNames} onChange={(event) => setForm((current) => ({ ...current, sourceNames: event.target.value }))} placeholder="Separados por comas" rows="3" /></label>
          <label className={styles.switchRow}><span>Estado</span><button type="button" className={`catalog-switch ${form.isActive ? "is-active" : ""}`} onClick={() => setForm((current) => ({ ...current, isActive: !current.isActive }))}><span className="catalog-switchKnob" />{form.isActive ? "Activa" : "Inactiva"}</button></label>
          <div className="catalog-actions catalog-actions-end"><button type="button" className="catalog-button-ghost" onClick={closeDrawer}>Cancelar</button><button type="submit" className="catalog-button-primary" disabled={isSaving || !form.name.trim()}>{isSaving ? "Guardando..." : editingId ? "Actualizar" : "Crear"}</button></div>
        </form>
      </CatalogDrawer>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Eliminar bodega"
        message={`¿Deseas eliminar ${deleteTarget?.name || "esta bodega"}? Solo es posible si no tiene existencias asociadas.`}
        confirmLabel="Eliminar"
        isPending={isSaving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={deleteWarehouse}
      />
    </div>
  );
}
