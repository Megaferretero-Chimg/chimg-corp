import Image from "next/image";
import Link from "next/link";

import { getLearner } from "@/modules/academy/lib/learner-access";
import { ACADEMY_LEARNING } from "@/modules/academy/module";
import styles from "@/modules/academy/styles/learning.module.scss";

export default async function LearningLayout({ children }) {
  await getLearner();
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href={ACADEMY_LEARNING.href}>
          <Image src="/imgs/logo-chimg.png" alt="CHIMG" width={56} height={32} />
          <span>Academia</span>
        </Link>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
