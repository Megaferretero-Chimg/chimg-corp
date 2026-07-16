import { ShieldAlert } from "lucide-react";

import styles from "./AccessDenied.module.scss";

export default function AccessDenied() {
  return (
    <main className={styles.overlay} role="alert" aria-live="assertive">
      <section className={styles.card} aria-labelledby="access-denied-title">
        <span className={styles.icon} aria-hidden="true">
          <ShieldAlert size={34} strokeWidth={2.2} />
        </span>
        <div>
          <p className={styles.eyebrow}>Acceso restringido</p>
          <h1 id="access-denied-title">No tienes permiso para acceder aquí</h1>
          <p>Esta página no está habilitada para tu perfil de acceso.</p>
        </div>
      </section>
    </main>
  );
}
