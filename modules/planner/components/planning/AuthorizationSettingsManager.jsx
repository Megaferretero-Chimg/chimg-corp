"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Save } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import styles from "@/modules/planner/styles/components/planning/AuthorizationSettingsManager.module.scss";

const DEFAULT_CONFIG = {
  requireSupplementaryAuthorization: true,
  requireExtraordinaryAuthorization: true,
  requireHolidayWorkAuthorization: true,
  requireScheduleChangeAuthorization: false,
  requireTimeOffAuthorization: true,
  defaultAuthorizedSupplementaryMinutesPerDay: 60,
  supplementaryAuthorizationThresholdMinutes: 60,
  extraordinaryAuthorizationThresholdMinutes: 1,
  authorizationToleranceMinutes: 10,
  maxAuthorizableMinutesPerDay: 180,
  maxAuthorizableMinutesPerWeek: 600,
  requireSupplementaryJustification: true,
  requireExtraordinaryJustification: true,
  requireHolidayWorkJustification: true,
  allowRetroactiveAuthorization: true,
  retroactiveAuthorizationDays: 5,
  includeOnlyAuthorizedInPayroll: true,
  defaultAuthorizationScope: "day",
  requiresDoubleApproval: false,
  authorizerRoleCodes: ["admin", "supervisor"],
  notes: "",
};

const SCOPE_OPTIONS = [
  { value: "day", label: "Por dia" },
  { value: "date_range", label: "Rango de fechas" },
  { value: "event", label: "Evento puntual" },
];

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function buildSignature(config) {
  return JSON.stringify({
    requireSupplementaryAuthorization: Boolean(config.requireSupplementaryAuthorization),
    requireExtraordinaryAuthorization: Boolean(config.requireExtraordinaryAuthorization),
    requireHolidayWorkAuthorization: Boolean(config.requireHolidayWorkAuthorization),
    requireScheduleChangeAuthorization: Boolean(config.requireScheduleChangeAuthorization),
    requireTimeOffAuthorization: Boolean(config.requireTimeOffAuthorization),
    defaultAuthorizedSupplementaryMinutesPerDay: toNumber(config.defaultAuthorizedSupplementaryMinutesPerDay),
    supplementaryAuthorizationThresholdMinutes: toNumber(config.supplementaryAuthorizationThresholdMinutes),
    extraordinaryAuthorizationThresholdMinutes: toNumber(config.extraordinaryAuthorizationThresholdMinutes),
    authorizationToleranceMinutes: toNumber(config.authorizationToleranceMinutes),
    maxAuthorizableMinutesPerDay: toNumber(config.maxAuthorizableMinutesPerDay),
    maxAuthorizableMinutesPerWeek: toNumber(config.maxAuthorizableMinutesPerWeek),
    requireSupplementaryJustification: Boolean(config.requireSupplementaryJustification),
    requireExtraordinaryJustification: Boolean(config.requireExtraordinaryJustification),
    requireHolidayWorkJustification: Boolean(config.requireHolidayWorkJustification),
    allowRetroactiveAuthorization: Boolean(config.allowRetroactiveAuthorization),
    retroactiveAuthorizationDays: toNumber(config.retroactiveAuthorizationDays),
    includeOnlyAuthorizedInPayroll: Boolean(config.includeOnlyAuthorizedInPayroll),
    defaultAuthorizationScope: config.defaultAuthorizationScope || "day",
    requiresDoubleApproval: Boolean(config.requiresDoubleApproval),
    authorizerRoleCodes: [...(config.authorizerRoleCodes || [])].sort(),
    notes: String(config.notes || "").trim(),
  });
}

function ToggleSetting({ label, checked, onChange }) {
  return (
    <div className={styles.toggleField}>
      <span className={styles.toggleLabel}>{label}</span>
      <button
        type="button"
        className={`catalog-switch ${checked ? "is-active" : ""}`}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
      >
        <span className="catalog-switchKnob" />
        <span>{checked ? "Activo" : "Inactivo"}</span>
      </button>
    </div>
  );
}

export default function AuthorizationSettingsManager() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [savedSignature, setSavedSignature] = useState("");
  const [userTypes, setUserTypes] = useState([]);
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const hasChanges = savedSignature && buildSignature(config) !== savedSignature;

  const activeUserTypes = useMemo(
    () => userTypes.filter((type) => type.isActive !== false),
    [userTypes],
  );

  const clearNoticeTimers = useCallback(() => {
    if (noticeExitTimeoutRef.current) {
      window.clearTimeout(noticeExitTimeoutRef.current);
      noticeExitTimeoutRef.current = null;
    }

    if (noticeRemoveTimeoutRef.current) {
      window.clearTimeout(noticeRemoveTimeoutRef.current);
      noticeRemoveTimeoutRef.current = null;
    }
  }, []);

  const dismissNotice = useCallback(() => {
    clearNoticeTimers();
    setNotice((current) => (current ? { ...current, isLeaving: true } : null));
    noticeRemoveTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeRemoveTimeoutRef.current = null;
    }, 240);
  }, [clearNoticeTimers]);

  const showNotice = useCallback((type, message) => {
    clearNoticeTimers();
    setNotice({ type, message, isLeaving: false });
    noticeExitTimeoutRef.current = window.setTimeout(() => {
      dismissNotice();
    }, 4000);
  }, [clearNoticeTimers, dismissNotice]);

  function updateField(name, value) {
    setConfig((current) => ({ ...current, [name]: value }));
  }

  function toggleRole(code) {
    setConfig((current) => {
      const currentCodes = new Set(current.authorizerRoleCodes || []);

      if (currentCodes.has(code)) {
        currentCodes.delete(code);
      } else {
        currentCodes.add(code);
      }

      return {
        ...current,
        authorizerRoleCodes: [...currentCodes],
      };
    });
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      try {
        const [configResponse, userTypesResponse] = await Promise.all([
          fetch("/api/planner/planning/authorizations"),
          fetch("/api/company/user-types"),
        ]);
        const [configPayload, userTypesPayload] = await Promise.all([
          configResponse.json(),
          userTypesResponse.json(),
        ]);

        if (!configResponse.ok) {
          throw new Error(configPayload.error || "No se pudo cargar la configuracion.");
        }

        if (!userTypesResponse.ok) {
          throw new Error(userTypesPayload.error || "No se pudieron cargar los roles de acceso.");
        }

        if (!isCancelled) {
          const loadedConfig = { ...DEFAULT_CONFIG, ...(configPayload.config || {}) };
          setConfig(loadedConfig);
          setSavedSignature(buildSignature(loadedConfig));
          setUserTypes(userTypesPayload.userTypes || []);
        }
      } catch (error) {
        if (!isCancelled) {
          showNotice("error", error.message);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isCancelled = true;
      clearNoticeTimers();
    };
  }, [clearNoticeTimers, showNotice]);

  function handleSubmit(event) {
    event.preventDefault();

    if (!hasChanges || isPending) {
      return;
    }

    setIsConfirmOpen(true);
  }

  function confirmSave() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/planning/authorizations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar la configuracion.");
        }

        const savedConfig = { ...DEFAULT_CONFIG, ...(payload.config || {}) };
        setConfig(savedConfig);
        setSavedSignature(buildSignature(savedConfig));
        setIsConfirmOpen(false);
        showNotice("success", payload.message);
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  if (isLoading) {
    return <div className={styles.loading}>Cargando configuracion de autorizaciones...</div>;
  }

  return (
    <form className={styles.stack} onSubmit={handleSubmit}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="Guardar autorizaciones"
        message="Estas reglas definiran que casos detectados por horarios y picadas requieren aprobacion antes de considerarse autorizados."
        confirmLabel={isPending ? "Guardando..." : "Guardar reglas"}
        cancelLabel="Revisar"
        tone="info"
        isPending={isPending}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={confirmSave}
      />

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Requiere autorizacion</p>
            <h2 className={styles.title}>Casos que deben revisarse</h2>
            <p className={styles.description}>
              Define cuando una diferencia detectada debe pasar por aprobacion antes de impactar nómina.
            </p>
          </div>
        </div>

        <div className={styles.toggleGrid}>
          <ToggleSetting label="Horas suplementarias" checked={config.requireSupplementaryAuthorization} onChange={(value) => updateField("requireSupplementaryAuthorization", value)} />
          <ToggleSetting label="Horas extraordinarias" checked={config.requireExtraordinaryAuthorization} onChange={(value) => updateField("requireExtraordinaryAuthorization", value)} />
          <ToggleSetting label="Trabajo en feriado" checked={config.requireHolidayWorkAuthorization} onChange={(value) => updateField("requireHolidayWorkAuthorization", value)} />
          <ToggleSetting label="Cambios manuales de horario" checked={config.requireScheduleChangeAuthorization} onChange={(value) => updateField("requireScheduleChangeAuthorization", value)} />
          <ToggleSetting label="Permisos y ausencias justificadas" checked={config.requireTimeOffAuthorization} onChange={(value) => updateField("requireTimeOffAuthorization", value)} />
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Umbrales</p>
            <h2 className={styles.title}>Minutos autorizables</h2>
          </div>
        </div>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Suplementaria autorizada por defecto al dia (min)</span>
            <input type="number" min="0" value={config.defaultAuthorizedSupplementaryMinutesPerDay} onChange={(event) => updateField("defaultAuthorizedSupplementaryMinutesPerDay", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Solicitar autorizacion suplementaria desde (min)</span>
            <input type="number" min="0" value={config.supplementaryAuthorizationThresholdMinutes} onChange={(event) => updateField("supplementaryAuthorizationThresholdMinutes", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Solicitar autorizacion extraordinaria desde (min)</span>
            <input type="number" min="0" value={config.extraordinaryAuthorizationThresholdMinutes} onChange={(event) => updateField("extraordinaryAuthorizationThresholdMinutes", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Tolerancia sin autorizacion (min)</span>
            <input type="number" min="0" value={config.authorizationToleranceMinutes} onChange={(event) => updateField("authorizationToleranceMinutes", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Maximo autorizable por dia (min)</span>
            <input type="number" min="0" value={config.maxAuthorizableMinutesPerDay} onChange={(event) => updateField("maxAuthorizableMinutesPerDay", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Maximo autorizable por semana (min)</span>
            <input type="number" min="0" value={config.maxAuthorizableMinutesPerWeek} onChange={(event) => updateField("maxAuthorizableMinutesPerWeek", event.target.value)} />
          </label>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Justificacion y nómina</p>
            <h2 className={styles.title}>Reglas de aplicacion</h2>
          </div>
        </div>

        <div className={styles.toggleGrid}>
          <ToggleSetting label="Justificacion para suplementarias" checked={config.requireSupplementaryJustification} onChange={(value) => updateField("requireSupplementaryJustification", value)} />
          <ToggleSetting label="Justificacion para extraordinarias" checked={config.requireExtraordinaryJustification} onChange={(value) => updateField("requireExtraordinaryJustification", value)} />
          <ToggleSetting label="Justificacion para feriados" checked={config.requireHolidayWorkJustification} onChange={(value) => updateField("requireHolidayWorkJustification", value)} />
          <ToggleSetting label="Permitir autorizacion retroactiva" checked={config.allowRetroactiveAuthorization} onChange={(value) => updateField("allowRetroactiveAuthorization", value)} />
          <ToggleSetting label="Incluir en nómina solo si esta autorizado" checked={config.includeOnlyAuthorizedInPayroll} onChange={(value) => updateField("includeOnlyAuthorizedInPayroll", value)} />
          <ToggleSetting label="Requiere doble aprobacion" checked={config.requiresDoubleApproval} onChange={(value) => updateField("requiresDoubleApproval", value)} />
        </div>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Dias maximos para autorizar retroactivo</span>
            <input type="number" min="0" value={config.retroactiveAuthorizationDays} onChange={(event) => updateField("retroactiveAuthorizationDays", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Alcance default</span>
            <select value={config.defaultAuthorizationScope} onChange={(event) => updateField("defaultAuthorizationScope", event.target.value)}>
              {SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Roles autorizadores</p>
            <h2 className={styles.title}>Quien puede aprobar</h2>
          </div>
        </div>

        <div className={styles.roleGrid}>
          {activeUserTypes.map((role) => {
            const active = (config.authorizerRoleCodes || []).includes(role.code);

            return (
              <button
                key={role.code}
                type="button"
                className={`${styles.roleButton} ${active ? styles.roleButtonActive : ""}`}
                onClick={() => toggleRole(role.code)}
                aria-pressed={active}
              >
                <strong>{role.name}</strong>
                <span>{role.description || role.code}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.panel}>
        <label className={styles.field}>
          <span>Notas operativas</span>
          <textarea value={config.notes} onChange={(event) => updateField("notes", event.target.value)} rows={4} placeholder="Ej. Supervisor valida suplementarias por cierre de local." />
        </label>
      </section>

      <div className={styles.actions}>
        <button type="submit" className={styles.primaryButton} disabled={isPending || !hasChanges}>
          <Save size={16} />
          {isPending ? "Guardando..." : hasChanges ? "Guardar autorizaciones" : "Sin cambios"}
        </button>
      </div>
    </form>
  );
}
