"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Clock3, Plus, Save, Trash2 } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import styles from "@/modules/planner/styles/components/planning/LaborRulesManager.module.scss";

const DEFAULT_RULES = {
  companyStartTime: "07:00",
  companyEndTime: "19:00",
  dailyBaseHours: 8,
  weeklyBaseHours: 40,
  defaultGraceMinutes: 10,
  maxSupplementaryMinutesPerDay: 60,
  maxSupplementaryMinutesPerWeek: 300,
  maxExtraordinaryDaysPerMonth: 2,
  supplementaryMultiplier: 1.5,
  extraordinaryMultiplier: 2,
  paidVacationAsWorkday: true,
  vacationIncludesSupplementaryHour: false,
  areaLunchRules: [],
  roleLunchRules: [],
  payrollNeutralRoleRules: [],
  notes: "",
};

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function buildComparableRules(value) {
  return {
    companyStartTime: String(value?.companyStartTime || "").trim(),
    companyEndTime: String(value?.companyEndTime || "").trim(),
    dailyBaseHours: toNumber(value?.dailyBaseHours),
    weeklyBaseHours: toNumber(value?.weeklyBaseHours),
    defaultGraceMinutes: toNumber(value?.defaultGraceMinutes),
    maxSupplementaryMinutesPerDay: toNumber(value?.maxSupplementaryMinutesPerDay),
    maxSupplementaryMinutesPerWeek: toNumber(value?.maxSupplementaryMinutesPerWeek),
    maxExtraordinaryDaysPerMonth: toNumber(value?.maxExtraordinaryDaysPerMonth),
    supplementaryMultiplier: toNumber(value?.supplementaryMultiplier),
    extraordinaryMultiplier: toNumber(value?.extraordinaryMultiplier),
    paidVacationAsWorkday: Boolean(value?.paidVacationAsWorkday),
    vacationIncludesSupplementaryHour: Boolean(value?.vacationIncludesSupplementaryHour),
    areaLunchRules: (value?.areaLunchRules || []).map((rule) => ({
      areaCode: String(rule?.areaCode || "").trim(),
      areaName: String(rule?.areaName || "").trim(),
      lunchDurationMinutes: toNumber(rule?.lunchDurationMinutes),
    })),
    roleLunchRules: (value?.roleLunchRules || []).map((rule) => ({
      areaCode: String(rule?.areaCode || "").trim(),
      areaName: String(rule?.areaName || "").trim(),
      roleCode: String(rule?.roleCode || "").trim(),
      roleName: String(rule?.roleName || "").trim(),
      lunchDurationMinutes: toNumber(rule?.lunchDurationMinutes),
    })),
    payrollNeutralRoleRules: (value?.payrollNeutralRoleRules || []).map((rule) => ({
      areaCode: String(rule?.areaCode || "").trim(),
      areaName: String(rule?.areaName || "").trim(),
      roleCode: String(rule?.roleCode || "").trim(),
      roleName: String(rule?.roleName || "").trim(),
      label: String(rule?.label || "").trim(),
      scheduleAffectsSalary: Boolean(rule?.scheduleAffectsSalary),
      appliesSupplementaryHours: Boolean(rule?.appliesSupplementaryHours),
      appliesExtraordinaryHours: Boolean(rule?.appliesExtraordinaryHours),
    })),
    notes: String(value?.notes || "").trim(),
  };
}

function buildRulesSignature(value) {
  return JSON.stringify(buildComparableRules(value));
}

export default function LaborRulesManager() {
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [savedRulesSignature, setSavedRulesSignature] = useState("");
  const [areas, setAreas] = useState([]);
  const [roles, setRoles] = useState([]);
  const [source, setSource] = useState("default");
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);

  const monthlyExamples = useMemo(
    () =>
      [19, 20, 21].map((days) => ({
        days,
        baseHours: days * toNumber(rules.dailyBaseHours),
      })),
    [rules.dailyBaseHours],
  );
  const hasChanges = savedRulesSignature && buildRulesSignature(rules) !== savedRulesSignature;

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

    setNotice((current) => {
      if (!current) {
        return null;
      }

      return {
        ...current,
        isLeaving: true,
      };
    });

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
    setRules((current) => ({ ...current, [name]: value }));
  }

  function updateLunchRule(index, updates) {
    setRules((current) => ({
      ...current,
      areaLunchRules: current.areaLunchRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...updates } : rule,
      ),
    }));
  }

  function addLunchRule() {
    setRules((current) => ({
      ...current,
      areaLunchRules: [
        ...current.areaLunchRules,
        { areaCode: "", areaName: "", lunchDurationMinutes: 60 },
      ],
    }));
  }

  function removeLunchRule(index) {
    setRules((current) => ({
      ...current,
      areaLunchRules: current.areaLunchRules.filter((_, ruleIndex) => ruleIndex !== index),
    }));
  }

  function handleAreaSelection(index, areaCode) {
    const selectedArea = areas.find((area) => area.code === areaCode);
    updateLunchRule(index, {
      areaCode,
      areaName: selectedArea?.name || "",
    });
  }

  function updateRoleLunchRule(index, updates) {
    setRules((current) => ({
      ...current,
      roleLunchRules: current.roleLunchRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...updates } : rule,
      ),
    }));
  }

  function addRoleLunchRule() {
    setRules((current) => ({
      ...current,
      roleLunchRules: [
        ...current.roleLunchRules,
        { areaCode: "", areaName: "", roleCode: "", roleName: "", lunchDurationMinutes: 60 },
      ],
    }));
  }

  function removeRoleLunchRule(index) {
    setRules((current) => ({
      ...current,
      roleLunchRules: current.roleLunchRules.filter((_, ruleIndex) => ruleIndex !== index),
    }));
  }

  function handleRoleLunchSelection(index, roleKey) {
    const [areaCode = "", roleCode = ""] = roleKey.split("|");
    const selectedRole = roles.find(
      (role) => role.areaCode === areaCode && role.code === roleCode,
    );

    updateRoleLunchRule(index, {
      areaCode,
      areaName: selectedRole?.areaName || "",
      roleCode,
      roleName: selectedRole?.name || "",
    });
  }

  function updatePayrollNeutralRoleRule(index, updates) {
    setRules((current) => ({
      ...current,
      payrollNeutralRoleRules: current.payrollNeutralRoleRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...updates } : rule,
      ),
    }));
  }

  function addPayrollNeutralRoleRule() {
    setRules((current) => ({
      ...current,
      payrollNeutralRoleRules: [
        ...current.payrollNeutralRoleRules,
        {
          areaCode: "",
          areaName: "",
          roleCode: "",
          roleName: "",
          label: "",
          scheduleAffectsSalary: false,
          appliesSupplementaryHours: false,
          appliesExtraordinaryHours: false,
        },
      ],
    }));
  }

  function removePayrollNeutralRoleRule(index) {
    setRules((current) => ({
      ...current,
      payrollNeutralRoleRules: current.payrollNeutralRoleRules.filter((_, ruleIndex) => ruleIndex !== index),
    }));
  }

  function handlePayrollNeutralRoleSelection(index, roleKey) {
    const [areaCode = "", roleCode = ""] = roleKey.split("|");
    const selectedRole = roles.find(
      (role) => role.areaCode === areaCode && role.code === roleCode,
    );

    updatePayrollNeutralRoleRule(index, {
      areaCode,
      areaName: selectedRole?.areaName || "",
      roleCode,
      roleName: selectedRole?.name || "",
      label: selectedRole ? `Ajustado al plan por ${selectedRole.name.toLowerCase()}` : "",
    });
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      try {
        const [rulesResponse, areasResponse, rolesResponse] = await Promise.all([
          fetch("/api/planner/planning/labor-rules"),
          fetch("/api/company/areas"),
          fetch("/api/company/roles"),
        ]);
        const [rulesPayload, areasPayload, rolesPayload] = await Promise.all([
          rulesResponse.json(),
          areasResponse.json(),
          rolesResponse.json(),
        ]);

        if (!rulesResponse.ok) {
          throw new Error(rulesPayload.error || "No se pudieron cargar las reglas.");
        }

        if (!areasResponse.ok) {
          throw new Error(areasPayload.error || "No se pudieron cargar las areas.");
        }

        if (!rolesResponse.ok) {
          throw new Error(rolesPayload.error || "No se pudieron cargar los roles.");
        }

        if (!isCancelled) {
          const knownAreaCodes = new Set((areasPayload.areas || []).map((area) => area.code));
          const knownRoleKeys = new Set(
            (rolesPayload.roles || []).map((role) => `${role.areaCode}|${role.code}`),
          );
          const loadedRules = {
            ...DEFAULT_RULES,
            ...(rulesPayload.rules || {}),
            areaLunchRules: (rulesPayload.rules?.areaLunchRules || []).filter((rule) =>
              knownAreaCodes.has(rule.areaCode),
            ),
            roleLunchRules: (rulesPayload.rules?.roleLunchRules || []).filter((rule) =>
              knownRoleKeys.has(`${rule.areaCode}|${rule.roleCode}`),
            ),
            payrollNeutralRoleRules: (rulesPayload.rules?.payrollNeutralRoleRules || []).filter((rule) =>
              knownRoleKeys.has(`${rule.areaCode}|${rule.roleCode}`),
            ),
          };

          setRules(loadedRules);
          setSavedRulesSignature(buildRulesSignature(loadedRules));
          setAreas(areasPayload.areas || []);
          setRoles(rolesPayload.roles || []);
          setSource(rulesPayload.source || "default");
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

  function handleConfirmSave() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/planning/labor-rules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rules),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudieron guardar las reglas.");
        }

        const savedRules = { ...DEFAULT_RULES, ...(payload.rules || {}) };

        setRules(savedRules);
        setSavedRulesSignature(buildRulesSignature(savedRules));
        setSource("saved");
        setIsConfirmOpen(false);
        showNotice("success", payload.message);
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  if (isLoading) {
    return <div className={styles.loading}>Cargando reglas laborales...</div>;
  }

  return (
    <form className={styles.stack} onSubmit={handleSubmit}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />

      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="Guardar reglas laborales"
        message="Estas reglas se guardaran en la base de datos y se usaran como referencia para planificacion, recargos y comparacion contra picadas."
        confirmLabel="Guardar reglas"
        cancelLabel="Revisar cambios"
        tone="info"
        isPending={isPending}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmSave}
      />

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Base operativa</p>
            <h2 className={styles.title}>Reglas del modulo</h2>
            <p className={styles.description}>
              Estos parametros alimentaran el calendario laboral, el plan optimo y la comparacion contra picadas.
            </p>
          </div>
          <span className={styles.status}>
            {source === "saved" ? "Desde base de datos" : "Valores iniciales sin guardar"}
          </span>
        </div>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Inicio cobertura empresa</span>
            <input type="time" value={rules.companyStartTime} onChange={(event) => updateField("companyStartTime", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Fin cobertura empresa</span>
            <input type="time" value={rules.companyEndTime} onChange={(event) => updateField("companyEndTime", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Horas base por dia</span>
            <input type="number" min="1" max="24" value={rules.dailyBaseHours} onChange={(event) => updateField("dailyBaseHours", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Horas base por semana</span>
            <input type="number" min="1" max="168" value={rules.weeklyBaseHours} onChange={(event) => updateField("weeklyBaseHours", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Tolerancia de atraso</span>
            <input type="number" min="0" value={rules.defaultGraceMinutes} onChange={(event) => updateField("defaultGraceMinutes", event.target.value)} />
          </label>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Recargos</p>
            <h2 className={styles.title}>Suplementarias y extraordinarias</h2>
          </div>
        </div>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Suplementaria max. por dia (min)</span>
            <input type="number" min="0" value={rules.maxSupplementaryMinutesPerDay} onChange={(event) => updateField("maxSupplementaryMinutesPerDay", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Suplementaria max. por semana (min)</span>
            <input type="number" min="0" value={rules.maxSupplementaryMinutesPerWeek} onChange={(event) => updateField("maxSupplementaryMinutesPerWeek", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Dias extraordinarios max. por mes</span>
            <input type="number" min="0" max="31" value={rules.maxExtraordinaryDaysPerMonth} onChange={(event) => updateField("maxExtraordinaryDaysPerMonth", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Multiplicador suplementaria</span>
            <input type="number" min="1" step="0.01" value={rules.supplementaryMultiplier} onChange={(event) => updateField("supplementaryMultiplier", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Multiplicador extraordinaria</span>
            <input type="number" min="1" step="0.01" value={rules.extraordinaryMultiplier} onChange={(event) => updateField("extraordinaryMultiplier", event.target.value)} />
          </label>
        </div>

        <div className={styles.toggleRow}>
          <div className={styles.toggleField}>
            <span className={styles.toggleLabel}>Vacaciones pagadas</span>
            <button
              type="button"
              className={`catalog-switch ${rules.paidVacationAsWorkday ? "is-active" : ""}`}
              onClick={() => updateField("paidVacationAsWorkday", !rules.paidVacationAsWorkday)}
              aria-pressed={rules.paidVacationAsWorkday}
            >
              <span className="catalog-switchKnob" />
              <span>{rules.paidVacationAsWorkday ? "Dia normal" : "No cuenta"}</span>
            </button>
          </div>

          <div className={styles.toggleField}>
            <span className={styles.toggleLabel}>Suplementaria en vacaciones</span>
            <button
              type="button"
              className={`catalog-switch ${rules.vacationIncludesSupplementaryHour ? "is-active" : ""}`}
              onClick={() =>
                updateField(
                  "vacationIncludesSupplementaryHour",
                  !rules.vacationIncludesSupplementaryHour,
                )
              }
              aria-pressed={rules.vacationIncludesSupplementaryHour}
            >
              <span className="catalog-switchKnob" />
              <span>{rules.vacationIncludesSupplementaryHour ? "Incluye 1h" : "Solo base"}</span>
            </button>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Almuerzos por area</p>
            <h2 className={styles.title}>Duracion default</h2>
          </div>
          <button type="button" className={styles.ghostButton} onClick={addLunchRule}>
            <Plus size={16} />
            Agregar area
          </button>
        </div>

        <div className={styles.lunchRows}>
          {rules.areaLunchRules.map((rule, index) => (
            <div key={`${rule.areaCode}-${index}`} className={styles.lunchRow}>
              <label className={styles.field}>
                <span>Area</span>
                <select value={rule.areaCode} onChange={(event) => handleAreaSelection(index, event.target.value)}>
                  <option value="">Seleccionar</option>
                  {areas.map((area) => (
                    <option key={area.code} value={area.code}>{area.name}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Almuerzo (min)</span>
                <input type="number" min="0" value={rule.lunchDurationMinutes} onChange={(event) => updateLunchRule(index, { lunchDurationMinutes: event.target.value })} />
              </label>
              <button type="button" className={styles.iconButton} onClick={() => removeLunchRule(index)} aria-label="Eliminar regla de almuerzo" title="Eliminar regla">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Almuerzos por rol</p>
            <h2 className={styles.title}>Excepciones al area</h2>
            <p className={styles.description}>
              Usa esto cuando un rol pertenece al area, pero maneja otro tiempo de almuerzo.
            </p>
          </div>
          <button type="button" className={styles.ghostButton} onClick={addRoleLunchRule}>
            <Plus size={16} />
            Agregar rol
          </button>
        </div>

        <div className={styles.lunchRows}>
          {rules.roleLunchRules.map((rule, index) => (
            <div key={`${rule.areaCode}-${rule.roleCode}-${index}`} className={styles.lunchRow}>
              <label className={styles.field}>
                <span>Rol</span>
                <select
                  value={rule.areaCode && rule.roleCode ? `${rule.areaCode}|${rule.roleCode}` : ""}
                  onChange={(event) => handleRoleLunchSelection(index, event.target.value)}
                >
                  <option value="">Seleccionar rol</option>
                  {roles.map((role) => (
                    <option key={`${role.areaCode}-${role.code}`} value={`${role.areaCode}|${role.code}`}>
                      {role.areaName} · {role.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Almuerzo (min)</span>
                <input
                  type="number"
                  min="0"
                  value={rule.lunchDurationMinutes}
                  onChange={(event) =>
                    updateRoleLunchRule(index, { lunchDurationMinutes: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => removeRoleLunchRule(index)}
                aria-label="Eliminar excepcion de almuerzo por rol"
                title="Eliminar regla"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Nomina por rol</p>
            <h2 className={styles.title}>Politicas por rol</h2>
            <p className={styles.description}>
              Define si el horario descuenta sueldo y si las horas suplementarias o extraordinarias aplican para cada rol.
            </p>
          </div>
          <button type="button" className={styles.ghostButton} onClick={addPayrollNeutralRoleRule}>
            <Plus size={16} />
            Agregar rol
          </button>
        </div>

        <div className={styles.neutralRows}>
          {rules.payrollNeutralRoleRules.map((rule, index) => (
            <div key={`${rule.areaCode}-${rule.roleCode}-${index}`} className={styles.neutralRow}>
              <div className={styles.policyHeader}>
                <label className={styles.field}>
                  <span>Rol</span>
                  <select
                    value={rule.areaCode && rule.roleCode ? `${rule.areaCode}|${rule.roleCode}` : ""}
                    onChange={(event) => handlePayrollNeutralRoleSelection(index, event.target.value)}
                  >
                    <option value="">Seleccionar rol</option>
                    {roles.map((role) => (
                      <option key={`${role.areaCode}-${role.code}`} value={`${role.areaCode}|${role.code}`}>
                        {role.areaName} · {role.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Etiqueta</span>
                  <input
                    type="text"
                    value={rule.label || ""}
                    placeholder="Ajustado al plan"
                    onChange={(event) =>
                      updatePayrollNeutralRoleRule(index, { label: event.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => removePayrollNeutralRoleRule(index)}
                  aria-label="Eliminar rol con picadas referenciales"
                  title="Eliminar regla"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className={styles.policyToggles}>
                <button
                  type="button"
                  className={`catalog-switch ${rule.scheduleAffectsSalary ? "is-active" : ""}`}
                  onClick={() =>
                    updatePayrollNeutralRoleRule(index, {
                      scheduleAffectsSalary: !rule.scheduleAffectsSalary,
                    })
                  }
                  aria-pressed={Boolean(rule.scheduleAffectsSalary)}
                >
                  <span className="catalog-switchKnob" />
                  <span>Horario afecta sueldo</span>
                </button>
                <button
                  type="button"
                  className={`catalog-switch ${rule.appliesSupplementaryHours ? "is-active" : ""}`}
                  onClick={() =>
                    updatePayrollNeutralRoleRule(index, {
                      appliesSupplementaryHours: !rule.appliesSupplementaryHours,
                    })
                  }
                  aria-pressed={Boolean(rule.appliesSupplementaryHours)}
                >
                  <span className="catalog-switchKnob" />
                  <span>Aplica suplementarias</span>
                </button>
                <button
                  type="button"
                  className={`catalog-switch ${rule.appliesExtraordinaryHours ? "is-active" : ""}`}
                  onClick={() =>
                    updatePayrollNeutralRoleRule(index, {
                      appliesExtraordinaryHours: !rule.appliesExtraordinaryHours,
                    })
                  }
                  aria-pressed={Boolean(rule.appliesExtraordinaryHours)}
                >
                  <span className="catalog-switchKnob" />
                  <span>Aplica extraordinarias</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.summaryBand}>
        {monthlyExamples.map((item) => (
          <div key={item.days} className={styles.summaryItem}>
            <Clock3 size={17} />
            <span>{item.days} dias laborables = <strong>{item.baseHours}h base</strong></span>
          </div>
        ))}
      </section>

      <section className={styles.panel}>
        <label className={styles.field}>
          <span>Notas operativas</span>
          <textarea value={rules.notes} onChange={(event) => updateField("notes", event.target.value)} rows={4} placeholder="Ej. El plan debe completar sueldo base antes de proyectar extras." />
        </label>
      </section>

      <div className={styles.actions}>
        <button type="submit" className={styles.primaryButton} disabled={isPending || !hasChanges}>
          <Save size={16} />
          {isPending ? "Guardando..." : hasChanges ? "Guardar reglas" : "Sin cambios"}
        </button>
      </div>
    </form>
  );
}
