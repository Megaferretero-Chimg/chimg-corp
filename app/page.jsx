import Image from "next/image";
import { redirect } from "next/navigation";

import LoginForm from "@/components/auth/LoginForm";
import { getDefaultLandingPathForUser } from "@/lib/access-control";
import { getAuthenticatedUser } from "@/lib/auth";
import styles from "./page.module.scss";

export default async function HomePage() {
  const user = await getAuthenticatedUser();

  if (user) {
    redirect(getDefaultLandingPathForUser(user));
  }

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <aside className={styles.hero}>
          <div className={styles.brand}>
            <div className={styles.logoWrap}>
              <Image
                src="/imgs/logo-chimg.png"
                alt="Logo de la empresa"
                width={48}
                height={48}
                className={styles.logo}
                priority
              />
            </div>

            <div>
              <p className={styles.eyebrow}>Sistema Interno</p>
              <p className={styles.brandName}>CHIMG</p>
            </div>
          </div>

          <h1 className={styles.title}>Acceso al sistema integral de CHIMG</h1>
          <p className={styles.description}>
            Desde aquí puedes ingresar al sistema integral de CHIMG, autenticarte con tu cuenta autorizada y luego seleccionar el módulo con el que deseas trabajar dentro de la plataforma.
          </p>
        </aside>

        <LoginForm />
      </section>
    </main>
  );
}
