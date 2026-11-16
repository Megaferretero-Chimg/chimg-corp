import Link from "next/link";
import connectToDatabase from "@/lib/db/mongodb";
import AcademyShell from "@/modules/academy/components/AcademyShell";
import Course from "@/modules/academy/models/Course";
import { ACADEMY_ADMIN, ACADEMY_COURSES_PATH } from "@/modules/academy/module";
import styles from "@/modules/academy/styles/admin.module.scss";

export const metadata = { title: "Administración | Academia" };

export default function AcademyAdminPage() {
  return (
    <AcademyShell path={ACADEMY_ADMIN.href} title="Resumen de Academia" description={ACADEMY_ADMIN.description}>
      {async () => {
        await connectToDatabase();
        const [total, published] = await Promise.all([
          Course.countDocuments(),
          Course.countDocuments({ status: "published" }),
        ]);

        return (
          <>
            <div className={styles.metrics}>
              {[["Cursos", total], ["Publicados", published], ["Borradores", total - published]].map(([label, value]) => (
                <article className={styles.panel} key={label}>
                  <h2>{label}</h2>
                  <strong>{value}</strong>
                </article>
              ))}
            </div>
            <div className={styles.toolbar}>
              <Link href={ACADEMY_COURSES_PATH}>Administrar cursos</Link>
              <Link className={styles.primary} href={`${ACADEMY_COURSES_PATH}?edit=new`}>Crear curso</Link>
            </div>
          </>
        );
      }}
    </AcademyShell>
  );
}
