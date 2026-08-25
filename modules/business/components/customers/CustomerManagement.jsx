"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, ChevronLeft, ChevronRight, FileSpreadsheet, LoaderCircle, MapPin, Search, Upload, UserRound, Users } from "lucide-react";

import FloatingNotice from "@/components/ui/FloatingNotice";
import styles from "@/modules/business/styles/components/InventoryManagement.module.scss";

const EMPTY_DATA = { customers: [], pagination: { page: 1, pages: 1, total: 0 }, summary: { customerCount: 0, personCount: 0, companyCount: 0, cityCount: 0 }, imports: [], publications: [] };
const number = (value) => new Intl.NumberFormat("es-EC").format(Number(value) || 0);

export default function CustomerManagement({ canImport = false, canPublish = false }) {
  const [data, setData] = useState(EMPTY_DATA);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [publishingId, setPublishingId] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async (requestedPage = page, requestedSearch = search) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(requestedPage) });
      if (requestedSearch.trim()) params.set("search", requestedSearch.trim());
      const response = await fetch(`/api/business/customers?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudieron cargar los clientes.");
      setData(payload);
    } catch (error) { setNotice({ type: "error", message: error.message }); }
    finally { setIsLoading(false); }
  }, [page, search]);

  useEffect(() => { const timeout = window.setTimeout(() => load(page, search), search ? 280 : 0); return () => window.clearTimeout(timeout); }, [load, page, search]);

  function selectFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) return setNotice({ type: "error", message: "Selecciona un archivo .xlsx o .xls." });
    setSelectedFile(file);
  }

  async function importFile(event) {
    event.preventDefault();
    if (!selectedFile) return;
    setIsImporting(true);
    try {
      const formData = new FormData(); formData.append("file", selectedFile);
      const response = await fetch("/api/business/customers/import", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo importar el archivo.");
      setSelectedFile(null); if (inputRef.current) inputRef.current.value = "";
      setPage(1); await load(1, search); setNotice({ type: "success", message: payload.message });
    } catch (error) { setNotice({ type: "error", message: error.message }); }
    finally { setIsImporting(false); }
  }

  async function publish(importId) {
    setPublishingId(importId);
    try {
      const response = await fetch(`/api/business/customers/imports/${importId}/publish`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudieron publicar los clientes.");
      await load(1, search); setNotice({ type: "success", message: payload.message });
    } catch (error) { setNotice({ type: "error", message: error.message }); }
    finally { setPublishingId(""); }
  }

  const metrics = [
    ["Clientes", data.summary.customerCount, Users], ["Personas", data.summary.personCount, UserRound],
    ["Empresas", data.summary.companyCount, Building2], ["Ciudades", data.summary.cityCount, MapPin],
  ];

  return <div className={styles.stack}>
    <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
    <section className={styles.metricsGrid}>{metrics.map(([label, value, Icon]) => <article key={label} className={styles.metricCard}><span><Icon size={20} /></span><div><p>{label}</p><strong>{number(value)}</strong></div></article>)}</section>
    {canImport ? <section className={styles.importPanel}>
      <form className={styles.importForm} onSubmit={importFile}>
        <label className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""}`} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={(event) => { event.preventDefault(); setIsDragging(false); selectFile(event.dataTransfer.files[0]); }}>
          <FileSpreadsheet size={22} /><span>{selectedFile?.name || "Arrastra el Excel o selecciónalo"}</span><small>Formatos .xlsx y .xls · máximo 15 MB</small><input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={(event) => selectFile(event.target.files?.[0])} />
        </label>
        <button type="submit" className="catalog-button-primary" disabled={!selectedFile || isImporting}><Upload size={17} /> {isImporting ? "Importando…" : "Importar clientes"}</button>
      </form>
    </section> : null}
    <section className={styles.inventoryPanel}>
      <div className={styles.toolbar}><div><p className={styles.eyebrow}>Catálogo actual</p><h2>{number(data.pagination.total)} cliente(s)</h2></div><label className={styles.searchField}><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Identificación, nombre, ciudad…" /></label></div>
      <div className={`${styles.tableWrap} ${isLoading ? styles.tableWrapLoading : ""}`} aria-busy={isLoading}><table className={styles.table}><thead><tr><th>Identificación</th><th>Cliente</th><th>Tipo</th><th>Contacto</th><th>Ciudad y zona</th></tr></thead><tbody>
        {isLoading ? <tr><td colSpan="5" className={styles.loadingCell}><div className={styles.loadingState} role="status"><LoaderCircle size={24} /><span><strong>Cargando clientes</strong><small>Consultando el catálogo publicado…</small></span></div></td></tr> : data.customers.map((customer) => <tr key={customer.id}>
          <td><strong className={styles.primaryText}>{customer.identification}</strong><span className={styles.secondaryText}>{customer.identificationType}</span></td>
          <td><strong className={styles.productName}>{customer.name}</strong><span className={styles.productCode}>{[customer.firstNames, customer.lastNames].filter(Boolean).join(" ")}</span></td>
          <td><span className={styles.primaryText}>{customer.customerType}</span></td>
          <td><span className={styles.primaryText}>{customer.phone || "Sin teléfono"}</span><span className={styles.secondaryText}>{customer.email || "Sin correo"}</span></td>
          <td><span className={styles.primaryText}>{customer.city || "Sin ciudad"}</span><span className={styles.secondaryText}>{customer.zone || "Sin zona"}</span></td>
        </tr>)}
        {!isLoading && !data.customers.length ? <tr><td colSpan="5" className={styles.emptyCell}>No hay clientes para mostrar.</td></tr> : null}
      </tbody></table></div>
      <div className={styles.pagination}><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || isLoading}><ChevronLeft size={17} /> Anterior</button><span>Página {page} de {data.pagination.pages}</span><button type="button" onClick={() => setPage((value) => Math.min(data.pagination.pages, value + 1))} disabled={page >= data.pagination.pages || isLoading}>Siguiente <ChevronRight size={17} /></button></div>
    </section>
    <section className={styles.historyPanel}><div><p className={styles.eyebrow}>Trazabilidad</p><h2>Últimas cargas</h2></div><div className={styles.historyList}>{data.imports.map((item) => <div key={item.id} className={styles.historyItem}><FileSpreadsheet size={18} /><div><strong>{item.fileName}</strong><span>{item.customerCount} clientes · {item.status}</span></div><div className={styles.historyResult}>{canPublish && item.status === "validated" ? <button type="button" onClick={() => publish(item.id)} disabled={publishingId === item.id}>{publishingId === item.id ? "Publicando…" : "Publicar"}</button> : <strong>{item.publishedVersion || "—"}</strong>}</div></div>)}</div></section>
  </div>;
}
