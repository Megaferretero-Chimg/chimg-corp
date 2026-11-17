"use client";

import { ChevronDown, List, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import styles from "@/modules/academy/styles/learning.module.scss";

export default function CourseOutline({ activeTitle, children }) {
  const dialogRef = useRef(null);
  const dialogId = useId();
  const titleId = useId();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const mobile = window.matchMedia("(max-width: 850px)");
    dialogRef.current.querySelector('[aria-current="step"]')?.scrollIntoView({ block: "nearest" });
    function closeOnDesktop() {
      if (!mobile.matches) dialogRef.current?.close();
    }

    document.body.style.overflow = "hidden";
    mobile.addEventListener("change", closeOnDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      mobile.removeEventListener("change", closeOnDesktop);
    };
  }, [isOpen]);

  return (
    <>
      <div className={styles.desktopOutline}>{children}</div>
      <button
        type="button"
        className={styles.outlineTrigger}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={dialogId}
        onClick={() => {
          dialogRef.current.showModal();
          setIsOpen(true);
        }}
      >
        <List size={18} aria-hidden="true" />
        <span><strong>Contenido del curso</strong><span>{activeTitle}</span></span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <dialog
        ref={dialogRef}
        id={dialogId}
        className={styles.outlineDialog}
        aria-labelledby={titleId}
        onClose={() => setIsOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget || event.target.closest("a[href]")) {
            dialogRef.current.close();
          }
        }}
      >
        <header className={styles.outlineDialogHeader}>
          <h2 id={titleId}>Contenido del curso</h2>
          <button type="button" onClick={() => dialogRef.current.close()} aria-label="Cerrar contenido del curso">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {children}
      </dialog>
    </>
  );
}
