"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Laptop, RefreshCw, ShieldOff } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import FloatingModal from "@/components/ui/FloatingModal";
import styles from "@/modules/business/styles/components/DeviceManagement.module.scss";

function formatDate(value) {
  if (!value) return "Nunca";
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export default function DeviceManagement({ canManage = false }) {
  const [data, setData] = useState({ devices: [], activationCodes: [], warehouses: [] });
  const [form, setForm] = useState({ deviceName: "" });
  const [generated, setGenerated] = useState(null);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/business/devices");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudieron cargar los equipos.");
      setData(payload);
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(load, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const activeCount = useMemo(() => data.devices.filter((item) => item.status === "active").length, [data.devices]);

  async function generateCode(event) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const response = await fetch("/api/business/devices/activation-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo generar la llave.");
      setGenerated(payload);
      await load();
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    } finally {
      setIsSaving(false);
    }
  }

  async function revoke() {
    if (!revokeTarget) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/business/devices/${revokeTarget.id}/revoke`, { method: "PATCH" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo eliminar la llave del equipo.");
      setRevokeTarget(null);
      await load();
      setNotice({ type: "success", message: "Llave eliminada. El equipo perdió acceso." });
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    } finally {
      setIsSaving(false);
    }
  }

  async function copyCode() {
    const deviceKey = generated?.deviceKey || generated?.activationCode;
    if (!deviceKey) return;
    await navigator.clipboard.writeText(deviceKey);
    setNotice({ type: "success", message: "Llave copiada." });
  }

  function openKeyModal() {
    setForm({ deviceName: "" });
    setGenerated(null);
    setIsKeyModalOpen(true);
  }

  function closeKeyModal() {
    if (isSaving) return;
    setIsKeyModalOpen(false);
    setGenerated(null);
    setForm({ deviceName: "" });
  }

  return (
    <div className={styles.stack}>
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
      <section className={styles.metrics}>
        <article><Laptop size={20} /><div><span>Equipos activos</span><strong>{activeCount}</strong></div></article>
        <article><RefreshCw size={20} /><div><span>Sincronizados</span><strong>{data.devices.filter((item) => item.lastSyncAt).length}</strong></div></article>
        <article><KeyRound size={20} /><div><span>Llaves disponibles</span><strong>{data.activationCodes.filter((item) => item.permanent && !item.usedAt && !item.revokedAt).length}</strong></div></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className={styles.eyebrow}>Cajas instaladas</p><h2>Dispositivos</h2></div><div className={styles.panelActions}>{canManage ? <button type="button" className={styles.createKeyButton} onClick={openKeyModal}><KeyRound size={16} /> Crear llave</button> : null}<button type="button" onClick={load} disabled={isLoading}><RefreshCw size={16} /> Actualizar</button></div></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Equipo</th><th>Estado</th><th>Última conexión</th><th className={styles.actionsColumn}>Acciones</th></tr></thead><tbody>
          {isLoading ? <tr><td colSpan="4"><div className={styles.loadingState} role="status" aria-live="polite"><RefreshCw size={20} aria-hidden="true" /><span><strong>Cargando dispositivos</strong><small>Consultando el estado de las cajas</small></span></div></td></tr> : data.devices.map((item) => <tr key={item.id}>
            <td><strong>{item.deviceName}</strong></td><td><span className={item.status === "active" ? styles.active : styles.revoked}>{item.status === "active" ? "Vinculado" : "Llave eliminada"}</span></td><td>{formatDate(item.lastSeenAt)}</td><td className={styles.actionsCell}>{canManage && item.status === "active" ? <button type="button" className={styles.revokeButton} onClick={() => setRevokeTarget(item)} aria-label={`Eliminar llave de ${item.deviceName}`} title="Eliminar llave"><ShieldOff size={15} /></button> : null}</td>
          </tr>)}
          {!isLoading && !data.devices.length ? <tr><td colSpan="4">No hay dispositivos vinculados.</td></tr> : null}
        </tbody></table></div>
      </section>

      <FloatingModal isOpen={isKeyModalOpen} title={generated ? "Llave creada" : "Crear llave"} isPending={isSaving} onClose={closeKeyModal}>
        {generated ? <div className={styles.keyResult}><span>Llave para {generated.deviceName}</span><strong>{generated.deviceKey || generated.activationCode}</strong><div><button type="button" className="catalog-button-ghost" onClick={copyCode}><Copy size={16} /> Copiar</button><button type="button" className="catalog-button-primary" onClick={closeKeyModal}>Listo</button></div></div>
          : <form className={styles.keyForm} onSubmit={generateCode}><label><span>Nombre del equipo</span><input autoFocus value={form.deviceName} onChange={(event) => setForm({ deviceName: event.target.value })} placeholder="CAJA AMBATO 01" required /></label><div><button type="button" className="catalog-button-ghost" onClick={closeKeyModal}>Cancelar</button><button type="submit" className="catalog-button-primary" disabled={isSaving || !form.deviceName.trim()}><KeyRound size={16} /> {isSaving ? "Creando…" : "Crear llave"}</button></div></form>}
      </FloatingModal>

      <ConfirmDialog isOpen={Boolean(revokeTarget)} title="Eliminar llave" message={`La caja ${revokeTarget?.deviceName || ""} perderá acceso y dejará de sincronizar. Para volver a usarla será necesario crear y vincular una llave nueva.`} confirmLabel="Eliminar llave" isPending={isSaving} onCancel={() => setRevokeTarget(null)} onConfirm={revoke} />
    </div>
  );
}
