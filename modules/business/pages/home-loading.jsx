import ModuleShell from "@/components/shell/ModuleShell";
import { BUSINESS_MODULE } from "@/modules/business/module";
import styles from "@/modules/business/styles/pages/home-page.module.scss";

export default function BusinessHomeLoading() {
  return (
    <ModuleShell moduleConfig={BUSINESS_MODULE} title="Negocio" description="Resumen del inventario y de la operación de contingencia.">
      <div className={`${styles.page} ${styles.loadingPage}`} aria-hidden="true">
        <section className={styles.hero}><div className={`${styles.skeleton} ${styles.skeletonHero}`} /><div className={`${styles.skeleton} ${styles.skeletonPill}`} /></section>
        <section className={styles.metrics}>{Array.from({ length: 4 }).map((_, index) => <article key={index} className={styles.metricCard}><div className={`${styles.skeleton} ${styles.skeletonIcon}`} /><div className={`${styles.skeleton} ${styles.skeletonCopy}`} /></article>)}</section>
        <section className={styles.mainGrid}>{Array.from({ length: 2 }).map((_, index) => <div key={index} className={`${styles.skeleton} ${styles.skeletonPanel}`} />)}</section>
      </div>
    </ModuleShell>
  );
}
