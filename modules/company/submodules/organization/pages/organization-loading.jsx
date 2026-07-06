import ModuleShell from "@/components/shell/ModuleShell";
import { COMPANY_MODULE } from "@/modules/company/module";
import styles from "@/modules/company/submodules/organization/styles/pages/organization-page.module.scss";

export default function CompanyOrganizationLoading() {
  return (
    <ModuleShell
      moduleConfig={COMPANY_MODULE}
      title="Empresa"
      description="Resumen compacto de la estructura organizacional y calidad de información base."
    >
      <div className={`${styles.page} ${styles.loadingPage}`} aria-hidden="true">
        <section className={styles.hero}>
          <div className={styles.loadingHeroCopy}>
            <div className={styles.skeletonEyebrow} />
            <div className={styles.skeletonTitle} />
            <div className={styles.skeletonTextWide} />
            <div className={styles.skeletonText} />
          </div>

          <div className={styles.skeletonPill} />
        </section>

        <section className={styles.metricsGrid}>
          {Array.from({ length: 4 }).map((_, index) => (
            <article key={index} className={styles.metricCard}>
              <div className={styles.skeletonIcon} />
              <div>
                <div className={styles.skeletonLabel} />
                <div className={styles.skeletonMetric} />
                <div className={styles.skeletonTextShort} />
              </div>
            </article>
          ))}
        </section>

        <section className={styles.mainGrid}>
          {Array.from({ length: 4 }).map((_, panelIndex) => (
            <section key={panelIndex} className={styles.panel}>
              <div className={styles.skeletonPanelTitle} />
              <div className={styles.skeletonTextWide} />

              <div className={styles.loadingRows}>
                {Array.from({ length: 3 }).map((__, rowIndex) => (
                  <div key={rowIndex} className={styles.loadingRow}>
                    <div className={styles.loadingRowHead}>
                      <div className={styles.skeletonLabelWide} />
                      <div className={styles.skeletonNumber} />
                    </div>
                    <div className={styles.skeletonTrack} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </section>

        <section className={styles.structurePanel}>
          <div className={styles.skeletonEyebrow} />
          <div className={styles.skeletonPanelTitle} />

          <div className={styles.structureGrid}>
            {Array.from({ length: 4 }).map((_, index) => (
              <article key={index} className={styles.structureCard}>
                <div className={styles.skeletonMiniIcon} />
                <div>
                  <div className={styles.skeletonLabelWide} />
                  <div className={styles.skeletonTextShort} />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </ModuleShell>
  );
}
