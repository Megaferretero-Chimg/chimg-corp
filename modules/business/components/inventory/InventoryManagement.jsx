"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FileSpreadsheet,
  LoaderCircle,
  PackageSearch,
  Search,
  Upload,
  Warehouse,
} from "lucide-react";

import FloatingNotice from "@/components/ui/FloatingNotice";
import styles from "@/modules/business/styles/components/InventoryManagement.module.scss";

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("es-EC", { maximumFractionDigits }).format(Number(value) || 0);
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(status) {
  return {
    validated: "Validada",
    needs_review: "Requiere revisión",
    published: "Publicada",
    failed: "Fallida",
    processing: "Procesando",
  }[status] || status;
}

function ImportHistory({ imports, canPublish, publishingId, onPublish }) {
  if (!imports.length) return <p className={styles.emptyNote}>Todavía no se han realizado cargas.</p>;

  return (
    <div className={styles.historyList}>
      {imports.map((item) => (
        <article key={item.id} className={styles.historyItem}>
          <FileSpreadsheet size={18} />
          <div>
            <strong>{item.fileName}</strong>
            <span>{formatDateTime(item.sourceGeneratedAt)} · {statusLabel(item.status)}</span>
            {item.unknownWarehouses?.length ? <span>Bodegas desconocidas: {item.unknownWarehouses.join(", ")}</span> : null}
            {item.validationErrors?.length ? <span>{item.validationErrors[0]}</span> : null}
          </div>
          <div className={styles.historyResult}>
            <strong>{item.productCount}</strong>
            <span>productos</span>
            {canPublish && item.status === "validated" ? (
              <button type="button" onClick={() => onPublish(item.id)} disabled={publishingId === item.id}>
                {publishingId === item.id ? "Publicando..." : "Publicar"}
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export default function InventoryManagement({ canImport = false, canPublish = false }) {
  const [data, setData] = useState({
    products: [],
    pagination: { page: 1, pages: 1, total: 0 },
    summary: { productCount: 0, warehouseCount: 0, totalQuantity: 0, totalValue: 0 },
    imports: [],
    publications: [],
  });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [publishingId, setPublishingId] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState(null);
  const inputRef = useRef(null);

  const loadInventory = useCallback(async (requestedPage = page, requestedSearch = search) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(requestedPage) });
      if (requestedSearch.trim()) params.set("search", requestedSearch.trim());
      const response = await fetch(`/api/business/inventory?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo cargar el inventario.");
      setData(payload);
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    } finally {
      setIsLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadInventory(page, search);
    }, search ? 280 : 0);
    return () => window.clearTimeout(timeout);
  }, [loadInventory, page, search]);

  function selectFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setNotice({ type: "error", message: "Selecciona un archivo .xlsx o .xls." });
      return;
    }
    setSelectedFile(file);
  }

  async function importFile(event) {
    event.preventDefault();
    if (!selectedFile) return;
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("generatedAt", new Date().toISOString());
      const response = await fetch("/api/business/inventory/import", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo importar el archivo.");
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setPage(1);
      await loadInventory(1, search);
      setNotice({ type: "success", message: payload.message });
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    } finally {
      setIsImporting(false);
    }
  }

  async function publishImport(importId) {
    setPublishingId(importId);
    try {
      const response = await fetch(`/api/business/inventory/imports/${importId}/publish`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo publicar el inventario.");
      await loadInventory(1, search);
      setNotice({ type: "success", message: payload.message });
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    } finally {
      setPublishingId("");
    }
  }

  const metrics = [
    { label: "Productos", value: formatNumber(data.summary.productCount, 0), icon: PackageSearch },
    { label: "Bodegas activas", value: formatNumber(data.summary.warehouseCount, 0), icon: Warehouse },
    { label: "Unidades registradas", value: formatNumber(data.summary.totalQuantity), icon: Boxes },
    { label: "Valor de existencia", value: formatMoney(data.summary.totalValue), icon: CircleDollarSign },
  ];

  return (
    <div className={styles.stack}>
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />

      <section className={styles.metricsGrid}>
        {metrics.map(({ label, value, icon: Icon }) => (
          <article key={label} className={styles.metricCard}>
            <span><Icon size={20} /></span>
            <div><p>{label}</p><strong>{value}</strong></div>
          </article>
        ))}
      </section>

      {canImport ? <section className={styles.importPanel}>
        <form className={styles.importForm} onSubmit={importFile}>
          <label
            className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""}`}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              selectFile(event.dataTransfer.files?.[0]);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
            <FileSpreadsheet size={24} />
            <span>{selectedFile ? selectedFile.name : "Arrastra el Excel o selecciónalo"}</span>
            <small>Formatos .xlsx y .xls · máximo 15 MB</small>
          </label>
          <button type="submit" className="catalog-button-primary" disabled={!selectedFile || isImporting}>
            <Upload size={17} />
            {isImporting ? "Procesando..." : "Importar y actualizar"}
          </button>
        </form>
      </section> : null}

      <section className={styles.inventoryPanel}>
        <div className={styles.toolbar}>
          <div>
            <p className={styles.eyebrow}>Catálogo actual</p>
            <h2>{formatNumber(data.pagination.total, 0)} producto(s)</h2>
          </div>
          <label className={styles.searchField}>
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Código, descripción, marca..."
            />
          </label>
        </div>

        <div className={`${styles.tableWrap} ${isLoading ? styles.tableWrapLoading : ""}`} aria-busy={isLoading}>
          <table className={styles.table}>
            <thead><tr><th>Producto</th><th>Clasificación</th><th>Precios</th><th>Existencias por bodega</th><th>Total</th></tr></thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan="5" className={styles.loadingCell}>
                  <div className={styles.loadingState} role="status" aria-live="polite">
                    <LoaderCircle size={24} />
                    <span><strong>Cargando inventario</strong><small>Consultando productos y existencias…</small></span>
                  </div>
                </td></tr>
              ) : data.products.length ? data.products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <strong className={styles.productName}>{product.description}</strong>
                    <span className={styles.productCode}>{product.saleCode}{product.barcode ? ` · ${product.barcode}` : ""}</span>
                  </td>
                  <td>
                    <span className={styles.primaryText}>{product.brand || "Sin marca"}</span>
                    <span className={styles.secondaryText}>{[product.line, product.category, product.group].filter(Boolean).join(" · ") || "Sin clasificación"}</span>
                  </td>
                  <td>
                    <span className={styles.primaryText}>{formatMoney(product.priceWithTax || product.salePrice)}</span>
                    <span className={styles.secondaryText}>Costo {formatMoney(product.cost)}</span>
                  </td>
                  <td>
                    <div className={styles.stockList}>
                      {product.stocks.length ? product.stocks.map((stock) => (
                        <span key={stock.warehouseId} className={styles.stockBadge}>
                          {stock.warehouseName}<strong>{formatNumber(stock.quantity)}</strong>
                        </span>
                      )) : <span className={styles.secondaryText}>Sin existencias</span>}
                    </div>
                  </td>
                  <td><strong className={styles.totalStock}>{formatNumber(product.totalStock)}</strong></td>
                </tr>
              )) : (
                <tr><td colSpan="5" className={styles.emptyCell}>No hay productos que coincidan con la búsqueda.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.pagination}>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || isLoading}><ChevronLeft size={17} /> Anterior</button>
          <span>Página {data.pagination.page} de {data.pagination.pages}</span>
          <button type="button" onClick={() => setPage((value) => Math.min(data.pagination.pages, value + 1))} disabled={page >= data.pagination.pages || isLoading}>Siguiente <ChevronRight size={17} /></button>
        </div>
      </section>

      <section className={styles.historyPanel}>
        <div><p className={styles.eyebrow}>Trazabilidad</p><h2>Últimas cargas</h2></div>
        <ImportHistory
          imports={data.imports || []}
          canPublish={canPublish}
          publishingId={publishingId}
          onPublish={publishImport}
        />
      </section>

      <section className={styles.historyPanel}>
        <div><p className={styles.eyebrow}>Cajas offline</p><h2>Versiones publicadas</h2></div>
        {(data.publications || []).length ? (
          <div className={styles.historyList}>
            {data.publications.map((item) => (
              <article key={item.id} className={styles.historyItem}>
                <PackageSearch size={18} />
                <div><strong>{item.version}</strong><span>{item.checksum} · {item.status}</span></div>
                <div className={styles.historyResult}><strong>{item.productCount}</strong><span>productos</span></div>
              </article>
            ))}
          </div>
        ) : <p className={styles.emptyNote}>Todavía no hay inventario publicado para las cajas.</p>}
      </section>
    </div>
  );
}
