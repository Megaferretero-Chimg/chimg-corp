"use client";

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, X } from "lucide-react";

import useClientReady from "@/hooks/useClientReady";
import styles from "./ConfirmDialog.module.scss";

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Aceptar",
  cancelLabel = "Cancelar",
  tone = "danger",
  layout = "default",
  isPending = false,
  confirmDisabled = false,
  children,
  onCancel,
  onConfirm,
}) {
  const canRenderPortal = useClientReady();
  const titleId = useId();
  const messageId = useId();
  const usesFormLayout = layout === "form";

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onCancel]);

  if (!canRenderPortal || !isOpen) {
    return null;
  }

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onCancel();
        }
      }}
    >
      <section
        className={`${styles.dialog} ${usesFormLayout ? styles.formDialog : ""} ${isPending ? styles.dialogPending : ""}`}
        role="dialog"
        aria-modal="true"
        aria-busy={isPending}
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
      >
        <div className={styles.header}>
          <span className={`${styles.icon} ${tone === "danger" ? styles.iconDanger : ""}`}>
            <AlertTriangle size={19} />
          </span>
          <div>
            <h3 id={titleId} className={styles.title}>
              {title}
            </h3>
            {!usesFormLayout ? <p id={messageId} className={styles.message}>{message}</p> : null}
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onCancel}
            disabled={isPending}
            aria-label="Cerrar confirmación"
          >
            <X size={16} />
          </button>
        </div>

        {usesFormLayout && message ? (
          <div className={styles.formMessage}>
            <p id={messageId}>{message}</p>
          </div>
        ) : null}

        {children ? <div className={styles.body}>{children}</div> : null}

        <div className={styles.actions}>
          <button
            type="button"
            className="catalog-button-ghost"
            onClick={onCancel}
            disabled={isPending}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? styles.dangerButton : "catalog-button-primary"}
            onClick={onConfirm}
            disabled={isPending || confirmDisabled}
          >
            {isPending ? <Loader2 size={16} className={styles.spinner} /> : null}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
