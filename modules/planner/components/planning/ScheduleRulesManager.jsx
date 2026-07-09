"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Save } from "lucide-react";

import TextInput from "@/components/ui/TextInput";
import styles from "@/modules/planner/styles/components/planning/ScheduleRulesManager.module.scss";

const DEFAULT_CONFIG = {
  lateToleranceMinutes: 10,
  earlyLeaveToleranceMinutes: 5,
  lateDepartureToleranceMinutes: 20,
};

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function buildSignature(config) {
  return JSON.stringify({
    lateToleranceMinutes: toNumber(config.lateToleranceMinutes),
    earlyLeaveToleranceMinutes: toNumber(config.earlyLeaveToleranceMinutes),
    lateDepartureToleranceMinutes: toNumber(config.lateDepartureToleranceMinutes),
  });
}

export default function ScheduleRulesManager() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [savedSignature, setSavedSignature] = useState("");
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const hasChanges = savedSignature && buildSignature(config) !== savedSignature;

  const statusLabel = useMemo(() => {
    const minutes = toNumber(config.lateToleranceMinutes);

    return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
  }, [config.lateToleranceMinutes]);
  const earlyLeaveStatusLabel = useMemo(() => {
    const minutes = toNumber(config.earlyLeaveToleranceMinutes);

    return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
  }, [config.earlyLeaveToleranceMinutes]);
  const lateDepartureStatusLabel = useMemo(() => {
    const minutes = toNumber(config.lateDepartureToleranceMinutes);

    return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
  }, [config.lateDepartureToleranceMinutes]);

  useEffect(() => {
    let isActive = true;

    async function loadInitialConfig() {
      try {
        const response = await fetch("/api/planner/planning/schedule-rules");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudieron cargar las reglas de horario.");
        }

        if (!isActive) return;

        const nextConfig = {
          ...DEFAULT_CONFIG,
          ...(payload.config || {}),
        };

        setConfig(nextConfig);
        setSavedSignature(buildSignature(nextConfig));
      } catch (loadError) {
        if (isActive) {
          setError(loadError.message || "No se pudieron cargar las reglas de horario.");
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadInitialConfig();

    return () => {
      isActive = false;
    };
  }, []);

  function updateField(field, value) {
    setConfig((current) => ({
      ...current,
      [field]: value,
    }));
    setSaveMessage("");
    setError("");
  }

  function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSaveMessage("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/planning/schedule-rules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lateToleranceMinutes: toNumber(config.lateToleranceMinutes),
            earlyLeaveToleranceMinutes: toNumber(config.earlyLeaveToleranceMinutes),
            lateDepartureToleranceMinutes: toNumber(config.lateDepartureToleranceMinutes),
          }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudieron guardar las reglas de horario.");
        }

        const nextConfig = {
          ...DEFAULT_CONFIG,
          ...(payload.config || {}),
        };

        setConfig(nextConfig);
        setSavedSignature(buildSignature(nextConfig));
        setSaveMessage("Reglas guardadas.");
      } catch (saveError) {
        setError(saveError.message || "No se pudieron guardar las reglas de horario.");
      }
    });
  }

  if (isLoading) {
    return (
      <div className={styles.loading} aria-live="polite">
        <span />
        <span />
        <span />
      </div>
    );
  }

  return (
    <form className={styles.shell} onSubmit={handleSubmit}>
      <div className={styles.toolbar}>
        <div className={styles.metrics}>
          <span>
            Atrasos <strong>{statusLabel}</strong>
          </span>
          <span>
            Salida anticipada <strong>{earlyLeaveStatusLabel}</strong>
          </span>
          <span>
            Salida tardía <strong>{lateDepartureStatusLabel}</strong>
          </span>
        </div>
        <button className={styles.primaryButton} type="submit" disabled={!hasChanges || isPending}>
          <Save size={16} />
          {isPending ? "Guardando" : "Guardar"}
        </button>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {saveMessage ? <p className={styles.saved}>{saveMessage}</p> : null}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <span>Regla activa</span>
            <strong>Margenes de tolerancia del horario</strong>
          </div>
        </div>
        <div className={styles.grid}>
          <TextInput
            label="Atraso permitido (min)"
            type="number"
            min="0"
            max="180"
            value={config.lateToleranceMinutes}
            onChange={(event) => updateField("lateToleranceMinutes", event.target.value)}
          />
          <TextInput
            label="Salida anticipada permitida (min)"
            type="number"
            min="0"
            max="180"
            value={config.earlyLeaveToleranceMinutes}
            onChange={(event) => updateField("earlyLeaveToleranceMinutes", event.target.value)}
          />
          <TextInput
            label="Salida tardía permitida (min)"
            type="number"
            min="0"
            max="180"
            value={config.lateDepartureToleranceMinutes}
            onChange={(event) => updateField("lateDepartureToleranceMinutes", event.target.value)}
          />
        </div>
      </section>
    </form>
  );
}
