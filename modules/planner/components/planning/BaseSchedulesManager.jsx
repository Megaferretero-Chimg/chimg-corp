"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Plus, RotateCcw, Search, Trash2 } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import TextInput from "@/components/ui/TextInput";
import { formatTime24 } from "@/lib/datetime/ecuador";
import { DEFAULT_TEMPLATE_ROWS } from "@/modules/planner/lib/planning/baseSchedules";
import styles from "@/modules/planner/styles/components/planning/BaseSchedulesManager.module.scss";

const EMPTY_ROW = DEFAULT_TEMPLATE_ROWS[0];
const EMPTY_FORM = {
  id: "",
  name: "",
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
  return formatTime24(value, "--");
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

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildFormSignature(form) {
  const row = getTemplateRow(form);

  return JSON.stringify({
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
  const normalizedRow = {
    ...row,
    lunchDurationMinutes: lunchMinutes,
    lunchStartTime: row.hasLunch ? row.lunchStartTime : "",
    lunchEndTime: row.hasLunch ? row.lunchEndTime : "",
    hasLunch: Boolean(row.hasLunch && lunchMinutes),
    authorizedExtraMinutes: 0,
  };

  return {
    ...form,
    name: formatScheduleLabel(normalizedRow),
    id: "",
    roleCode: "",
    roleName: "",
    rotationGroup: "",
    weeklyRows: [normalizedRow],
  };
}

function BaseSchedulesLoadingState() {
  return (
    <section className={styles.loadingShell} aria-label="Cargando horarios base">
      <div className={styles.loadingCreatePanel}>
        <div className={styles.loadingHeader}>
          <div>
            <span className={styles.loadingLineShort} />
            <span className={styles.loadingLineLong} />
          </div>
          <span className={styles.loadingToggle} />
          <span className={styles.loadingButton} />
        </div>

        <div className={styles.loadingGrid}>
          {Array.from({ length: 5 }).map((_, index) => (
            <span key={index} className={styles.loadingField} />
          ))}
        </div>

        <div className={styles.loadingSummary}>
          {Array.from({ length: 4 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>
      </div>

      <div className={styles.loadingCatalogPanel}>
        <div className={styles.loadingToolbar}>
          <span />
          <span />
          <span />
        </div>
        <div className={styles.loadingTable}>
          {Array.from({ length: 5 }).map((_, rowIndex) => (
            <div key={rowIndex} className={styles.loadingTableRow}>
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function BaseSchedulesManager() {
  const [templates, setTemplates] = useState([]);
  const [templateFilters, setTemplateFilters] = useState({ query: "" });
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
  const canSave = Boolean(row.startTime && row.endTime && summary.netMinutes > 0);

  const visibleTemplates = useMemo(
    () => templates.map((template) => ({
      ...template,
      weeklyRows: [getTemplateRow(template)],
      scheduleLabel: formatScheduleLabel(getTemplateRow(template)),
    })),
    [templates],
  );

  const filteredTemplates = useMemo(() => {
    const query = normalizeSearch(templateFilters.query);
    const compactQuery = query.replace(/\s/g, "");

    return visibleTemplates.filter((template) => {
      if (!query) {
        return true;
      }

      const haystack = normalizeSearch([
        template.scheduleLabel,
        template.notes,
      ].filter(Boolean).join(" "));
      const compactHaystack = haystack.replace(/\s/g, "");

      return haystack.includes(query) || compactHaystack.includes(compactQuery);
    });
  }, [templateFilters.query, visibleTemplates]);

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
    setTemplateFilters({ query: "" });
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      try {
        const templatesResponse = await fetch("/api/planner/planning/base-schedules");
        const templatesPayload = await templatesResponse.json();

        if (!templatesResponse.ok) throw new Error(templatesPayload.error || "No se pudieron cargar las plantillas.");

        if (!isCancelled) {
          setTemplates(templatesPayload.templates || []);
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
        const response = await fetch("/api/planner/planning/base-schedules", {
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
                formatScheduleLabel(getTemplateRow(left)).localeCompare(formatScheduleLabel(getTemplateRow(right)), "es"),
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
          const response = await fetch(`/api/planner/planning/base-schedules/${templateId}`, {
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
    return <BaseSchedulesLoadingState />;
  }

  return (
    <section className={styles.shell}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />
      <ConfirmDialog
        isOpen={isSaveConfirmOpen}
        title="Crear horario diario"
        message="El horario quedara disponible como opcion para programar cualquier dia y area."
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
        message={`Deseas eliminar "${templateToDelete ? formatScheduleLabel(getTemplateRow(templateToDelete)) : ""}"?${templateToDelete?.duplicateIds?.length > 1 ? ` Esta opcion agrupa ${templateToDelete.duplicateIds.length} plantillas antiguas con el mismo horario.` : ""} Esta accion no se puede deshacer.`}
        confirmLabel={isPending ? "Eliminando..." : "Eliminar"}
        isPending={isPending}
        onCancel={() => setTemplateToDelete(null)}
        onConfirm={confirmDeleteTemplate}
      />

      <form className={styles.createPanel} onSubmit={handleSubmit}>
        <div className={styles.createHeader}>
          <div>
            <span>Nuevo horario</span>
            <strong>{formatScheduleLabel(row)}</strong>
          </div>
          <label className={styles.switch}>
            <input
              type="checkbox"
              checked={Boolean(row.hasLunch)}
              onChange={(event) => updateRow({ hasLunch: event.target.checked })}
              disabled={isPending}
            />
            <span>{row.hasLunch ? "Con almuerzo" : "Sin almuerzo"}</span>
          </label>
          <button type="submit" className={styles.primaryButton} disabled={isPending || !hasChanges || !canSave}>
            <Plus size={15} />
            {isPending ? "Creando..." : "Crear"}
          </button>
        </div>

        <fieldset className={styles.createGrid} disabled={isPending}>
          <TextInput label="Entrada" type="time" value={row.startTime || ""} onChange={(event) => updateRow({ startTime: event.target.value })} />
          {row.hasLunch ? (
            <>
              <TextInput label="Fin manana" type="time" value={row.lunchStartTime || ""} onChange={(event) => updateRow({ lunchStartTime: event.target.value })} />
              <TextInput label="Inicio tarde" type="time" value={row.lunchEndTime || ""} onChange={(event) => updateRow({ lunchEndTime: event.target.value })} />
            </>
          ) : null}
          <TextInput label="Salida" type="time" value={row.endTime || ""} onChange={(event) => updateRow({ endTime: event.target.value })} />
          <TextInput className={styles.notesField} label="Notas" value={form.notes} onChange={(event) => updateField("notes", event.target.value)} placeholder="Uso interno opcional" />
        </fieldset>

        <div className={styles.summaryStrip}>
          <span><strong>{minutesLabel(summary.grossMinutes)}</strong> jornada</span>
          <span><strong>{minutesLabel(summary.netMinutes)}</strong> netas</span>
          <span><strong>{row.hasLunch ? "4" : "2"}</strong> picadas</span>
          <span><strong>{minutesLabel(summary.lunchMinutes)}</strong> descanso</span>
        </div>
      </form>

      <section className={styles.catalogPanel}>
        <div className={styles.toolbar}>
          <TextInput
            className={styles.search}
            icon={Search}
            type="search"
            value={templateFilters.query}
            onChange={(event) => setTemplateFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder="08H00 A 12H00 13H00 A 17H00"
          />
          <button type="button" className={styles.ghostButton} onClick={clearTemplateFilters}>
            <RotateCcw size={15} />
            Limpiar
          </button>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Horario</th>
                <th>Horas</th>
                <th>Picadas</th>
                <th>Descanso</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.map((template) => {
                  const templateRow = getTemplateRow(template);
                  const templateSummary = getScheduleSummary(templateRow);

                  return (
                    <tr key={template.id}>
                      <td>
                        <strong>{formatScheduleLabel(templateRow)}</strong>
                        <span>{templateRow.hasLunch ? "Jornada partida" : "Jornada continua"}</span>
                      </td>
                      <td>
                        <strong>{minutesLabel(templateSummary.netMinutes)}</strong>
                        <span>{minutesLabel(templateSummary.grossMinutes)} jornada</span>
                      </td>
                      <td>{templateRow.hasLunch ? "4 picadas" : "2 picadas"}</td>
                      <td>{minutesLabel(templateSummary.lunchMinutes)}</td>
                      <td className={styles.actionCell}>
                        <button type="button" className={styles.dangerButton} onClick={() => setTemplateToDelete(template)} title="Eliminar">
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!templates.length ? (
          <div className={styles.emptyState}>
            Todavia no hay horarios diarios. Crea la primera opcion para empezar a programar.
          </div>
        ) : null}
        {templates.length && !filteredTemplates.length ? (
          <div className={styles.emptyState}>
            No hay horarios con esos filtros.
          </div>
        ) : null}
      </section>
    </section>
  );
}
