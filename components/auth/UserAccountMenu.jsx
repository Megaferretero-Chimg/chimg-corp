"use client";

import { LayoutGrid, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import LogoutButton from "@/components/auth/LogoutButton";
import styles from "./UserAccountMenu.module.scss";

export default function UserAccountMenu({ user, canSwitchModules }) {
  const pathname = usePathname();
  const panelId = useId();
  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const [openPath, setOpenPath] = useState(null);
  const isOpen = openPath === pathname;

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpenPath(null);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpenPath(null);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      className={styles.account}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpenPath(null);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-label="Mi cuenta"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setOpenPath(isOpen ? null : pathname)}
      >
        <UserRound size={24} strokeWidth={1.8} aria-hidden="true" />
      </button>
        <section
          id={panelId}
          className={`${styles.panel} ${isOpen ? styles.panelOpen : ""}`}
          aria-label="Mi cuenta"
          aria-hidden={!isOpen}
          inert={!isOpen}
        >
          <div className={styles.identity}>
            <span className={styles.avatar}><UserRound size={22} aria-hidden="true" /></span>
            <div className={styles.details}>
              <h2>{user.name}</h2>
              <p>@{user.username}</p>
            </div>
          </div>
          <dl className={styles.info}>
            <div><dt>Perfil</dt><dd>{user.role}</dd></div>
            {user.email && <div><dt>Correo</dt><dd>{user.email}</dd></div>}
          </dl>
          <div className={styles.actions}>
            {canSwitchModules && (
              <Link href="/modules" className={styles.switchModules} onClick={() => setOpenPath(null)}>
                <LayoutGrid size={17} aria-hidden="true" />Cambiar de módulo
              </Link>
            )}
            <LogoutButton className={styles.logout} />
          </div>
        </section>
    </div>
  );
}
