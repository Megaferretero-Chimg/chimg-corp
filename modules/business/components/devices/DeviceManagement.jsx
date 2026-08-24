"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Laptop, RefreshCw, ShieldOff, Warehouse } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import styles from "@/modules/business/styles/components/DeviceManagement.module.scss";

function formatDate(value) {
  if (!value) return "Nunca";
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export default function DeviceManagement({ canManage = false }) {
  const [data, setData] = useState({ devices: [], activationCodes: [], warehouses: [] });
  const [form, setForm] = useState({ deviceName: "", warehouseId: "", expiresInMinutes: 60 });
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
      setForm((current) => ({ ...current, warehouseId: current.warehouseId || payload.warehouses?.[0]?.id || "" }));
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
      if (!response.ok) throw new Error(payload.error || "No se pudo generar el código.");
      setGenerated(payload);
      setForm((current) => ({ ...current, deviceName: "" }));
      await load();
      setNotice({ type: "success", message: "Código generado. Se mostrará completo solamente ahora." });
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
      if (!response.ok) throw new Error(payload.error || "No se pudo revocar el equipo.");
      setRevokeTarget(null);
      await load();
      setNotice({ type: "success", message: "Dispositivo revocado." });
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    } finally {
      setIsSaving(false);
    }
  }

  async function copyCode() {
    if (!generated?.activationCode) return;
    await navigator.clipboard.writeText(generated.activationCode);
    setNotice({ type: "success", message: "Código copiado." });
  }

  return (
    <div className={styles.stack}>
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
      <section className={styles.metrics}>
        <article><Laptop size={20} /><div><span>Equipos activos</span><strong>{activeCount}</strong></div></article>
        <article><RefreshCw size={20} /><div><span>Sincronizados</span><strong>{data.devices.filter((item) => item.lastSyncAt).length}</strong></div></article>
        <article><KeyRound size={20} /><div><span>Códigos pendientes</span><strong>{data.activationCodes.filter((item) => !item.usedAt && new Date(item.expiresAt) > new Date()).length}</strong></div></article>
      </section>

      {canManage ? <section className={styles.activationPanel}>
        <div><p className={styles.eyebrow}>Activación segura</p><h2>Generar código de un solo uso</h2><p>Asigna primero el nombre y la bodega que tendrá la caja.</p></div>
        <form onSubmit={generateCode}>
          <label><span>Nombre del equipo</span><input value={form.deviceName} onChange={(event) => setForm((current) => ({ ...current, deviceName: event.target.value }))} placeholder="CAJA AMBATO 01" required /></label>
          <label><span>Bodega</span><select value={form.warehouseId} onChange={(event) => setForm((current) => ({ ...current, warehouseId: event.target.value }))} required>{data.warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Vigencia</span><select value={form.expiresInMinutes} onChange={(event) => setForm((current) => ({ ...current, expiresInMinutes: Number(event.target.value) }))}><option value="30">30 minutos</option><option value="60">1 hora</option><option value="240">4 horas</option><option value="1440">24 horas</option></select></label>
          <button type="submit" className="catalog-button-primary" disabled={isSaving || !form.deviceName || !form.warehouseId}><KeyRound size={17} /> Generar código</button>
        </form>
        {generated ? <div className={styles.generatedCode}><div><span>Código para {generated.deviceName}</span><strong>{generated.activationCode}</strong><small>Vence {formatDate(generated.expiresAt)}</small></div><button type="button" onClick={copyCode}><Copy size={17} /> Copiar</button></div> : null}
      </section> : null}

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className={styles.eyebrow}>Cajas instaladas</p><h2>Dispositivos</h2></div><button type="button" onClick={load} disabled={isLoading}><RefreshCw size={16} /> Actualizar</button></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Equipo</th><th>Bodega</th><th>Estado</th><th>Última conexión</th><th>Inventario</th><th>Documentos</th><th /></tr></thead><tbody>
          {isLoading ? <tr><td colSpan="7">Cargando...</td></tr> : data.devices.map((item) => <tr key={item.id}>
            <td><strong>{item.deviceName}</strong><span>{item.deviceId}</span></td><td><Warehouse size={14} /> {item.warehouseName}</td><td><span className={item.status === "active" ? styles.active : styles.revoked}>{item.status === "active" ? "Activo" : "Revocado"}</span></td><td>{formatDate(item.lastSeenAt)}</td><td>{item.lastDownloadedVersion || "Sin descarga"}</td><td>{item.documentCount}</td><td>{canManage && item.status === "active" ? <button type="button" className={styles.revokeButton} onClick={() => setRevokeTarget(item)}><ShieldOff size={15} /> Revocar</button> : null}</td>
          </tr>)}
          {!isLoading && !data.devices.length ? <tr><td colSpan="7">No hay dispositivos activados.</td></tr> : null}
        </tbody></table></div>
      </section>

      <ConfirmDialog isOpen={Boolean(revokeTarget)} title="Revocar dispositivo" message={`La caja ${revokeTarget?.deviceName || ""} perderá acceso inmediatamente.`} confirmLabel="Revocar" isPending={isSaving} onCancel={() => setRevokeTarget(null)} onConfirm={revoke} />
    </div>
  );
}
