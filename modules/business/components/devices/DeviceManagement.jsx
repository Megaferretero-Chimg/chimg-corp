"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Laptop, RefreshCw, ShieldOff } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import styles from "@/modules/business/styles/components/DeviceManagement.module.scss";

function formatDate(value) {
  if (!value) return "Nunca";
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export default function DeviceManagement({ canManage = false }) {
  const [data, setData] = useState({ devices: [], activationCodes: [], warehouses: [] });
  const [form, setForm] = useState({ deviceName: "" });
  const [generated, setGenerated] = useState(null);
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
      setForm((current) => ({ ...current, deviceName: "" }));
      await load();
      setNotice({ type: "success", message: "Llave permanente creada. Se mostrará completa solamente ahora." });
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

  return (
    <div className={styles.stack}>
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
      <section className={styles.metrics}>
        <article><Laptop size={20} /><div><span>Equipos activos</span><strong>{activeCount}</strong></div></article>
        <article><RefreshCw size={20} /><div><span>Sincronizados</span><strong>{data.devices.filter((item) => item.lastSyncAt).length}</strong></div></article>
        <article><KeyRound size={20} /><div><span>Llaves disponibles</span><strong>{data.activationCodes.filter((item) => item.permanent && !item.usedAt && !item.revokedAt).length}</strong></div></article>
      </section>

      {canManage ? <section className={styles.activationPanel}>
        <div><p className={styles.eyebrow}>Vinculación permanente</p><h2>Crear llave para una caja</h2><p>La primera computadora que use la llave quedará ligada a este nombre y podrá consultar todas las bodegas.</p></div>
        <form onSubmit={generateCode}>
          <label><span>Nombre del equipo</span><input value={form.deviceName} onChange={(event) => setForm((current) => ({ ...current, deviceName: event.target.value }))} placeholder="CAJA AMBATO 01" required /></label>
          <button type="submit" className="catalog-button-primary" disabled={isSaving || !form.deviceName}><KeyRound size={17} /> Crear llave permanente</button>
        </form>
        {generated ? <div className={styles.generatedCode}><div><span>Llave para {generated.deviceName}</span><strong>{generated.deviceKey || generated.activationCode}</strong><small>Permanente · quedará ligada a la primera instalación</small></div><button type="button" onClick={copyCode}><Copy size={17} /> Copiar</button></div> : null}
      </section> : null}

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className={styles.eyebrow}>Cajas instaladas</p><h2>Dispositivos</h2></div><button type="button" onClick={load} disabled={isLoading}><RefreshCw size={16} /> Actualizar</button></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Equipo</th><th>Acceso</th><th>Estado</th><th>Última conexión</th><th>Inventario</th><th>Documentos</th><th /></tr></thead><tbody>
          {isLoading ? <tr><td colSpan="7">Cargando...</td></tr> : data.devices.map((item) => <tr key={item.id}>
            <td><strong>{item.deviceName}</strong><span>{item.deviceId}</span></td><td>{item.warehouseName || "TODAS LAS BODEGAS"}</td><td><span className={item.status === "active" ? styles.active : styles.revoked}>{item.status === "active" ? "Vinculado" : "Llave eliminada"}</span></td><td>{formatDate(item.lastSeenAt)}</td><td>{item.lastDownloadedVersion || "Sin descarga"}</td><td>{item.documentCount}</td><td>{canManage && item.status === "active" ? <button type="button" className={styles.revokeButton} onClick={() => setRevokeTarget(item)}><ShieldOff size={15} /> Eliminar llave</button> : null}</td>
          </tr>)}
          {!isLoading && !data.devices.length ? <tr><td colSpan="7">No hay dispositivos activados.</td></tr> : null}
        </tbody></table></div>
      </section>

      <ConfirmDialog isOpen={Boolean(revokeTarget)} title="Eliminar llave" message={`La caja ${revokeTarget?.deviceName || ""} perderá acceso y dejará de sincronizar. Para volver a usarla será necesario crear y vincular una llave nueva.`} confirmLabel="Eliminar llave" isPending={isSaving} onCancel={() => setRevokeTarget(null)} onConfirm={revoke} />
    </div>
  );
}
