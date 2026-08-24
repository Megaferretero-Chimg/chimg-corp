"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Mail, Menu, X } from "lucide-react";

import LogoutButton from "@/components/auth/LogoutButton";
import TransitionLink from "@/components/navigation/TransitionLink";
import { useModuleConfig } from "@/components/shell/ModuleConfigProvider";
import styles from "./ModuleShell.module.scss";

const EMPTY_MODULE_CONFIG = Object.freeze({
  title: "Módulo",
  modulesHref: "/modules",
  canSwitchModules: false,
  currentUser: null,
  navigation: [],
});

export default function ModuleShell({ title, description, actions = null, children, moduleConfig = null }) {
  const pathname = usePathname();
  const layoutModuleConfig = useModuleConfig();
  const resolvedModuleConfig = layoutModuleConfig || moduleConfig || EMPTY_MODULE_CONFIG;
  const navigation = resolvedModuleConfig.navigation || [];

  const navigationMatches = navigation.flatMap((section) =>
    section.items.map((item) => ({
      sectionTitle: section.title,
      href: item.href,
    })),
  );
  const activeNavigationMatch = navigationMatches.find((match) => pathname === match.href)
    || navigationMatches
      .filter((match) => pathname.startsWith(`${match.href}/`))
      .sort((left, right) => right.href.length - left.href.length)[0]
    || null;
  const activeSectionTitle = activeNavigationMatch?.sectionTitle || "";

  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [manualOpenSection, setManualOpenSection] = useState(() => ({
    pathname,
    title: activeSectionTitle,
  }));
  const openSection = manualOpenSection.pathname === pathname
    ? manualOpenSection.title
    : activeSectionTitle;

  function isSectionActive(section) {
    return section.title === activeSectionTitle;
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
          width={1327}
          height={441}
          sizes="46px"
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
                width={1327}
                height={441}
                sizes="86px"
                className={styles.logo}
                priority
              />
            </div>

            <div>
              <p className={styles.brandEyebrow}>Módulo activo</p>
              <p className={styles.brandTitle}>{resolvedModuleConfig.title}</p>
            </div>
          </div>

          {resolvedModuleConfig.canSwitchModules !== false ? (
            <TransitionLink
              href={resolvedModuleConfig.modulesHref || "/modules"}
              className={styles.moduleSwitcher}
              onClick={closeMobileNavigation}
            >
              Cambiar módulo
            </TransitionLink>
          ) : null}

          <nav className={styles.nav}>
            {navigation.map((section) => {
              const isOpen = openSection === section.title;
              const isActive = isSectionActive(section);
              const hasChildren = section.items.length > 1;

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
                        onClick={() => setManualOpenSection({
                          pathname,
                          title: isOpen ? "" : section.title,
                        })}
                      >
                        <ChevronDown size={16} className={styles.navChevron} />
                      </button>
                    ) : null}
                  </div>

                  {hasChildren && isOpen ? (
                    <div className={styles.navSectionBody}>
                      <div className={styles.navSectionItems}>
                        {section.items.map((item) => {
                          const active = activeNavigationMatch?.href === item.href;

                          return (
                            <div key={item.href} className={styles.navItemWrap}>
                              <TransitionLink
                                href={item.href}
                                className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                                aria-current={active ? "page" : undefined}
                                onClick={closeMobileNavigation}
                              >
                                <span className={styles.navLabel}>{item.label}</span>
                              </TransitionLink>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>
        </div>

        <div className={styles.sidebarFooter}>
          {resolvedModuleConfig.currentUser?.name ? (
            <section className={styles.userCard} aria-label="Usuario actual">
              <span className={styles.userCardIcon} aria-hidden="true">
                {resolvedModuleConfig.currentUser.name.trim().charAt(0).toUpperCase()}
              </span>
              <div className={styles.userCardContent}>
                <strong>{resolvedModuleConfig.currentUser.name}</strong>
                {resolvedModuleConfig.currentUser.email ? (
                  <span title={resolvedModuleConfig.currentUser.email}>
                    <Mail size={13} aria-hidden="true" />
                    {resolvedModuleConfig.currentUser.email}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}
          <LogoutButton />
        </div>
      </aside>

      <main className={styles.content}>
        <header className={`${styles.header} page-entrance`}>
          <div>
            <p className={styles.eyebrow}>Dashboard</p>
            <h1 className={styles.title}>{title}</h1>
            {description ? <p className={styles.description}>{description}</p> : null}
          </div>
          {actions ? <div className={styles.headerActions}>{actions}</div> : null}
        </header>

        <section className="page-entrance page-entrance-delay-sm">{children}</section>
      </main>
    </div>
  );
}
