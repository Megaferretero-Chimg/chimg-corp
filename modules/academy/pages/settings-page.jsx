import connectToDatabase from "@/lib/db/mongodb";
import AcademyShell from "@/modules/academy/components/AcademyShell";
import CourseCategorySettings from "@/modules/academy/components/CourseCategorySettings";
import { listCourseCategories } from "@/modules/academy/lib/course-categories";
import { ACADEMY_SETTINGS_PATH } from "@/modules/academy/module";
import styles from "@/modules/academy/styles/settings.module.scss";

export const metadata = { title: "Configuración | Academia" };

export default function AcademySettingsPage() {
  return (
    <AcademyShell path={ACADEMY_SETTINGS_PATH} title="Configuración de Academia" description="Personaliza las opciones que usa el módulo de capacitación.">
      {async () => {
        await connectToDatabase();
        const categories = await listCourseCategories();

        return (
          <div className={styles.sections}>
            <CourseCategorySettings categories={categories} />
          </div>
        );
      }}
    </AcademyShell>
  );
}
