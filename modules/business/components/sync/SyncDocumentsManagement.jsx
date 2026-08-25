"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, LoaderCircle, Search, UserRoundPlus, Waypoints } from "lucide-react";

import FloatingNotice from "@/components/ui/FloatingNotice";
import SelectInput from "@/components/ui/SelectInput";
import styles from "@/modules/business/styles/components/SyncDocumentsManagement.module.scss";

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
}

function money(value) {
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(Number(value) || 0);
}

export default function SyncDocumentsManagement({ canManage = false }) {
  const [data, setData] = useState({ guides: [], pendingCustomers: [] });
  const [filters, setFilters] = useState({ search: "", status: "", warehouse: "" });
  const [tab, setTab] = useState("guides");
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      const response = await fetch(`/api/business/sync/documents?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudieron cargar los documentos.");
      setData(payload);
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timeout = window.setTimeout(load, filters.search ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [load, filters.search]);

  async function updateStatus(type, id, status) {
    try {
      const response = await fetch(`/api/business/sync/documents/${type}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo actualizar el estado.");
      await load();
      setNotice({ type: "success", message: "Estado actualizado." });
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    }
  }

  const items = tab === "guides" ? data.guides : data.pendingCustomers;

  return (
    <div className={styles.stack}>
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
      <section className={styles.summary}>
        <article><Waypoints size={20} /><div><span>Guías recibidas</span><strong>{data.guides.length}</strong></div></article>
        <article><UserRoundPlus size={20} /><div><span>Clientes pendientes</span><strong>{data.pendingCustomers.length}</strong></div></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <div className={styles.tabs}><button type="button" className={tab === "guides" ? styles.activeTab : ""} onClick={() => setTab("guides")}>Guías</button><button type="button" className={tab === "customers" ? styles.activeTab : ""} onClick={() => setTab("customers")}>Clientes pendientes</button></div>
          <label><Search size={16} /><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Buscar documento" /></label>
          <SelectInput
            value={filters.status}
            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            className={styles.filterSelectField}
            controlClassName={styles.filterSelectControl}
            selectClassName={styles.filterSelectButton}
            menuClassName={styles.filterSelectMenu}
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            <option value="pending">Pendiente</option>
            <option value="processed">Procesado</option>
            <option value="rejected">Rechazado</option>
          </SelectInput>
          {tab === "guides" ? (
            <SelectInput
              value={filters.warehouse}
              onChange={(event) => setFilters((current) => ({ ...current, warehouse: event.target.value }))}
              className={styles.filterSelectField}
              controlClassName={styles.filterSelectControl}
              selectClassName={styles.filterSelectButton}
              menuClassName={styles.filterSelectMenu}
              aria-label="Filtrar por bodega"
            >
              <option value="">Todas las bodegas</option>
              <option>ALMACÉN AMBATO</option>
              <option>ALMACÉN SALCEDO</option>
              <option>INTERNA</option>
              <option>EXTERNA</option>
            </SelectInput>
          ) : null}
        </div>

        <div className={`${styles.list} ${isLoading ? styles.listLoading : ""}`} aria-busy={isLoading}>
          {isLoading ? <div className={styles.loadingState} role="status" aria-live="polite"><LoaderCircle size={24} aria-hidden="true" /><span><strong>Cargando documentos</strong><small>Consultando la información recibida…</small></span></div> : items.map((item) => (
            <details key={item.id} className={styles.item}>
              <summary>
                <span className={styles.itemIcon}>{tab === "guides" ? <Waypoints size={18} /> : <UserRoundPlus size={18} />}</span>
                <div><strong>{tab === "guides" ? item.internalNumber : item.name}</strong><span>{tab === "guides" ? `${item.customerName} · ${item.warehouse}` : `${item.identification} · ${item.city}`}</span></div>
                <div><strong>{tab === "guides" ? money(item.total) : item.deviceId.slice(0, 8)}</strong><span>{formatDate(item.receivedAt)}</span></div>
                <ChevronDown size={17} />
              </summary>
              <div className={styles.detail}>
                <div><span>UUID de sincronización</span><strong>{item.syncUuid}</strong><span>Equipo</span><strong>{item.deviceId}</strong><span>Creado localmente</span><strong>{formatDate(item.localCreatedAt)}</strong></div>
                <pre>{JSON.stringify(item.snapshot, null, 2)}</pre>
                {canManage ? <div className={styles.actions}><button type="button" onClick={() => updateStatus(tab, item.id, "pending")}>Pendiente</button><button type="button" onClick={() => updateStatus(tab, item.id, "processed")}>Procesado</button><button type="button" onClick={() => updateStatus(tab, item.id, "rejected")}>Rechazado</button></div> : null}
              </div>
            </details>
          ))}
          {!isLoading && !items.length ? <p className={styles.empty}>No hay documentos para los filtros seleccionados.</p> : null}
        </div>
      </section>
    </div>
  );
}
