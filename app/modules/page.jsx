import Image from "next/image";
import { Building2, CalendarRange, PackageSearch } from "lucide-react";

import LogoutButton from "@/components/auth/LogoutButton";
import TransitionLink from "@/components/navigation/TransitionLink";
import { requireAuthenticatedUser } from "@/lib/access-control";
import { getModuleCardsForUser } from "@/modules/registry";
import styles from "./page.module.scss";

const moduleIcons = {
  "building-2": Building2,
  "calendar-range": CalendarRange,
  "package-search": PackageSearch,
};

export const metadata = {
  title: "Selección de módulo | Control de Asistencia",
};

export default async function ModulesPage() {
  const user = await requireAuthenticatedUser();
  const visibleModules = getModuleCardsForUser(user);

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.hero}>
          <div className={styles.brand}>
            <div className={styles.logoWrap}>
              <Image
                src="/imgs/logo-chimg.png"
                alt="Logo de la empresa"
                width={48}
                height={48}
                className={styles.logo}
                priority
              />
            </div>

            <div>
              <p className={styles.eyebrow}>Portal interno</p>
              <p className={styles.brandName}>Selección de módulo</p>
            </div>
          </div>

          <h1 className={styles.title}>Elige el módulo con el que quieres trabajar</h1>
          <p className={styles.description}>
            La plataforma está preparada para crecer por módulos. Por ahora ya puedes ingresar al módulo principal de planificación y control operativo.
          </p>
        </header>

        <section className={styles.grid}>
          {visibleModules.map((module) => (
            <article key={module.key} className={styles.card}>
              <div className={styles.cardGlow} />
              <div className={styles.cardTop}>
                <div className={styles.iconWrap}>
                  {(() => {
                    const ModuleIcon = moduleIcons[module.icon] || CalendarRange;

                    return <ModuleIcon size={46} strokeWidth={1.8} />;
                  })()}
                </div>

                <div className={styles.cardCopy}>
                  <span className={styles.status}>{module.status}</span>
                  <h2 className={styles.cardTitle}>{module.title}</h2>
                  <p className={styles.cardDescription}>{module.description}</p>
                </div>
              </div>

              <ul className={styles.featureList}>
                {module.bullets.map((bullet) => (
                  <li key={bullet} className={styles.featureItem}>
                    {bullet}
                  </li>
                ))}
              </ul>

              <TransitionLink href={module.href} className={styles.enterLink} transitionMs={180}>
                Entrar al módulo
              </TransitionLink>
            </article>
          ))}
        </section>
      </section>

      <LogoutButton className={styles.floatingLogout} />
    </main>
  );
}
