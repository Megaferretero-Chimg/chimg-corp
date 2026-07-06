import {
  Activity,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";

import ModuleShell from "@/components/shell/ModuleShell";
import TransitionLink from "@/components/navigation/TransitionLink";
import { requireAuthenticatedUser } from "@/lib/access-control";
import connectToDatabase from "@/lib/db/mongodb";
import { getCompanyModuleForUser } from "@/modules/company/module";
import { companyModulePath } from "@/modules/company/routes";
import AuditLog from "@/models/AuditLog";
import { User, UserType } from "@/modules/company/models";
import styles from "@/modules/company/submodules/access/styles/pages/access-page.module.scss";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Acceso | Empresa y configuración global",
};

function formatNumber(value) {
  return new Intl.NumberFormat("es-EC").format(value || 0);
}

function formatDateTime(value) {
  if (!value) {
    return "Sin registro";
  }

  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatActionLabel(action) {
  const labels = {
    "area.create": "Área creada",
    "area.update": "Área actualizada",
    "area.delete": "Área eliminada",
    "branch.create": "Sucursal creada",
    "branch.update": "Sucursal actualizada",
    "branch.delete": "Sucursal eliminada",
    "role.create": "Rol creado",
    "role.update": "Rol actualizado",
    "role.delete": "Rol eliminado",
  };

  return labels[action] || action || "Acción registrada";
}

async function getAccessSnapshot() {
  await connectToDatabase();

  const [users, userTypes, auditLogs] = await Promise.all([
    User.find({})
      .select("username employeeName accessRole accessRoleLabel isActive lastLoginAt createdAt")
      .sort({ username: 1 })
      .lean(),
    UserType.find({}).sort({ name: 1 }).lean(),
    AuditLog.find({})
      .sort({ happenedAt: -1 })
      .limit(6)
      .lean(),
  ]);

  const activeUsers = users.filter((user) => user.isActive !== false);
  const inactiveUsers = users.length - activeUsers.length;
  const usersWithLogin = users
    .filter((user) => user.lastLoginAt)
    .sort((left, right) => new Date(right.lastLoginAt) - new Date(left.lastLoginAt))
    .slice(0, 5);
  const roleCounts = activeUsers.reduce((counts, user) => {
    const label = user.accessRoleLabel || user.accessRole || "Sin rol";
    counts.set(label, (counts.get(label) || 0) + 1);
    return counts;
  }, new Map());

  return {
    totals: {
      users: users.length,
      activeUsers: activeUsers.length,
      inactiveUsers,
      userTypes: userTypes.length,
      activeUserTypes: userTypes.filter((type) => type.isActive !== false).length,
      usersWithLogin: usersWithLogin.length,
      auditLogs: auditLogs.length,
    },
    usersWithLogin: usersWithLogin.map((user) => ({
      id: user._id.toString(),
      username: user.username || "",
      employeeName: user.employeeName || "",
      accessRoleLabel: user.accessRoleLabel || "Sin rol",
      lastLoginAt: user.lastLoginAt,
    })),
    roleDistribution: [...roleCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    auditLogs: auditLogs.map((log) => ({
      id: log._id.toString(),
      actor: log.actor || "admin",
      action: formatActionLabel(log.action),
      entityLabel: log.entityLabel || "",
      happenedAt: log.happenedAt,
    })),
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

export default async function CompanyAccessPage() {
  const user = await requireAuthenticatedUser();
  const snapshot = await getAccessSnapshot();
  const { totals } = snapshot;

  return (
    <ModuleShell
      moduleConfig={getCompanyModuleForUser(user)}
      title="Acceso"
      description="Resumen de cuentas, roles de acceso y actividad reciente de la plataforma."
    >
      <div className={styles.page}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Control de acceso</p>
            <h2 className={styles.title}>Pulso de seguridad del sistema</h2>
            <p className={styles.description}>
              Una vista rápida de usuarios registrados, roles disponibles y movimientos recientes del módulo.
            </p>
          </div>

          <div className={styles.heroStatus}>
            <ShieldCheck size={18} />
            <span>{formatNumber(totals.activeUsers)} usuarios activos</span>
          </div>
        </section>

        <section className={styles.metricsGrid}>
          <MetricCard
            icon={Users}
            label="Usuarios"
            value={formatNumber(totals.users)}
            help={`${formatNumber(totals.inactiveUsers)} inactivo${totals.inactiveUsers === 1 ? "" : "s"}`}
          />
          <MetricCard
            icon={KeyRound}
            label="Roles de acceso"
            value={formatNumber(totals.userTypes)}
            help={`${formatNumber(totals.activeUserTypes)} activo${totals.activeUserTypes === 1 ? "" : "s"}`}
          />
          <MetricCard
            icon={UserCheck}
            label="Con ingreso"
            value={formatNumber(totals.usersWithLogin)}
            help="Usuarios con login registrado"
          />
          <MetricCard
            icon={Activity}
            label="Acciones recientes"
            value={formatNumber(totals.auditLogs)}
            help="Últimos movimientos auditados"
          />
        </section>

        <section className={styles.mainGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h3 className={styles.panelTitle}>Últimos ingresos</h3>
                <p className={styles.panelDescription}>Usuarios con actividad de inicio de sesión registrada.</p>
              </div>
            </div>

            {snapshot.usersWithLogin.length ? (
              <div className={styles.list}>
                {snapshot.usersWithLogin.map((user) => (
                  <article key={user.id} className={styles.listItem}>
                    <div className={styles.itemIcon}>
                      <UserCheck size={16} />
                    </div>
                    <div>
                      <strong>{user.username}</strong>
                      <span>{user.employeeName || user.accessRoleLabel}</span>
                    </div>
                    <time>{formatDateTime(user.lastLoginAt)}</time>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>Aún no hay ingresos registrados para usuarios creados.</div>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h3 className={styles.panelTitle}>Últimas acciones</h3>
                <p className={styles.panelDescription}>Movimientos recientes registrados en auditoría.</p>
              </div>
            </div>

            {snapshot.auditLogs.length ? (
              <div className={styles.list}>
                {snapshot.auditLogs.map((log) => (
                  <article key={log.id} className={styles.listItem}>
                    <div className={styles.itemIcon}>
                      <Activity size={16} />
                    </div>
                    <div>
                      <strong>{log.action}</strong>
                      <span>{log.entityLabel || `Actor: ${log.actor}`}</span>
                    </div>
                    <time>{formatDateTime(log.happenedAt)}</time>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>Aún no hay acciones auditadas.</div>
            )}
          </section>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h3 className={styles.panelTitle}>Usuarios por rol de acceso</h3>
              <p className={styles.panelDescription}>Distribución de cuentas activas por rol asignado.</p>
            </div>
          </div>

          {snapshot.roleDistribution.length ? (
            <div className={styles.roleGrid}>
              {snapshot.roleDistribution.map((role) => (
                <article key={role.label} className={styles.roleCard}>
                  <LockKeyhole size={17} />
                  <strong>{role.label}</strong>
                  <span>{formatNumber(role.count)} usuario{role.count === 1 ? "" : "s"}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>Aún no hay usuarios activos con rol asignado.</div>
          )}
        </section>

        <section className={styles.quickLinks}>
          <div className={styles.quickLinkCopy}>
            <LockKeyhole size={18} />
            <span>Gestión rápida</span>
          </div>

          <div className={styles.quickLinkList}>
            <TransitionLink href={companyModulePath("/users")} className={styles.quickLink}>
              <Users size={15} />
              Usuarios
            </TransitionLink>
            <TransitionLink href={companyModulePath("/permissions")} className={styles.quickLink}>
              <KeyRound size={15} />
              Roles de acceso
            </TransitionLink>
          </div>
        </section>
      </div>
    </ModuleShell>
  );
}
