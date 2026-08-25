import {
  ArrowRight,
  Boxes,
  CircleDollarSign,
  DatabaseZap,
  FileCheck2,
  Laptop,
  PackageSearch,
  Users,
  Warehouse as WarehouseIcon,
} from "lucide-react";

import TransitionLink from "@/components/navigation/TransitionLink";
import ModuleShell from "@/components/shell/ModuleShell";
import { requireAuthenticatedUser } from "@/lib/access-control";
import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessModuleForUser } from "@/modules/business/module";
import {
  Device,
  Customer,
  CustomerPublication,
  InventoryPublication,
  InventoryStock,
  PendingCustomer,
  Product,
  SyncGuide,
  Warehouse,
} from "@/modules/business/models";
import { businessModulePath } from "@/modules/business/routes";
import styles from "@/modules/business/styles/pages/home-page.module.scss";

export const dynamic = "force-dynamic";

export const metadata = { title: "Negocio | Control de Asistencia" };

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("es-EC", { maximumFractionDigits }).format(Number(value) || 0);
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "Sin publicaciones";
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function getBusinessSnapshot() {
  await connectToDatabase();

  const [productCount, warehouses, stockByWarehouse, devices, publication, guideCount, pendingCustomerCount, customerCount, customerPublication] = await Promise.all([
    Product.countDocuments({}),
    Warehouse.find({ isActive: { $ne: false } }).select("name code").sort({ name: 1 }).lean(),
    InventoryStock.aggregate([
      { $group: { _id: "$warehouse", productCount: { $sum: 1 }, quantity: { $sum: "$quantity" }, value: { $sum: "$totalValue" } } },
    ]),
    Device.find({ status: "active" }).select("lastDownloadedVersion lastSyncAt lastSeenAt").lean(),
    InventoryPublication.findOne({ status: "published" }).sort({ publishedAt: -1 }).lean(),
    SyncGuide.countDocuments({}),
    PendingCustomer.countDocuments({}),
    Customer.countDocuments({ isActive: { $ne: false } }),
    CustomerPublication.findOne({ status: "published" }).sort({ publishedAt: -1 }).lean(),
  ]);

  const stockMap = new Map(stockByWarehouse.map((item) => [item._id.toString(), item]));
  const warehouseSummary = warehouses.map((warehouse) => {
    const stock = stockMap.get(warehouse._id.toString());
    return {
      id: warehouse._id.toString(),
      name: warehouse.name,
      code: warehouse.code,
      productCount: stock?.productCount || 0,
      quantity: stock?.quantity || 0,
      value: stock?.value || 0,
    };
  }).sort((left, right) => right.quantity - left.quantity);

  const totals = warehouseSummary.reduce((summary, warehouse) => ({
    quantity: summary.quantity + warehouse.quantity,
    value: summary.value + warehouse.value,
  }), { quantity: 0, value: 0 });
  const currentVersion = publication?.version || "";

  return {
    productCount,
    warehouseSummary,
    totals,
    publication,
    activeDevices: devices.length,
    updatedDevices: currentVersion
      ? devices.filter((device) => device.lastDownloadedVersion === currentVersion).length
      : 0,
    connectedDevices: devices.filter((device) => device.lastSeenAt).length,
    guideCount,
    customerCount,
    pendingCustomerCount,
    customerPublication,
  };
}

function MetricCard({ icon: Icon, label, value, help }) {
  return (
    <article className={styles.metricCard}>
      <span className={styles.metricIcon}><Icon size={20} /></span>
      <div><span className={styles.metricLabel}>{label}</span><strong>{value}</strong><small>{help}</small></div>
    </article>
  );
}

export default async function BusinessHomePage() {
  const user = await requireAuthenticatedUser();
  const snapshot = await getBusinessSnapshot();
  const maxWarehouseQuantity = Math.max(...snapshot.warehouseSummary.map((item) => item.quantity), 1);

  return (
    <ModuleShell
      moduleConfig={getBusinessModuleForUser(user)}
      title="Negocio"
      description="Resumen del inventario y de la operación de contingencia."
    >
      <div className={styles.page}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Resumen operativo</p>
            <h2>Estado general del inventario</h2>
            <p>Consulta existencias, bodegas y cajas sincronizadas desde una sola vista.</p>
          </div>
          <div className={styles.heroStatus}>
            <DatabaseZap size={18} />
            <span>{snapshot.publication ? `Versión ${snapshot.publication.version}` : "Sin versión publicada"}</span>
          </div>
        </section>

        <section className={styles.metrics}>
          <MetricCard icon={PackageSearch} label="Productos" value={formatNumber(snapshot.productCount)} help="en el catálogo actual" />
          <MetricCard icon={WarehouseIcon} label="Bodegas activas" value={formatNumber(snapshot.warehouseSummary.length)} help="ubicaciones disponibles" />
          <MetricCard icon={Boxes} label="Unidades" value={formatNumber(snapshot.totals.quantity, 2)} help="existencia consolidada" />
          <MetricCard icon={CircleDollarSign} label="Valor de existencia" value={formatMoney(snapshot.totals.value)} help="según la última carga" />
        </section>

        <section className={styles.mainGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div><p className={styles.eyebrow}>Distribución</p><h3>Existencias por bodega</h3></div>
              <TransitionLink href={businessModulePath("/warehouses")}>Ver bodegas <ArrowRight size={15} /></TransitionLink>
            </div>
            <div className={styles.warehouseList}>
              {snapshot.warehouseSummary.length ? snapshot.warehouseSummary.map((warehouse) => (
                <div key={warehouse.id} className={styles.warehouseRow}>
                  <div><strong>{warehouse.name}</strong><span>{formatNumber(warehouse.productCount)} productos</span></div>
                  <strong>{formatNumber(warehouse.quantity, 2)}</strong>
                  <div className={styles.track} aria-hidden="true"><span style={{ width: `${Math.max((warehouse.quantity / maxWarehouseQuantity) * 100, 4)}%` }} /></div>
                </div>
              )) : <p className={styles.empty}>Todavía no hay bodegas con existencias.</p>}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}><div><p className={styles.eyebrow}>Actividad</p><h3>Lo que está sucediendo</h3></div></div>
            <div className={styles.activityList}>
              <TransitionLink href={businessModulePath("/inventory")} className={styles.activityItem}>
                <span><FileCheck2 size={18} /></span>
                <div><strong>Inventario publicado</strong><small>{snapshot.publication ? `${snapshot.publication.productCount} productos · ${formatDate(snapshot.publication.publishedAt)}` : "Aún no existe una publicación"}</small></div>
                <ArrowRight size={16} />
              </TransitionLink>
              <TransitionLink href={businessModulePath("/devices")} className={styles.activityItem}>
                <span><Laptop size={18} /></span>
                <div><strong>{snapshot.updatedDevices} de {snapshot.activeDevices} cajas actualizadas</strong><small>{snapshot.connectedDevices} dispositivos han establecido conexión</small></div>
                <ArrowRight size={16} />
              </TransitionLink>
              <TransitionLink href={businessModulePath("/sync")} className={styles.activityItem}>
                <span><DatabaseZap size={18} /></span>
                <div><strong>{snapshot.guideCount} documentos recibidos</strong><small>{snapshot.pendingCustomerCount} clientes pendientes de revisión</small></div>
                <ArrowRight size={16} />
              </TransitionLink>
              <TransitionLink href={businessModulePath("/customers")} className={styles.activityItem}>
                <span><Users size={18} /></span>
                <div><strong>{snapshot.customerCount} clientes maestros</strong><small>{snapshot.customerPublication ? `Versión ${snapshot.customerPublication.version} publicada` : "Catálogo pendiente de publicar"}</small></div>
                <ArrowRight size={16} />
              </TransitionLink>
            </div>
          </section>
        </section>

        <section className={styles.quickLinks}>
          <span>Accesos rápidos</span>
          <div>
            <TransitionLink href={businessModulePath("/inventory")}><PackageSearch size={15} /> Inventario</TransitionLink>
            <TransitionLink href={businessModulePath("/warehouses")}><WarehouseIcon size={15} /> Bodegas</TransitionLink>
            <TransitionLink href={businessModulePath("/devices")}><Laptop size={15} /> Dispositivos</TransitionLink>
            <TransitionLink href={businessModulePath("/customers")}><Users size={15} /> Clientes</TransitionLink>
          </div>
        </section>
      </div>
    </ModuleShell>
  );
}
