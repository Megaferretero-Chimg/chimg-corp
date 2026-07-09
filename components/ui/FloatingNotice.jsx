"use client";

import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

import useClientReady from "@/hooks/useClientReady";
import styles from "./FloatingNotice.module.scss";

export default function FloatingNotice({ notice, onClose }) {
  const canRenderPortal = useClientReady();

  if (!canRenderPortal || !notice) {
    return null;
  }
  const isSuccess = notice.type === "success";
  const title = isSuccess ? "Accion completada" : "Algo necesita atención";
  const Icon = isSuccess ? CheckCircle2 : AlertCircle;

  return createPortal(
    <div
      className={`${styles.toast} ${isSuccess ? styles.toastSuccess : styles.toastError} ${notice.isLeaving ? styles.toastLeaving : ""}`}
      role={isSuccess ? "status" : "alert"}
      aria-live={isSuccess ? "polite" : "assertive"}
    >
      <div className={styles.toastIcon}>
        <Icon size={18} />
      </div>
      <div className={styles.toastContent}>
        <p className={styles.toastTitle}>
          {title}
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
