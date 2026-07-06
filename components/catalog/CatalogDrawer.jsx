"use client";

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import useClientReady from "@/hooks/useClientReady";
import styles from "./CatalogDrawer.module.scss";

export default function CatalogDrawer({ isOpen, eyebrow, title, onClose, children }) {
  const canRenderPortal = useClientReady();
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!canRenderPortal || !isOpen) {
    return null;
  }

  return createPortal(
    <div
      className={styles.overlay}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.heading}>
            {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
            <h3 id={titleId} className={styles.title}>
              {title}
            </h3>
          </div>

          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Cerrar formulario"
            title="Cerrar formulario"
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
