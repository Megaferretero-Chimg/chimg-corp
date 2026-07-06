"use client";

import { createPortal } from "react-dom";
import { AlertCircle, X } from "lucide-react";

import useClientReady from "@/hooks/useClientReady";
import styles from "./FloatingNotice.module.scss";

export default function FloatingNotice({ notice, onClose }) {
  const canRenderPortal = useClientReady();

  if (!canRenderPortal || !notice || notice.type !== "error") {
    return null;
  }

  return createPortal(
    <div
      className={`${styles.toast} ${notice.isLeaving ? styles.toastLeaving : ""}`}
      role="alert"
      aria-live="assertive"
    >
      <div className={styles.toastIcon}>
        <AlertCircle size={18} />
      </div>
      <div className={styles.toastContent}>
        <p className={styles.toastTitle}>
          Algo necesita atención
        </p>
        <p className={styles.toastMessage}>{notice.message}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className={styles.toastClose}
        aria-label="Cerrar aviso"
      >
        <X size={16} />
      </button>
    </div>,
    document.body,
  );
}
