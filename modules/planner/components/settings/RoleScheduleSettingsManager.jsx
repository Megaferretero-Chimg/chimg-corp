"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Save, Search } from "lucide-react";

import AutocompleteSelect from "@/components/ui/AutocompleteSelect";
import FloatingNotice from "@/components/ui/FloatingNotice";
import TextInput from "@/components/ui/TextInput";
import { formatTime24 } from "@/lib/datetime/ecuador";
import styles from "@/modules/planner/styles/components/settings/RoleScheduleSettingsManager.module.scss";

const ALLOWED_DAY_TYPES = new Set(["workday", "vacation", "holiday", "weekend_overtime", "off_day"]);
const WORKING_DAY_TYPES = new Set(["workday", "weekend_overtime"]);

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatScheduleHour(value) {
  return formatTime24(value);
}

function templateScheduleLabel(template) {
  const row = template.weeklyRows?.[0] || {};

  if (!row.startTime || !row.endTime) {
    return "Sin horario";
  }

  if (row.hasLunch && row.lunchStartTime && row.lunchEndTime) {
    return `${formatScheduleHour(row.startTime)} A ${formatScheduleHour(row.lunchStartTime)} ${formatScheduleHour(row.lunchEndTime)} A ${formatScheduleHour(row.endTime)}`;
  }

  return `${formatScheduleHour(row.startTime)} A ${formatScheduleHour(row.endTime)}`;
}

function parseTimeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return null;

  const [hours, minutes] = String(value).split(":").map(Number);
  return (hours * 60) + minutes;
}

function calculateLunchDurationMinutes(startTime, endTime) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);

  if (start === null || end === null || end <= start) return 0;

  return end - start;
}

function normalizeScheduleRow(row = {}) {
  const dayType = ALLOWED_DAY_TYPES.has(row.dayType) ? row.dayType : "workday";
  const isWorkingDay = WORKING_DAY_TYPES.has(dayType);
  const hasLunch = Boolean(row.hasLunch && isWorkingDay);
  const lunchStartTime = hasLunch ? String(row.lunchStartTime || "") : "";
  const lunchEndTime = hasLunch ? String(row.lunchEndTime || "") : "";
  const lunchDurationMinutes = calculateLunchDurationMinutes(lunchStartTime, lunchEndTime);

  return {
    dayOfWeek: Number.isInteger(Number(row.dayOfWeek)) ? Number(row.dayOfWeek) : 1,
    label: row.label || "Horario",
    dayType,
    startTime: isWorkingDay ? String(row.startTime || "") : "",
    lunchDurationMinutes,
    lunchStartTime,
    lunchEndTime,
    hasLunch,
    endTime: isWorkingDay ? String(row.endTime || "") : "",
    authorizedExtraMinutes: Math.max(0, Number(row.authorizedExtraMinutes) || 0),
    graceMinutes: Math.max(0, Number(row.graceMinutes) || 0),
  };
}

function cloneScheduleRows(rows = []) {
  return rows.map(normalizeScheduleRow);
}

function buildSignature(roles) {
  return JSON.stringify(
    roles.map((role) => ({
      id: role.id,
      scheduleMode: role.scheduleMode || "variable",
      punchesAffectHours: role.punchesAffectHours !== false,
      fixedScheduleTemplateId: role.fixedScheduleTemplateId || "",
      fixedScheduleTemplateName: role.fixedScheduleTemplateName || "",
      fixedScheduleWeeklyRows: cloneScheduleRows(role.fixedScheduleWeeklyRows || []),
    })),
  );
}

function templateLabel(template) {
  const row = template.weeklyRows?.[0] || {};
  const punches = row.hasLunch && row.lunchStartTime && row.lunchEndTime ? "4 picadas" : "2 picadas";

  return `${templateScheduleLabel(template)} · ${punches}`;
}

function RoleScheduleLoading() {
  return (
    <section className={styles.loadingShell} aria-label="Cargando horarios por cargo">
      <div className={styles.loadingToolbar}>
        <div className={styles.loadingMetrics}>
          <span />
          <span />
          <span />
        </div>
        <span className={styles.loadingSearch} />
        <span className={styles.loadingButton} />
      </div>

      <div className={styles.loadingTable}>
        <div className={styles.loadingTableHeader}>
          <span />
          <span />
          <span />
          <span />
        </div>
        {Array.from({ length: 7 }).map((_, index) => (
          <div className={styles.loadingTableRow} key={index}>
            <span />
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function RoleScheduleSettingsManager() {
  const [roles, setRoles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [query, setQuery] = useState("");
  const [savedSignature, setSavedSignature] = useState("");
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const currentSignature = buildSignature(roles);
  const hasChanges = savedSignature && currentSignature !== savedSignature;

  const filteredRoles = useMemo(() => {
    const needle = normalizeSearch(query);

    if (!needle) return roles;

    return roles.filter((role) =>
      normalizeSearch([role.areaName, role.name, role.code].filter(Boolean).join(" ")).includes(needle),
    );
  }, [query, roles]);

  const roleStats = useMemo(() => {
    const fixed = roles.filter((role) => role.scheduleMode === "fixed").length;
    const punchControlled = roles.filter((role) => role.punchesAffectHours !== false).length;

    return {
      fixed,
      variable: roles.length - fixed,
      punchControlled,
      punchIgnored: roles.length - punchControlled,
    };
  }, [roles]);

  const clearNoticeTimers = useCallback(() => {
    if (noticeExitTimeoutRef.current) window.clearTimeout(noticeExitTimeoutRef.current);
    if (noticeRemoveTimeoutRef.current) window.clearTimeout(noticeRemoveTimeoutRef.current);
    noticeExitTimeoutRef.current = null;
    noticeRemoveTimeoutRef.current = null;
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
    noticeExitTimeoutRef.current = window.setTimeout(dismissNotice, 4000);
  }, [clearNoticeTimers, dismissNotice]);

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      try {
        const response = await fetch("/api/planner/planning/role-schedules");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo cargar la configuracion.");
        }

        if (!isCancelled) {
          const loadedRoles = payload.roles || [];
          setRoles(loadedRoles);
          setTemplates(payload.templates || []);
          setSavedSignature(buildSignature(loadedRoles));
        }
      } catch (error) {
        if (!isCancelled) showNotice("error", error.message);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    loadData();

    return () => {
      isCancelled = true;
      clearNoticeTimers();
    };
  }, [clearNoticeTimers, showNotice]);

  function updateRole(roleId, updates) {
    setRoles((current) =>
      current.map((role) =>
        role.id === roleId
          ? {
              ...role,
              ...updates,
              ...(updates.scheduleMode === "variable"
                ? {
                    fixedScheduleTemplateId: "",
                    fixedScheduleTemplateName: "",
                    fixedScheduleTemplateSourceName: "",
                    fixedScheduleWeeklyRows: [],
                  }
                : {}),
            }
          : role,
      ),
    );
  }

  function handleTemplateChange(role, templateId) {
    const template = templates.find((candidate) => candidate.id === templateId);

    if (!template) {
      updateRole(role.id, {
        fixedScheduleTemplateId: "",
        fixedScheduleTemplateName: "",
        fixedScheduleTemplateSourceName: "",
        fixedScheduleWeeklyRows: [],
      });
      return;
    }

    updateRole(role.id, {
      fixedScheduleTemplateId: template.id,
      fixedScheduleTemplateName: template.name || role.fixedScheduleTemplateName || "HORARIO COPIADO",
      fixedScheduleTemplateSourceName: template.name || "",
      fixedScheduleAreaCode: role.areaCode || "",
      fixedScheduleAreaName: role.areaName || "",
      fixedScheduleRoleCode: template.roleCode || role.code || "",
      fixedScheduleRoleName: template.roleName || role.name || "",
      fixedScheduleRotationGroup: template.rotationGroup || "",
      fixedScheduleWeeklyRows: cloneScheduleRows(template.weeklyRows || []),
    });
  }

  function saveChanges() {
    if (!hasChanges || isPending) return;

    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/planning/role-schedules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roles }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar la configuracion.");
        }

        const savedRoles = payload.roles || [];
        setRoles(savedRoles);
        setSavedSignature(buildSignature(savedRoles));
        showNotice("success", payload.message);
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  if (isLoading) {
    return <RoleScheduleLoading />;
  }

  return (
    <section className={styles.shell}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />

      <div className={styles.toolbar}>
        <div className={styles.metrics}>
          <span><strong>{roleStats.fixed}</strong> fijos</span>
          <span><strong>{roleStats.variable}</strong> variables</span>
          <span><strong>{roleStats.punchIgnored}</strong> sin contabilizar picadas</span>
        </div>
        <TextInput
          className={styles.search}
          icon={Search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar cargo"
        />
        <button type="button" className={styles.primaryButton} onClick={saveChanges} disabled={!hasChanges || isPending}>
          <Save size={15} />
          {isPending ? "Guardando..." : hasChanges ? "Guardar" : "Sin cambios"}
        </button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Cargo</th>
              <th>Modo</th>
              <th>Afectan picadas</th>
              <th>Plantilla fija</th>
            </tr>
          </thead>
          <tbody>
            {filteredRoles.map((role) => {
              const templateOptions = templates.map((template) => ({
                value: template.id,
                label: templateLabel(template),
                description: template.notes || template.name || "",
                searchText: [template.name, templateScheduleLabel(template), template.notes].filter(Boolean).join(" "),
              }));
              const isFixed = role.scheduleMode === "fixed";
              const hasCurrentTemplateOption = templates.some((template) => template.id === role.fixedScheduleTemplateId);

              if (role.fixedScheduleTemplateId && !hasCurrentTemplateOption) {
                templateOptions.unshift({
                  value: role.fixedScheduleTemplateId,
                  label: role.fixedScheduleTemplateName || "Copia actual",
                  description: "Plantilla guardada previamente",
                  searchText: role.fixedScheduleTemplateName || "",
                });
              }

              return (
                <tr key={role.id}>
                  <td>
                    <strong>{role.name}</strong>
                    <span>{role.areaName}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`catalog-switch ${isFixed ? "is-active" : ""}`}
                      onClick={() => updateRole(role.id, { scheduleMode: isFixed ? "variable" : "fixed" })}
                      aria-pressed={isFixed}
                    >
                      <span className="catalog-switchKnob" />
                      <span>{isFixed ? "Fijo" : "Variable"}</span>
                    </button>
                  </td>
                  <td>
                    <label
                      className={`${styles.checkboxCell} ${
                        role.punchesAffectHours !== false ? styles.checkboxCellActive : styles.checkboxCellInactive
                      }`}
                      aria-label={
                        role.punchesAffectHours !== false
                          ? "Las picadas afectan la contabilizacion de horas"
                          : "Las picadas no afectan la contabilizacion de horas"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={role.punchesAffectHours !== false}
                        onChange={(event) => updateRole(role.id, { punchesAffectHours: event.target.checked })}
                      />
                    </label>
                  </td>
                  <td>
                    <AutocompleteSelect
                      value={role.fixedScheduleTemplateId || ""}
                      onChange={(templateId) => handleTemplateChange(role, templateId)}
                      disabled={!isFixed}
                      options={templateOptions}
                      placeholder="Seleccionar plantilla"
                      searchPlaceholder="Buscar plantilla"
                      emptyText="No hay plantillas con ese criterio"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
