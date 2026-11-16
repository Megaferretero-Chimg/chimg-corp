"use client";

import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { useActionState, useCallback, useState } from "react";

import FloatingModal from "@/components/ui/FloatingModal";
import { manageCategory } from "@/modules/academy/actions/manage-category";
import { createCategory } from "@/modules/academy/actions/create-category";
import adminStyles from "@/modules/academy/styles/admin.module.scss";
import styles from "@/modules/academy/styles/settings.module.scss";

export default function CourseCategorySettings({ categories }) {
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const close = useCallback(() => setModal(null), []);

  return (
    <section className={styles.panel} aria-labelledby="course-categories-title">
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.icon}><Tags size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="course-categories-title">Categorías de cursos</h2>
            <p>Organiza el catálogo con categorías que puedes seleccionar al crear o editar un curso.</p>
          </div>
        </div>
        <button
          type="button"
          className={`${adminStyles.primary} ${styles.create}`}
          onClick={() => {
            setNotice("");
            setModal({ intent: "create" });
          }}
        >
          <Plus size={17} aria-hidden="true" /> Nueva categoría
        </button>
      </header>

      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label="Categorías de cursos">
          <thead>
            <tr><th scope="col">Nombre</th><th scope="col">Origen</th><th scope="col">Acciones</th></tr>
          </thead>
          <tbody>
            {categories.map(({ value, label, builtIn }) => (
              <tr key={value}>
                <th scope="row">{label}</th>
                <td><span className={styles.badge} data-built-in={builtIn}>{builtIn ? "Predeterminada" : "Personalizada"}</span></td>
                <td>
                  <div className={styles.actions}>
                    <button type="button" aria-label={`Editar ${label}`} title="Editar" onClick={() => setModal({ intent: "edit", value, label })}><Pencil size={17} aria-hidden="true" /></button>
                    <button type="button" className={styles.delete} aria-label={`Eliminar ${label}`} title="Eliminar" onClick={() => setModal({ intent: "delete", value, label })}><Trash2 size={17} aria-hidden="true" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className={styles.footer}>
        <span>{categories.length} {categories.length === 1 ? "categoría" : "categorías"}</span>
        <span role="status">{notice}</span>
      </footer>

      {modal && (
        <CategoryModal modal={modal} onClose={close} onCreated={(message) => {
          setNotice(message);
          close();
        }} />
      )}
    </section>
  );
}

function CategoryModal({ modal, onClose, onCreated }) {
  const [result, action, isPending] = useActionState(async (previous, formData) => {
    const response = await (modal.intent === "create" ? createCategory : manageCategory)(previous, formData);
    if (response.success) onCreated(response.success);
    return response;
  }, null);

  return (
    <FloatingModal isOpen showCloseButton={false} title={modal.intent === "delete" ? "Eliminar categoría" : modal.intent === "edit" ? "Editar categoría" : "Nueva categoría"} isPending={isPending} onClose={onClose}>
      {(requestClose) => (
        <form action={action} className={adminStyles.editor}>
          <input type="hidden" name="id" value={modal.value ?? ""} />
          <input type="hidden" name="intent" value={modal.intent} />
          {modal.intent === "delete" ? (
            <div>
              <p className={styles.categoryName}>{modal.label}</p>
              <p className={styles.deleteHint}>Dejará de estar disponible al crear o editar cursos.</p>
            </div>
          ) : (
            <label>Nombre de la categoría
              <input name="name" defaultValue={modal.label ?? ""} placeholder="Ej. Seguridad laboral" required maxLength={80} disabled={isPending} />
            </label>
          )}
          {result?.error && <p className={adminStyles.error} role="alert">{result.error}</p>}
          <div className={`${adminStyles.toolbar} ${styles.modalActions}`}>
            <button className={modal.intent === "delete" ? `${adminStyles.primary} ${styles.dangerButton}` : adminStyles.primary} disabled={isPending}>{isPending ? "Guardando…" : modal.intent === "delete" ? "Eliminar" : modal.intent === "edit" ? "Guardar" : "Crear"}</button>
            <button type="button" onClick={requestClose} disabled={isPending}>Cancelar</button>
          </div>
        </form>
      )}
    </FloatingModal>
  );
}
