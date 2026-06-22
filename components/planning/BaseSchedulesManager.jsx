"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Filter, Plus, RotateCcw, Trash2 } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import { DEFAULT_TEMPLATE_ROWS } from "@/lib/planning/baseSchedules";
import styles from "./BaseSchedulesManager.module.scss";

const EMPTY_ROW = DEFAULT_TEMPLATE_ROWS[0];
const EMPTY_FORM = {
  id: "",
  name: "",
  areaCode: "",
  roleCode: "",
  rotationGroup: "",
  weeklyRows: [{ ...EMPTY_ROW }],
  notes: "",
  isActive: true,
};

function cloneRow(row = EMPTY_ROW) {
  return { ...EMPTY_ROW, ...row, dayOfWeek: 1, label: "Horario", dayType: "workday", authorizedExtraMinutes: 0 };
}

function getTemplateRow(templateOrForm) {
  return cloneRow(templateOrForm?.weeklyRows?.[0] || EMPTY_ROW);
}

function parseTimeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return null;

  const [hours, minutes] = String(value).split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesLabel(minutes) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;

  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatClockLabel(value) {
  const minutes = parseTimeToMinutes(value);

  if (minutes === null) return "--";

  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}H${String(minutes % 60).padStart(2, "0")}`;
}

function calculateLunchMinutes(row) {
  const lunchStart = parseTimeToMinutes(row.lunchStartTime);
  const lunchEnd = parseTimeToMinutes(row.lunchEndTime);

  if (lunchStart === null || lunchEnd === null || lunchEnd <= lunchStart) return 0;

  return lunchEnd - lunchStart;
}

function calculateGrossMinutes(row) {
  const start = parseTimeToMinutes(row.startTime);
  const end = parseTimeToMinutes(row.endTime);

  if (start === null || end === null || end <= start) return 0;

  return end - start;
}

function getScheduleSummary(row) {
  const lunchMinutes = row.hasLunch ? calculateLunchMinutes(row) : 0;
  const grossMinutes = calculateGrossMinutes(row);
  const netMinutes = Math.max(0, grossMinutes - lunchMinutes);

  return { grossMinutes, lunchMinutes, netMinutes };
}

function formatScheduleLabel(row) {
  if (row.hasLunch && row.lunchStartTime && row.lunchEndTime) {
    return `${formatClockLabel(row.startTime)} A ${formatClockLabel(row.lunchStartTime)} ${formatClockLabel(row.lunchEndTime)} A ${formatClockLabel(row.endTime)}`;
  }

  return `${formatClockLabel(row.startTime)} A ${formatClockLabel(row.endTime)}`;
}

function buildFormSignature(form) {
  const row = getTemplateRow(form);

  return JSON.stringify({
    name: String(form.name || "").trim(),
    areaCode: form.areaCode || "",
    row: {
      startTime: row.startTime || "",
      hasLunch: Boolean(row.hasLunch),
      lunchStartTime: row.lunchStartTime || "",
      lunchEndTime: row.lunchEndTime || "",
      endTime: row.endTime || "",
    },
    notes: String(form.notes || "").trim(),
    isActive: form.isActive !== false,
  });
}

function buildPayload(form) {
  const row = getTemplateRow(form);
  const lunchMinutes = row.hasLunch ? calculateLunchMinutes(row) : 0;

  return {
    ...form,
    id: "",
    roleCode: "",
    roleName: "",
    rotationGroup: "",
    weeklyRows: [{
      ...row,
      lunchDurationMinutes: lunchMinutes,
      lunchStartTime: row.hasLunch ? row.lunchStartTime : "",
      lunchEndTime: row.hasLunch ? row.lunchEndTime : "",
      hasLunch: Boolean(row.hasLunch && lunchMinutes),
      authorizedExtraMinutes: 0,
    }],
  };
}

export default function BaseSchedulesManager() {
  const [templates, setTemplates] = useState([]);
  const [areas, setAreas] = useState([]);
  const [templateFilters, setTemplateFilters] = useState({ areaCode: "" });
  const [form, setForm] = useState({ ...EMPTY_FORM, weeklyRows: [cloneRow()] });
  const [savedFormSignature, setSavedFormSignature] = useState("");
  const [templateToDelete, setTemplateToDelete] = useState(null);
  const [isSaveConfirmOpen, setIsSaveConfirmOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);

  const row = getTemplateRow(form);
  const summary = getScheduleSummary(row);
  const formSignature = buildFormSignature(form);
  const hasChanges = formSignature !== savedFormSignature;
  const canSave = Boolean(form.name.trim() && form.areaCode && row.startTime && row.endTime && summary.netMinutes > 0);

  const visibleAreas = useMemo(
    () => areas,
    [areas],
  );

  const visibleTemplates = useMemo(
    () => templates.map((template) => ({
      ...template,
      weeklyRows: [getTemplateRow(template)],
    })),
    [templates],
  );

  const filteredTemplates = useMemo(
    () => visibleTemplates.filter((template) => !templateFilters.areaCode || template.areaCode === templateFilters.areaCode),
    [templateFilters.areaCode, visibleTemplates],
  );

  const templatesByArea = useMemo(() => {
    const grouped = new Map();

    filteredTemplates.forEach((template) => {
      const key = template.areaName || "Sin area";

      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(template);
    });

    return [...grouped.entries()];
  }, [filteredTemplates]);

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

  function setCurrentForm(nextForm = EMPTY_FORM) {
    const preparedForm = {
      ...EMPTY_FORM,
      ...nextForm,
      roleCode: "",
      roleName: "",
      rotationGroup: "",
      weeklyRows: [getTemplateRow(nextForm)],
    };

    setForm(preparedForm);
    setSavedFormSignature(buildFormSignature(preparedForm));
  }

  function resetForm() {
    setCurrentForm({ ...EMPTY_FORM, weeklyRows: [cloneRow()] });
  }

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateRow(updates) {
    setForm((current) => {
      const nextRow = { ...getTemplateRow(current), ...updates };

      if (updates.hasLunch === true) {
        nextRow.startTime = nextRow.startTime || "07:00";
        nextRow.lunchStartTime = nextRow.lunchStartTime || "12:30";
        nextRow.lunchEndTime = nextRow.lunchEndTime || "14:00";
        nextRow.endTime = nextRow.endTime || "18:00";
      }

      if (updates.hasLunch === false) {
        nextRow.lunchStartTime = "";
        nextRow.lunchEndTime = "";
        nextRow.lunchDurationMinutes = 0;
      }

      return { ...current, weeklyRows: [cloneRow(nextRow)] };
    });
  }

  function clearTemplateFilters() {
    setTemplateFilters({ areaCode: "" });
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      try {
        const [templatesResponse, areasResponse] = await Promise.all([
          fetch("/api/planning/base-schedules"),
          fetch("/api/areas"),
        ]);
        const [templatesPayload, areasPayload] = await Promise.all([
          templatesResponse.json(),
          areasResponse.json(),
        ]);

        if (!templatesResponse.ok) throw new Error(templatesPayload.error || "No se pudieron cargar las plantillas.");
        if (!areasResponse.ok) throw new Error(areasPayload.error || "No se pudieron cargar las areas.");

        if (!isCancelled) {
          setTemplates(templatesPayload.templates || []);
          setAreas(areasPayload.areas || []);
          setCurrentForm({ ...EMPTY_FORM, weeklyRows: [cloneRow()] });
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

  function handleSubmit(event) {
    event.preventDefault();

    if (!hasChanges || isPending || !canSave) return;

    setIsSaveConfirmOpen(true);
  }

  function confirmSave() {
    if (isPending) return;

    setIsSaveConfirmOpen(false);

    startTransition(async () => {
      try {
        const payloadToSave = buildPayload(form);
        const response = await fetch("/api/planning/base-schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadToSave),
        });
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.error || "No se pudo guardar la plantilla.");

        setTemplates((current) => {
          const saved = payload.template;
          const exists = current.some((template) => template.id === saved.id);

          return exists
            ? current.map((template) => (template.id === saved.id ? saved : template))
            : [...current, saved].sort((left, right) =>
                `${left.areaName}${left.name}`.localeCompare(`${right.areaName}${right.name}`, "es"),
              );
        });
        resetForm();
        showNotice("success", payload.message);
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  function confirmDeleteTemplate() {
    if (!templateToDelete) return;

    startTransition(async () => {
      try {
        const idsToDelete = [...new Set(templateToDelete.duplicateIds?.length ? templateToDelete.duplicateIds : [templateToDelete.id])];
        const responses = await Promise.all(idsToDelete.map(async (templateId) => {
          const response = await fetch(`/api/planning/base-schedules/${templateId}`, {
            method: "DELETE",
          });
          const payload = await response.json();

          if (!response.ok) throw new Error(payload.error || "No se pudo eliminar la plantilla.");

          return templateId;
        }));
        const deletedIds = new Set(responses);

        setTemplates((current) => current.filter((template) => !deletedIds.has(template.id)));
        setTemplateToDelete(null);
        showNotice("success", idsToDelete.length > 1
          ? `Se eliminaron ${idsToDelete.length} plantillas duplicadas de ese horario.`
          : "Plantilla eliminada correctamente.");
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  if (isLoading) {
    return <div className={styles.loading}>Cargando horarios diarios...</div>;
  }

  return (
    <div className={styles.layout}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />
      <ConfirmDialog
        isOpen={isSaveConfirmOpen}
        title="Crear horario diario"
        message="El horario quedara disponible como opcion para programar cualquier dia dentro del area seleccionada."
        confirmLabel={isPending ? "Creando..." : "Crear"}
        cancelLabel="Revisar"
        tone="info"
        isPending={isPending}
        onCancel={() => setIsSaveConfirmOpen(false)}
        onConfirm={confirmSave}
      />
      <ConfirmDialog
        isOpen={Boolean(templateToDelete)}
        title="Eliminar horario"
        message={`Deseas eliminar "${templateToDelete?.name || ""}"?${templateToDelete?.duplicateIds?.length > 1 ? ` Esta opcion agrupa ${templateToDelete.duplicateIds.length} plantillas antiguas con el mismo horario.` : ""} Esta accion no se puede deshacer.`}
        confirmLabel={isPending ? "Eliminando..." : "Eliminar"}
        isPending={isPending}
        onCancel={() => setTemplateToDelete(null)}
        onConfirm={confirmDeleteTemplate}
      />

      <form className={styles.formPanel} onSubmit={handleSubmit}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Horario diario</p>
            <h2 className={styles.title}>Crear opcion de horario</h2>
            <p className={styles.description}>
              Crea opciones por area. Un tramo continuo se interpreta como media jornada o jornada corrida; dos tramos calculan automaticamente el descanso.
            </p>
          </div>
        </div>

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Nombre</span>
            <input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Ej. APERTURA ALMACEN" />
          </label>
          <label className={styles.field}>
            <span>Area</span>
            <select value={form.areaCode} onChange={(event) => updateField("areaCode", event.target.value)}>
              <option value="">Seleccionar</option>
              {visibleAreas.map((area) => <option key={area.code} value={area.code}>{area.name}</option>)}
            </select>
          </label>
        </div>

        <section className={styles.scheduleBuilder}>
          <div className={styles.schedulePreview}>
            <span>Formato</span>
            <strong>{formatScheduleLabel(row)}</strong>
          </div>

          <label className={styles.lunchToggle}>
            <input
              type="checkbox"
              checked={Boolean(row.hasLunch)}
              onChange={(event) => updateRow({ hasLunch: event.target.checked })}
            />
            <span>Definir almuerzo / descanso</span>
          </label>

          <div className={styles.timeGrid}>
            <label>
              <span>Entrada</span>
              <input type="time" value={row.startTime || ""} onChange={(event) => updateRow({ startTime: event.target.value })} />
            </label>
            {row.hasLunch ? (
              <>
                <label>
                  <span>Fin mañana</span>
                  <input type="time" value={row.lunchStartTime || ""} onChange={(event) => updateRow({ lunchStartTime: event.target.value })} />
                </label>
                <label>
                  <span>Inicio tarde</span>
                  <input type="time" value={row.lunchEndTime || ""} onChange={(event) => updateRow({ lunchEndTime: event.target.value })} />
                </label>
              </>
            ) : null}
            <label>
              <span>Salida</span>
              <input type="time" value={row.endTime || ""} onChange={(event) => updateRow({ endTime: event.target.value })} />
            </label>
          </div>

          <div className={styles.summaryGrid}>
            <article>
              <span>Total jornada</span>
              <strong>{minutesLabel(summary.grossMinutes)}</strong>
            </article>
            <article>
              <span>Almuerzo / descanso</span>
              <strong>{minutesLabel(summary.lunchMinutes)}</strong>
            </article>
            <article>
              <span>Horas netas</span>
              <strong>{minutesLabel(summary.netMinutes)}</strong>
            </article>
          </div>
        </section>

        <label className={styles.field}>
          <span>Notas</span>
          <textarea rows={3} value={form.notes} onChange={(event) => updateField("notes", event.target.value)} placeholder="Ej. Usar para cierre o refuerzo de tarde." />
        </label>

        <div className={styles.actions}>
          <button type="submit" className={styles.primaryButton} disabled={isPending || !hasChanges || !canSave}>
            <Plus size={16} />
            {isPending ? "Creando..." : "Crear horario"}
          </button>
        </div>
      </form>

      <section className={styles.listPanel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Catalogo</p>
            <h2 className={styles.title}>Opciones por area</h2>
          </div>
        </div>

        <div className={styles.filterBar}>
          <div className={styles.filterTitle}>
            <Filter size={16} />
            <span>{filteredTemplates.length} de {visibleTemplates.length} horarios</span>
          </div>
          <div className={styles.filterControls}>
            <label className={styles.compactField}>
              <span>Area</span>
              <select
                value={templateFilters.areaCode}
                onChange={(event) => setTemplateFilters({ areaCode: event.target.value })}
              >
                <option value="">Todas</option>
                {visibleAreas.map((area) => (
                  <option key={area.code} value={area.code}>{area.name}</option>
                ))}
              </select>
            </label>
            <button type="button" className={styles.ghostButton} onClick={clearTemplateFilters}>
              <RotateCcw size={16} />
              Limpiar
            </button>
          </div>
        </div>

        <div className={styles.templateGroups}>
          {templatesByArea.map(([areaName, areaTemplates]) => (
            <div key={areaName} className={styles.group}>
              <h3>{areaName}</h3>
              <div className={styles.templateList}>
                {areaTemplates.map((template) => {
                  const templateRow = getTemplateRow(template);
                  const templateSummary = getScheduleSummary(templateRow);

                  return (
                    <article key={template.id} className={styles.templateCard}>
                      <div>
                        <span className={styles.roleTag}>{minutesLabel(templateSummary.netMinutes)} netas</span>
                        <h4>{template.name}</h4>
                        <p>{formatScheduleLabel(templateRow)}</p>
                      </div>
                      <div className={styles.dayChips}>
                        <span>Jornada {minutesLabel(templateSummary.grossMinutes)}</span>
                        <span>Descanso {minutesLabel(templateSummary.lunchMinutes)}</span>
                      </div>
                      <div className={styles.cardActions}>
                        <button type="button" className={styles.dangerButton} onClick={() => setTemplateToDelete(template)} title="Eliminar"><Trash2 size={15} /></button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}

          {!templates.length ? (
            <div className={styles.emptyState}>
              Todavia no hay horarios diarios. Crea la primera opcion para empezar a programar por area.
            </div>
          ) : null}
          {templates.length && !filteredTemplates.length ? (
            <div className={styles.emptyState}>
              No hay horarios con esos filtros.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
