"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import styles from "./LoginForm.module.scss";

function PasswordInput({ id, name, label, autoComplete }) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>{label}</label>
      <div className={styles.passwordControl}>
        <input
          id={id}
          name={name}
          type={isVisible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          className={styles.input}
        />
        <button
          type="button"
          className={styles.visibilityToggle}
          onClick={() => setIsVisible((visible) => !visible)}
          aria-label={isVisible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
          aria-pressed={isVisible}
        >
          {isVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

export default function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [username, setUsername] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setError("");
    setSuccess("");

    startTransition(async () => {
      try {
        const isChangingPassword = mode === "change-password";
        const response = await fetch(
          isChangingPassword ? "/api/auth/change-password" : "/api/auth/login",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(isChangingPassword
              ? {
                  username: formData.get("username"),
                  currentPassword: formData.get("currentPassword"),
                  newPassword: formData.get("newPassword"),
                }
              : {
                  username: formData.get("username"),
                  password: formData.get("password"),
                }),
          },
        );

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            payload.error || (isChangingPassword
              ? "No se pudo cambiar la contraseña."
              : "No se pudo iniciar sesión."),
          );
        }

        if (isChangingPassword) {
          setMode("login");
          setSuccess(payload.message || "Contraseña actualizada. Ya puedes iniciar sesión.");
          return;
        }

        router.push(payload.redirectTo || "/modules");
        router.refresh();
      } catch (requestError) {
        setError(requestError.message);
      }
    });
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setError("");
    setSuccess("");
  }

  const isChangingPassword = mode === "change-password";

  return (
    <section className={styles.panel}>
      <p className={styles.eyebrow}>{isChangingPassword ? "Seguridad de la cuenta" : "Iniciar sesión"}</p>
      <h2 className={styles.title}>
        {isChangingPassword ? "Cambia tu contraseña de acceso" : "Ingresa al sistema con tu cuenta autorizada"}
      </h2>
      <p className={styles.description}>
        {isChangingPassword
          ? "Confirma tu usuario y contraseña actual para establecer una nueva."
          : "Tus credenciales permiten acceder al sistema integral de CHIMG y a los módulos habilitados dentro de la plataforma interna."}
      </p>

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="login-username" className={styles.label}>Usuario</label>
          <input
            id="login-username"
            name="username"
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={styles.input}
          />
        </div>

        {isChangingPassword ? (
          <>
            <PasswordInput
              key="current-password"
              id="current-password"
              name="currentPassword"
              label="Contraseña actual"
              autoComplete="current-password"
            />
            <PasswordInput
              key="new-password"
              id="new-password"
              name="newPassword"
              label="Nueva contraseña"
              autoComplete="new-password"
            />
            <p className={styles.passwordHint}>Debe tener al menos 6 caracteres.</p>
          </>
        ) : (
          <PasswordInput
            key="login-password"
            id="login-password"
            name="password"
            label="Contraseña"
            autoComplete="current-password"
          />
        )}

        <button
          type="submit"
          disabled={isPending}
          className={styles.submit}
        >
          {isPending
            ? (isChangingPassword ? "Actualizando..." : "Validando...")
            : (isChangingPassword ? "Cambiar contraseña" : "Entrar")}
        </button>

        {error ? <div className={styles.error}>{error}</div> : null}
        {success ? <div className={styles.success}>{success}</div> : null}

        <button
          type="button"
          className={styles.modeToggle}
          onClick={() => changeMode(isChangingPassword ? "login" : "change-password")}
          disabled={isPending}
        >
          {isChangingPassword ? "Volver a iniciar sesión" : "Cambiar mi contraseña"}
        </button>
      </form>
    </section>
  );
}
