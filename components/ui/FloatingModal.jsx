"use client";

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import useClientReady from "@/hooks/useClientReady";
import styles from "./FloatingModal.module.scss";

export default function FloatingModal({
  isOpen,
  title,
  eyebrow = "",
  children,
  isPending = false,
  isFullscreen = false,
  onClose,
}) {
  const canRenderPortal = useClientReady();
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event) {
      if (event.key === "Escape" && !isPending) {
        onClose();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isPending, onClose]);

  if (!canRenderPortal || !isOpen) {
    return null;
  }

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onClose();
        }
      }}
    >
      <section className={`${styles.modal} ${isFullscreen ? styles.fullscreenModal : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.header}>
          <div>
            {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
            <h3 id={titleId} className={styles.title}>
              {title}
            </h3>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={isPending}
            aria-label="Cerrar modal"
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>{children}</div>
      </section>
    </div>,
    document.body,
  );
}
