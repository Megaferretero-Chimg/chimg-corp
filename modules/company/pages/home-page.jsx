import {
  Building2,
  CheckCircle2,
  Layers3,
  Network,
  Route,
  ShieldCheck,
  Users,
} from "lucide-react";

import ModuleShell from "@/components/shell/ModuleShell";
import TransitionLink from "@/components/navigation/TransitionLink";
import { requireAuthenticatedUser } from "@/lib/access-control";
import connectToDatabase from "@/lib/db/mongodb";
import { getCompanyModuleForUser } from "@/modules/company/module";
import { companyModulePath } from "@/modules/company/routes";
import { Area, Branch, Employee, Role } from "@/modules/company/models";
import styles from "@/modules/company/styles/pages/home-page.module.scss";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Empresa y configuración global | Control de Asistencia",
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

async function getCompanyHomeSnapshot() {
  await connectToDatabase();

  const [employees, branches, areas, roles] = await Promise.all([
    Employee.find({})
      .select("isActive dni biometricCode biometricAliases branchName branch areaName department roleName")
      .lean(),
    Branch.find({}).select("isActive").lean(),
    Area.find({}).select("isActive").lean(),
    Role.find({}).select("isActive").lean(),
  ]);

  const activeEmployees = employees.filter((employee) => employee.isActive !== false);
  const assignedToBranch = employees.filter((employee) =>
    String(employee.branchName || employee.branch || "").trim(),
  ).length;
  const assignedToStructure = employees.filter((employee) =>
    String(employee.areaName || employee.department || employee.roleName || "").trim(),
  ).length;
  const withBiometric = employees.filter((employee) =>
    String(employee.biometricCode || "").trim()
    || (employee.biometricAliases || []).some((alias) => String(alias.biometricCode || "").trim()),
  ).length;
  const withDni = employees.filter((employee) => String(employee.dni || "").trim()).length;

  return {
    totals: {
      employees: employees.length,
      activeEmployees: activeEmployees.length,
      branches: branches.length,
      activeBranches: branches.filter((branch) => branch.isActive !== false).length,
      areas: areas.length,
      roles: roles.length,
      activeRoles: roles.filter((role) => role.isActive !== false).length,
    },
    quality: [
      {
        label: "DNI registrado",
        value: percent(withDni, employees.length),
        detail: `${formatNumber(withDni)} de ${formatNumber(employees.length)} empleados`,
      },
      {
        label: "Biométrico registrado",
        value: percent(withBiometric, employees.length),
        detail: `${formatNumber(withBiometric)} de ${formatNumber(employees.length)} empleados`,
      },
      {
        label: "Sucursal asignada",
        value: percent(assignedToBranch, employees.length),
        detail: `${formatNumber(assignedToBranch)} de ${formatNumber(employees.length)} empleados`,
      },
      {
        label: "Estructura asignada",
        value: percent(assignedToStructure, employees.length),
        detail: `${formatNumber(assignedToStructure)} de ${formatNumber(employees.length)} empleados`,
      },
    ],
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

export default async function CompanyHomePage() {
  const user = await requireAuthenticatedUser();
  const snapshot = await getCompanyHomeSnapshot();
  const { totals } = snapshot;

  return (
    <ModuleShell
      moduleConfig={getCompanyModuleForUser(user)}
      title="Empresa"
      description="Base organizacional que sostiene planificación, asistencia y control operativo."
    >
      <div className={styles.page}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Módulo global</p>
            <h2 className={styles.title}>Gobierno de la estructura empresarial</h2>
            <p className={styles.description}>
              Mantén áreas, sedes, cargos y personas bajo una misma base antes de conectar jerarquías y responsables.
            </p>
          </div>

          <div className={styles.heroStatus}>
            <CheckCircle2 size={18} />
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
            help={`${formatNumber(totals.activeRoles)} activos`}
          />
          <MetricCard
            icon={Building2}
            label="Sucursales"
            value={formatNumber(totals.branches)}
            help={`${formatNumber(totals.activeBranches)} activas`}
          />
          <MetricCard
            icon={Users}
            label="Personal"
            value={formatNumber(totals.activeEmployees)}
            help={`${formatNumber(totals.employees)} registrados`}
          />
        </section>

        <section className={styles.mainGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h3 className={styles.panelTitle}>Calidad de información</h3>
                <p className={styles.panelDescription}>Campos clave para que la operación y la asistencia trabajen bien.</p>
              </div>
            </div>

            <div className={styles.qualityList}>
              {snapshot.quality.map((item) => (
                <div key={item.label} className={styles.qualityItem}>
                  <div className={styles.qualityHead}>
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

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h3 className={styles.panelTitle}>Secuencia de trabajo</h3>
                <p className={styles.panelDescription}>La estructura gana consistencia cuando estos elementos se mantienen en este orden.</p>
              </div>
            </div>

            <div className={styles.flowList}>
              <TransitionLink href={companyModulePath("/areas")} className={styles.flowStep}>
                <span>1</span>
                <strong>Áreas</strong>
                <small>Unidades funcionales y alcance interno.</small>
              </TransitionLink>
              <TransitionLink href={companyModulePath("/roles")} className={styles.flowStep}>
                <span>2</span>
                <strong>Cargos</strong>
                <small>Funciones y responsabilidades formales.</small>
              </TransitionLink>
              <TransitionLink href={companyModulePath("/branches")} className={styles.flowStep}>
                <span>3</span>
                <strong>Sucursales</strong>
                <small>Sedes donde opera la organización.</small>
              </TransitionLink>
              <TransitionLink href={companyModulePath("/employees")} className={styles.flowStep}>
                <span>4</span>
                <strong>Empleados</strong>
                <small>Personas vinculadas a la base definida.</small>
              </TransitionLink>
              <TransitionLink href={companyModulePath("/structure")} className={styles.flowStep}>
                <span>5</span>
                <strong>Organigrama</strong>
                <small>Relaciones jerárquicas y responsables.</small>
              </TransitionLink>
            </div>
          </section>
        </section>

        <section className={styles.quickLinks}>
          <div className={styles.quickLinkCopy}>
            <CheckCircle2 size={18} />
            <span>Administración empresarial</span>
          </div>

          <div className={styles.quickLinkList}>
            <TransitionLink href={companyModulePath("/organization")} className={styles.quickLink}>
              <Building2 size={15} />
              Resumen
            </TransitionLink>
            <TransitionLink href={companyModulePath("/areas")} className={styles.quickLink}>
              <Layers3 size={15} />
              Áreas
            </TransitionLink>
            <TransitionLink href={companyModulePath("/structure")} className={styles.quickLink}>
              <Route size={15} />
              Organigrama
            </TransitionLink>
            <TransitionLink href={companyModulePath("/access")} className={styles.quickLink}>
              <ShieldCheck size={15} />
              Acceso
            </TransitionLink>
          </div>
        </section>
      </div>
    </ModuleShell>
  );
}
