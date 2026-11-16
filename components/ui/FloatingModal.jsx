"use client";

import { useCallback, useEffect, useId, useState } from "react";
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
  showCloseButton = true,
  onClose,
}) {
  const canRenderPortal = useClientReady();
  const titleId = useId();
  const [isClosing, setIsClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (isPending || isClosing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    setIsClosing(true);
  }, [isClosing, isPending, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        requestClose();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, requestClose]);

  if (!canRenderPortal || !isOpen) {
    return null;
  }

  return createPortal(
    <div
      className={styles.overlay}
      data-closing={isClosing}
      onAnimationEnd={(event) => {
        if (isClosing && event.target === event.currentTarget) {
          setIsClosing(false);
          onClose();
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <section className={`${styles.modal} ${isFullscreen ? styles.fullscreenModal : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} inert={isClosing}>
        <div className={styles.header}>
          <div>
            {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
            <h3 id={titleId} className={styles.title}>
              {title}
            </h3>
          </div>
          {showCloseButton && (
            <button
              type="button"
              className={styles.closeButton}
              onClick={requestClose}
              disabled={isPending}
              aria-label="Cerrar modal"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className={styles.body}>{typeof children === "function" ? children(requestClose) : children}</div>
      </section>
    </div>,
    document.body,
  );
}
