import {
  BadgeCheck,
  Building2,
  Fingerprint,
  Layers3,
  Network,
  ShieldUser,
  Users,
} from "lucide-react";

import ModuleShell from "@/components/shell/ModuleShell";
import TransitionLink from "@/components/navigation/TransitionLink";
import { requireAuthenticatedUser } from "@/lib/access-control";
import connectToDatabase from "@/lib/db/mongodb";
import { getCompanyModuleForUser } from "@/modules/company/module";
import { companyModulePath } from "@/modules/company/routes";
import { Area, Branch, Employee, Role } from "@/modules/company/models";
import styles from "@/modules/company/submodules/organization/styles/pages/organization-page.module.scss";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Empresa | Resumen organizacional",
};

function formatNumber(value) {
  return new Intl.NumberFormat("es-EC").format(value || 0);
}

function percent(value, total) {
  if (!total) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

function normalizeLabel(value, fallback) {
  return String(value || "").trim() || fallback;
}

function countBy(items, getLabel) {
  const counts = new Map();

  for (const item of items) {
    const label = getLabel(item);
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

async function getOrganizationSnapshot() {
  await connectToDatabase();

  const [employees, branches, areas, roles] = await Promise.all([
    Employee.find({})
      .select("fullName isActive branchName branch areaName department roleName dni biometricCode")
      .lean(),
    Branch.find({}).sort({ name: 1 }).lean(),
    Area.find({}).sort({ name: 1 }).lean(),
    Role.find({}).sort({ areaName: 1, name: 1 }).lean(),
  ]);

  const activeEmployees = employees.filter((employee) => employee.isActive !== false);
  const inactiveEmployees = employees.length - activeEmployees.length;
  const withDni = employees.filter((employee) => String(employee.dni || "").trim()).length;
  const withBiometric = employees.filter((employee) => String(employee.biometricCode || "").trim()).length;
  const assignedToBranch = employees.filter((employee) =>
    String(employee.branchName || employee.branch || "").trim(),
  ).length;

  const employeesByArea = countBy(activeEmployees, (employee) =>
    normalizeLabel(employee.areaName || employee.department, "Sin área asignada"),
  );
  const employeesByRole = countBy(activeEmployees, (employee) =>
    normalizeLabel(employee.roleName, "Sin cargo asignado"),
  );
  const employeesByBranch = countBy(activeEmployees, (employee) =>
    normalizeLabel(employee.branchName || employee.branch, "Sin sucursal asignada"),
  );

  const rolesByArea = areas.map((area) => {
    const areaName = area.name || "Área sin nombre";
    const roleCount = roles.filter((role) => role.areaCode === area.code || role.areaName === areaName).length;
    const employeeCount = activeEmployees.filter(
      (employee) => employee.areaName === areaName || employee.department === areaName,
    ).length;

    return {
      label: areaName,
      roleCount,
      employeeCount,
    };
  });

  return {
    totals: {
      employees: employees.length,
      activeEmployees: activeEmployees.length,
      inactiveEmployees,
      branches: branches.length,
      activeBranches: branches.filter((branch) => branch.isActive !== false).length,
      areas: areas.length,
      roles: roles.length,
      withDni,
      withBiometric,
      assignedToBranch,
    },
    employeesByArea,
    employeesByRole,
    employeesByBranch,
    rolesByArea,
  };
}

function MetricCard({ icon: Icon, label, value, help }) {
  return (
    <article className={styles.metricCard}>
      <div className={styles.metricIcon}>
        <Icon size={20} />
      </div>
      <div>
        <span className={styles.metricLabel}>{label}</span>
        <strong className={styles.metricValue}>{value}</strong>
        <p className={styles.metricHelp}>{help}</p>
      </div>
    </article>
  );
}

function DistributionPanel({ title, description, items, total, emptyText }) {
  const visibleItems = items.slice(0, 6);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <h3 className={styles.panelTitle}>{title}</h3>
          <p className={styles.panelDescription}>{description}</p>
        </div>
      </div>

      {visibleItems.length ? (
        <div className={styles.distributionList}>
          {visibleItems.map((item) => {
            const itemPercent = percent(item.count, total);

            return (
              <div key={item.label} className={styles.distributionItem}>
                <div className={styles.distributionRow}>
                  <span>{item.label}</span>
                  <strong>{formatNumber(item.count)}</strong>
                </div>
                <div className={styles.track} aria-hidden="true">
                  <span style={{ width: `${Math.max(itemPercent, 6)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>{emptyText}</div>
      )}
    </section>
  );
}

export default async function CompanyOrganizationPage() {
  const user = await requireAuthenticatedUser();
  const snapshot = await getOrganizationSnapshot();
  const { totals } = snapshot;
  const completionItems = [
    {
      label: "DNI registrado",
      value: percent(totals.withDni, totals.employees),
      detail: `${formatNumber(totals.withDni)} de ${formatNumber(totals.employees)} empleados`,
    },
    {
      label: "Biométrico registrado",
      value: percent(totals.withBiometric, totals.employees),
      detail: `${formatNumber(totals.withBiometric)} de ${formatNumber(totals.employees)} empleados`,
    },
    {
      label: "Sucursal asignada",
      value: percent(totals.assignedToBranch, totals.employees),
      detail: `${formatNumber(totals.assignedToBranch)} de ${formatNumber(totals.employees)} empleados`,
    },
  ];
  const quickLinks = [
    { label: "Áreas", href: companyModulePath("/areas") },
    { label: "Cargos", href: companyModulePath("/roles") },
    { label: "Sucursales", href: companyModulePath("/branches") },
    { label: "Empleados", href: companyModulePath("/employees") },
  ];

  return (
    <ModuleShell
      moduleConfig={getCompanyModuleForUser(user)}
      title="Empresa"
      description="Resumen compacto de la estructura organizacional y calidad de información base."
    >
      <div className={styles.page}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Resumen organizacional</p>
            <h2 className={styles.title}>Vista rápida de la empresa</h2>
            <p className={styles.description}>
              Un pulso general de áreas, cargos, sucursales y personal registrado en el sistema.
            </p>
          </div>

          <div className={styles.heroStatus}>
            <BadgeCheck size={18} />
            <span>{formatNumber(totals.activeEmployees)} empleados activos</span>
          </div>
        </section>

        <section className={styles.metricsGrid}>
          <MetricCard
            icon={Layers3}
            label="Áreas"
            value={formatNumber(totals.areas)}
            help="unidades funcionales"
          />
          <MetricCard
            icon={Network}
            label="Cargos"
            value={formatNumber(totals.roles)}
            help="posiciones configuradas"
          />
          <MetricCard
            icon={Building2}
            label="Sucursales"
            value={formatNumber(totals.branches)}
            help={`${formatNumber(totals.activeBranches)} activa${totals.activeBranches === 1 ? "" : "s"}`}
          />
          <MetricCard
            icon={Users}
            label="Empleados"
            value={formatNumber(totals.employees)}
            help={`${formatNumber(totals.inactiveEmployees)} inactivo${totals.inactiveEmployees === 1 ? "" : "s"}`}
          />
        </section>

        <section className={styles.mainGrid}>
          <DistributionPanel
            title="Empleados por área"
            description="Distribución del personal activo por área funcional."
            items={snapshot.employeesByArea}
            total={totals.activeEmployees}
            emptyText="Aún no hay empleados activos con área asignada."
          />

          <DistributionPanel
            title="Empleados por cargo"
            description="Cargos con mayor presencia dentro del equipo activo."
            items={snapshot.employeesByRole}
            total={totals.activeEmployees}
            emptyText="Aún no hay empleados activos con cargo asignado."
          />

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h3 className={styles.panelTitle}>Sucursales</h3>
                <p className={styles.panelDescription}>Carga de personal activo por sede registrada.</p>
              </div>
            </div>

            {snapshot.employeesByBranch.length ? (
              <div className={styles.branchGrid}>
                {snapshot.employeesByBranch.slice(0, 4).map((branch) => (
                  <article key={branch.label} className={styles.branchCard}>
                    <Building2 size={18} />
                    <strong>{branch.label}</strong>
                    <span>{formatNumber(branch.count)} empleado{branch.count === 1 ? "" : "s"}</span>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>Aún no hay empleados asignados a sucursales.</div>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h3 className={styles.panelTitle}>Calidad de datos</h3>
                <p className={styles.panelDescription}>Campos clave para identificación, control y operación diaria.</p>
              </div>
            </div>

            <div className={styles.completionList}>
              {completionItems.map((item) => (
                <div key={item.label} className={styles.completionItem}>
                  <div className={styles.completionHeader}>
                    <span>{item.label}</span>
                    <strong>{item.value}%</strong>
                  </div>
                  <div className={styles.track} aria-hidden="true">
                    <span style={{ width: `${Math.max(item.value, 6)}%` }} />
                  </div>
                  <p>{item.detail}</p>
                </div>
              ))}
            </div>
          </section>
        </section>

        <section className={styles.structurePanel}>
          <div>
            <p className={styles.eyebrow}>Estructura</p>
            <h3 className={styles.panelTitle}>Áreas y cargos configurados</h3>
          </div>

          <div className={styles.structureGrid}>
            {snapshot.rolesByArea.length ? (
              snapshot.rolesByArea.map((area) => (
                <article key={area.label} className={styles.structureCard}>
                  <Layers3 size={17} />
                  <div>
                    <strong>{area.label}</strong>
                    <span>
                      {formatNumber(area.roleCount)} cargo{area.roleCount === 1 ? "" : "s"} ·{" "}
                      {formatNumber(area.employeeCount)} empleado{area.employeeCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </article>
              ))
            ) : (
              <div className={styles.emptyState}>Aún no hay áreas configuradas.</div>
            )}
          </div>
        </section>

        <section className={styles.quickLinks}>
          <div className={styles.quickLinkCopy}>
            <Fingerprint size={18} />
            <span>Accesos rápidos</span>
          </div>

          <div className={styles.quickLinkList}>
            {quickLinks.map((link) => (
              <TransitionLink key={link.href} href={link.href} className={styles.quickLink}>
                <ShieldUser size={15} />
                {link.label}
              </TransitionLink>
            ))}
          </div>
        </section>
      </div>
    </ModuleShell>
  );
}
