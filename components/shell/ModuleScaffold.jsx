import TransitionLink from "@/components/navigation/TransitionLink";
import styles from "./ModuleScaffold.module.scss";

export default function ModuleScaffold({
  eyebrow = "Módulo",
  title,
  description,
  sections = [],
  highlights = [],
  legacyLinks = [],
  futureNote = "",
}) {
  return (
    <div className={styles.stack}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.description}>{description}</p>
      </section>

      {highlights.length ? (
        <section className={styles.highlightGrid}>
          {highlights.map((item) => (
            <article key={item.label} className={styles.highlightCard}>
              <span className={styles.highlightLabel}>{item.label}</span>
              <strong className={styles.highlightValue}>{item.value}</strong>
              {item.help ? <p className={styles.highlightHelp}>{item.help}</p> : null}
            </article>
          ))}
        </section>
      ) : null}

      {sections.length ? (
        <section className={styles.sectionGrid}>
          {sections.map((section) => (
            <article key={section.title} className={styles.sectionCard}>
              <div>
                <p className={styles.sectionEyebrow}>{section.eyebrow || "Página"}</p>
                <h3 className={styles.sectionTitle}>{section.title}</h3>
                <p className={styles.sectionDescription}>{section.description}</p>
              </div>

              {section.bullets?.length ? (
                <ul className={styles.bulletList}>
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}

              {section.href ? (
                <TransitionLink href={section.href} className={styles.sectionLink}>
                  Abrir página
                </TransitionLink>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {legacyLinks.length ? (
        <section className={styles.legacyPanel}>
          <div>
            <p className={styles.sectionEyebrow}>Base actual</p>
            <h3 className={styles.sectionTitle}>Módulos ya existentes</h3>
            <p className={styles.sectionDescription}>
              Estos accesos aprovechan funcionalidades que ya existen y pueden servir como punto de partida mientras
              construimos la versión nueva.
            </p>
          </div>

          <div className={styles.legacyLinks}>
            {legacyLinks.map((item) => (
              <TransitionLink key={item.href} href={item.href} className={styles.legacyLink}>
                <span className={styles.legacyLabel}>{item.label}</span>
                <span className={styles.legacyDescription}>{item.description}</span>
              </TransitionLink>
            ))}
          </div>
        </section>
      ) : null}

      {futureNote ? (
        <section className={styles.futureNote}>
          <p>{futureNote}</p>
        </section>
      ) : null}
    </div>
  );
}
