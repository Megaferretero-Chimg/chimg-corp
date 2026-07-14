import { RefreshCw } from "lucide-react";

import styles from "@/modules/planner/styles/components/reports/MonthlyReportsView.module.scss";

export default function MonthlyReportsLoadingState() {
  return (
    <section className={`${styles.workspace} ${styles.routeLoading}`} aria-label="Cargando reporte mensual">
      <main className={styles.reportCanvas}>
        <div className={styles.loadingOverlay} role="status" aria-live="polite">
          <RefreshCw size={18} />
          <span>Preparando reporte mensual</span>
        </div>

        <header className={styles.reportHero} aria-hidden="true">
          <div className={styles.loadingHeroCopy}>
            <span className={styles.skeletonLineShort} />
            <span className={styles.skeletonTitle} />
            <span className={styles.skeletonLine} />
          </div>
          <div className={styles.heroActions}>
            <div className={styles.loadingField} />
            <div className={styles.loadingStatus} />
          </div>
        </header>

        <div className={styles.insightStrip} aria-hidden="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <article key={index} className={styles.loadingInsight}>
              <span className={styles.skeletonLineShort} />
              <strong className={styles.skeletonLineLarge} />
              <small className={styles.skeletonLine} />
            </article>
          ))}
        </div>

        <section className={styles.reportBlock} aria-hidden="true">
          <div className={styles.blockHeader}>
            <span className={styles.skeletonLineShort} />
            <small>
              <RefreshCw size={14} className={styles.loadingSpin} />
              Actualizando
            </small>
          </div>
          <div className={styles.metricGrid}>
            {Array.from({ length: 4 }).map((_, index) => (
              <article key={index} className={styles.metricSkeleton}>
                <span className={styles.skeletonLineShort} />
                <strong className={styles.skeletonLineLarge} />
                <small className={styles.skeletonLine} />
              </article>
            ))}
          </div>
        </section>

        <section className={styles.reportBlock} aria-hidden="true">
          <div className={styles.blockHeader}>
            <span className={styles.skeletonLineShort} />
          </div>
          <div className={styles.loadingComparison}>
            <div className={styles.loadingBars}>
              <span />
              <span />
            </div>
            <div className={styles.loadingVariance} />
          </div>
        </section>

        <section className={styles.tableSection} aria-hidden="true">
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.skeletonLineShort} />
              <strong className={styles.skeletonLine} />
            </div>
          </div>
          <div className={styles.loadingTable}>
            {Array.from({ length: 5 }).map((_, index) => (
              <span key={index} />
            ))}
          </div>
        </section>
      </main>
    </section>
  );
}
