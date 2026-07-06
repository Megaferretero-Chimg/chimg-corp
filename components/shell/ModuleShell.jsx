"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";

import LogoutButton from "@/components/auth/LogoutButton";
import TransitionLink from "@/components/navigation/TransitionLink";
import { PLANNING_MODULE } from "@/modules/planner/module";
import styles from "./ModuleShell.module.scss";

export default function ModuleShell({ title, description, actions = null, children, moduleConfig = PLANNING_MODULE }) {
  const pathname = usePathname();
  const navigation = moduleConfig.navigation || [];

  function isPathActive(href) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [openSection, setOpenSection] = useState(() => {
    const sectionWithActiveChild = navigation.find((section) =>
      section.items.some((item) => isPathActive(item.href)),
    );

    return sectionWithActiveChild?.title || "";
  });

  function isSectionActive(section) {
    if (isPathActive(section.href)) {
      return true;
    }

    return section.items.some((item) => isPathActive(item.href));
  }

  function closeMobileNavigation() {
    setIsMobileNavOpen(false);
  }

  useEffect(() => {
    if (!isMobileNavOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsMobileNavOpen(false);
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileNavOpen]);

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.mobileMenuButton}
        onClick={() => setIsMobileNavOpen(true)}
        aria-label="Abrir navegación"
        aria-expanded={isMobileNavOpen}
        aria-controls="module-sidebar"
      >
        <Menu size={20} />
      </button>

      <div className={styles.mobileBrandBar} aria-hidden="true">
        <Image
          src="/imgs/logo-chimg.png"
          alt=""
          width={46}
          height={46}
          className={styles.mobileBrandLogo}
          priority
        />
      </div>

      {isMobileNavOpen ? (
        <div
          className={styles.mobileNavBackdrop}
          onMouseDown={closeMobileNavigation}
          aria-hidden="true"
        />
      ) : null}

      <aside
        id="module-sidebar"
        className={`${styles.sidebar} ${isMobileNavOpen ? styles.sidebarOpen : ""}`}
      >
        <div className={styles.sidebarMain}>
          <button
            type="button"
            className={styles.mobileCloseButton}
            onClick={closeMobileNavigation}
            aria-label="Cerrar navegación"
          >
            <X size={18} />
          </button>

          <div className={styles.brand}>
            <div className={styles.logoWrap}>
              <Image
                src="/imgs/logo-chimg.png"
                alt="Logo de la empresa"
                width={42}
                height={42}
                className={styles.logo}
                priority
              />
            </div>

            <div>
              <p className={styles.brandEyebrow}>Módulo activo</p>
              <p className={styles.brandTitle}>{moduleConfig.title}</p>
            </div>
          </div>

          <TransitionLink
            href={moduleConfig.modulesHref || "/modules"}
            className={styles.moduleSwitcher}
            onClick={closeMobileNavigation}
          >
            Cambiar módulo
          </TransitionLink>

          <nav className={styles.nav}>
            {navigation.map((section) => {
              const isOpen = openSection === section.title;
              const isActive = isSectionActive(section);
              const hasChildren = section.items.length > 0 && section.href !== moduleConfig.homeHref;

              return (
                <div
                  key={section.title}
                  className={`${styles.navSection} ${isOpen ? styles.navSectionOpen : ""} ${isActive ? styles.navSectionActive : ""}`}
                >
                  <div className={styles.navSectionSummary}>
                    <TransitionLink
                      href={section.href}
                      className={`${styles.navSectionLink} ${isActive ? styles.navSectionLinkActive : ""}`}
                      onClick={closeMobileNavigation}
                    >
                      <span className={styles.navSectionTitle}>{section.title}</span>
                    </TransitionLink>
                    {hasChildren ? (
                      <button
                        type="button"
                        className={styles.navToggle}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? `Ocultar ${section.title}` : `Mostrar ${section.title}`}
                        onClick={() =>
                          setOpenSection((current) => (current === section.title ? "" : section.title))
                        }
                      >
                        <ChevronDown size={16} className={styles.navChevron} />
                      </button>
                    ) : null}
                  </div>

                  <div className={`${styles.navSectionBody} ${!hasChildren ? styles.navSectionBodyHidden : ""}`}>
                    <div className={styles.navSectionItems}>
                      {section.items.map((item) => {
                        const active = isPathActive(item.href);

                        return (
                          <div key={item.href} className={styles.navItemWrap}>
                            <TransitionLink
                              href={item.href}
                              className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                              onClick={closeMobileNavigation}
                            >
                              <span className={styles.navLabel}>{item.label}</span>
                            </TransitionLink>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>
        </div>

        <div className={styles.sidebarFooter}>
          <LogoutButton />
        </div>
      </aside>

      <main className={styles.content}>
        <header className={`${styles.header} page-entrance`}>
          <div>
            <p className={styles.eyebrow}>Dashboard</p>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.description}>{description}</p>
          </div>
          {actions ? <div className={styles.headerActions}>{actions}</div> : null}
        </header>

        <section className="page-entrance page-entrance-delay-sm">{children}</section>
      </main>
    </div>
  );
}
