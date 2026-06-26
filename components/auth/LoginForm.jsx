"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import styles from "./LoginForm.module.scss";

export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setError("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: formData.get("username"),
            password: formData.get("password"),
          }),
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo iniciar sesión.");
        }

        router.push(payload.redirectTo || "/modules");
        router.refresh();
      } catch (requestError) {
        setError(requestError.message);
      }
    });
  }

  return (
    <section className={styles.panel}>
      <p className={styles.eyebrow}>Iniciar sesión</p>
      <h2 className={styles.title}>Ingresa al sistema con tu cuenta autorizada</h2>
      <p className={styles.description}>
        Tus credenciales permiten acceder al sistema integral de CHIMG y a los módulos habilitados dentro de la plataforma interna.
      </p>

      <form onSubmit={handleSubmit} className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>Usuario</span>
          <input
            name="username"
            type="text"
            autoComplete="username"
            required
            className={styles.input}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Clave</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={styles.input}
          />
        </label>

        <button
          type="submit"
          disabled={isPending}
          className={styles.submit}
        >
          {isPending ? "Validando..." : "Entrar"}
        </button>

        {error ? <div className={styles.error}>{error}</div> : null}
      </form>
    </section>
  );
}
