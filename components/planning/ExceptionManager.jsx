"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addMonths, format, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Plus,
  Save,
  XCircle,
} from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import { PLANNING_EXCEPTIONS_ACCESS_ROLE } from "@/lib/access-roles";
import styles from "./ExceptionManager.module.scss";

const DEFAULT_TYPES = [
  { value: "outside_work", label: "Trabajo externo" },
  { value: "permission", label: "Permiso o ausencia" },
  { value: "medical_appointment", label: "Salud" },
  { value: "schedule_change", label: "Ajuste de horario" },
  { value: "other", label: "Otro" },
];

const DEFAULT_RESOLUTIONS = [
  { value: "pending", label: "Pendiente de revisar" },
  { value: "approved_work_time", label: "Sin descuento de horas" },
  { value: "discount_day", label: "Con descuento de horas" },
];

const ADJUSTMENT_TYPES = [
  { value: "full_day", label: "Dia completo" },
  { value: "partial_day", label: "Rango de horas" },
  { value: "other", label: "Informativo" },
];
const OUTSIDE_WORK_PUNCH_TYPE = "outside_work_punch";
const EXCEPTIONS_PAGE_SIZE = 10;
const HUMAN_RESOURCES_APPROVER_NAMES = ["ADRIANA", "JAHETH"];

const EMPTY_FORM = {
  id: "",
  employeeId: "",
  type: "outside_work",
  scope: "full_day",
  dateKey: format(new Date(), "yyyy-MM-dd"),
  endDateKey: "",
  startTime: "",
  endTime: "",
  plannedStartTime: "",
  plannedEndTime: "",
  plannedLunchStartTime: "",
  plannedLunchEndTime: "",
  plannedLunchDurationMinutes: 0,
  manualPunchTime: "",
  destination: "",
  countsAsWorkedTime: false,
  allowSupplementaryTime: false,
  registeredBy: "",
  authorizedBy: "",
  resolution: "approved_work_time",
  resolutionNotes: "",
  notes: "",
};

function buildExceptionForm(exception) {
  const supportedScope = ["full_day", "partial_day", "other"].includes(exception.scope)
    ? exception.scope
    : "other";

  return {
    id: exception.id,
    employeeId: exception.employeeId,
    type: exception.type || "permission",
    scope: exception.scope === "date_range" ? "full_day" : supportedScope,
    dateKey: exception.dateKey || "",
    endDateKey: exception.endDateKey || "",
    startTime: exception.startTime || "",
    endTime: exception.endTime || "",
    plannedStartTime: exception.plannedStartTime || "",
    plannedEndTime: exception.plannedEndTime || "",
    plannedLunchStartTime: exception.plannedLunchStartTime || "",
    plannedLunchEndTime: exception.plannedLunchEndTime || "",
    plannedLunchDurationMinutes: Number(exception.plannedLunchDurationMinutes) || 0,
    manualPunchTime: exception.manualPunchTime || "",
    destination: exception.destination || "",
    countsAsWorkedTime: Boolean(exception.countsAsWorkedTime),
    allowSupplementaryTime: Boolean(exception.allowSupplementaryTime),
    registeredBy: exception.registeredBy || "",
    authorizedBy: exception.authorizedBy || "",
    resolution: exception.resolution || "pending",
    resolutionNotes: exception.resolutionNotes || "",
    notes: exception.notes || exception.resolutionNotes || "",
  };
}

function formatClock(value) {
  return String(value || "").replace(":", "H");
}

function formatScheduleOption(option) {
  if (!option?.startTime || !option?.endTime) return "";
  if (option.lunchStartTime && option.lunchEndTime) {
    return `${formatClock(option.startTime)} A ${formatClock(option.lunchStartTime)} / ${formatClock(option.lunchEndTime)} A ${formatClock(option.endTime)}`;
  }

  return `${formatClock(option.startTime)} A ${formatClock(option.endTime)}`;
}

function buildScheduleKey(option) {
  return [
    option.startTime || "",
    option.lunchStartTime || "",
    option.lunchEndTime || "",
    option.endTime || "",
    Number(option.lunchDurationMinutes) || 0,
  ].join("|");
}

function parseScheduleKey(key) {
  const [startTime = "", lunchStartTime = "", lunchEndTime = "", endTime = "", lunchDurationMinutes = "0"] = String(key || "").split("|");

  return {
    startTime,
    lunchStartTime,
    lunchEndTime,
    endTime,
    lunchDurationMinutes: Number(lunchDurationMinutes) || 0,
  };
}

export default function ExceptionManager({
  eyebrow = "Control operativo",
  title = "Ajustes y excepciones",
  description = "Registra novedades reales por empleado y deja trazabilidad de la resolucion tomada.",
  currentUserAccessRole = "",
}) {
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [employees, setEmployees] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [types, setTypes] = useState(DEFAULT_TYPES);
  const [resolutions, setResolutions] = useState(DEFAULT_RESOLUTIONS);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [exceptionToDelete, setExceptionToDelete] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const monthKey = format(monthDate, "yyyy-MM");
  const monthLabel = format(monthDate, "MMMM yyyy", { locale: es });
  const isLimitedExceptionUser = currentUserAccessRole === PLANNING_EXCEPTIONS_ACCESS_ROLE;

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.isActive !== false),
    [employees],
  );
  const selectedEmployee = useMemo(
    () => activeEmployees.find((employee) => employee.id === form.employeeId),
    [activeEmployees, form.employeeId],
  );
  const scheduleOptions = useMemo(() => {
    if (!selectedEmployee) return [];

    const roleCodes = new Set([
      selectedEmployee.roleCode,
      ...(Array.isArray(selectedEmployee.roleAssignments)
        ? selectedEmployee.roleAssignments.map((assignment) => assignment.code)
        : []),
    ].filter(Boolean));
    const optionsByKey = new Map();

    templates.forEach((template) => {
      if (template.areaCode !== selectedEmployee.areaCode) return;
      if (template.roleCode && roleCodes.size && !roleCodes.has(template.roleCode)) return;

      (template.weeklyRows || []).forEach((row) => {
        if (row.dayType !== "workday" || !row.startTime || !row.endTime) return;

        const option = {
          startTime: row.startTime,
          endTime: row.endTime,
          lunchStartTime: row.lunchStartTime || "",
          lunchEndTime: row.lunchEndTime || "",
          lunchDurationMinutes: Number(row.lunchDurationMinutes) || 0,
        };
        const key = buildScheduleKey(option);

        if (!optionsByKey.has(key)) {
          optionsByKey.set(key, {
            ...option,
            key,
            label: formatScheduleOption(option),
          });
        }
      });
    });

    return [...optionsByKey.values()].sort((left, right) => left.label.localeCompare(right.label, "es"));
  }, [selectedEmployee, templates]);
  const selectedScheduleKey = form.plannedStartTime && form.plannedEndTime
    ? buildScheduleKey({
      startTime: form.plannedStartTime,
      lunchStartTime: form.plannedLunchStartTime,
      lunchEndTime: form.plannedLunchEndTime,
      endTime: form.plannedEndTime,
      lunchDurationMinutes: form.plannedLunchDurationMinutes,
    })
    : "";
  const approverOptions = useMemo(
    () =>
      activeEmployees.filter((employee) => {
        const fullName = String(employee.fullName || "").toUpperCase();

        return HUMAN_RESOURCES_APPROVER_NAMES.some((name) => fullName.includes(name));
      }).sort((left, right) => left.fullName.localeCompare(right.fullName, "es")),
    [activeEmployees],
  );
  const approvedCount = exceptions.filter((exception) => exception.resolution !== "pending" && exception.resolution !== "discount_day").length;
  const discountCount = exceptions.filter((exception) => exception.resolution === "discount_day").length;
  const pendingCount = exceptions.filter((exception) => exception.resolution === "pending").length;
  const orderedExceptions = useMemo(
    () =>
      [...exceptions].sort((left, right) => {
        const rightDate = new Date(right.dateKey || right.date || right.createdAt || 0).getTime();
        const leftDate = new Date(left.dateKey || left.date || left.createdAt || 0).getTime();

        if (rightDate !== leftDate) {
          return rightDate - leftDate;
        }

        return String(left.employeeName || "").localeCompare(String(right.employeeName || ""), "es");
      }),
    [exceptions],
  );
  const totalPages = Math.max(1, Math.ceil(orderedExceptions.length / EXCEPTIONS_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedExceptions = orderedExceptions.slice(
    (safeCurrentPage - 1) * EXCEPTIONS_PAGE_SIZE,
    safeCurrentPage * EXCEPTIONS_PAGE_SIZE,
  );
  const paginationStart = orderedExceptions.length
    ? (safeCurrentPage - 1) * EXCEPTIONS_PAGE_SIZE + 1
    : 0;
  const paginationEnd = Math.min(safeCurrentPage * EXCEPTIONS_PAGE_SIZE, orderedExceptions.length);
  const hasDateRange = Boolean(form.endDateKey);
  const createsManualPunch = form.type === OUTSIDE_WORK_PUNCH_TYPE;
  const needsSchedule = form.scope !== "other" && !createsManualPunch;
  const needsTimeRange = form.scope === "partial_day";
  const canSave = Boolean(
    form.employeeId
    && form.type
    && form.dateKey
    && form.notes.trim()
    && (!createsManualPunch || form.manualPunchTime)
    && (!needsSchedule || (form.plannedStartTime && form.plannedEndTime))
    && (!needsTimeRange || (form.startTime && form.endTime)),
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

  const loadExceptions = useCallback(async () => {
    const response = await fetch(`/api/planning/exceptions?month=${monthKey}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "No se pudieron cargar las excepciones.");
    }

    setExceptions(payload.exceptions || []);
    setTypes(payload.options?.types || DEFAULT_TYPES);
    setResolutions(payload.options?.resolutions || DEFAULT_RESOLUTIONS);
  }, [monthKey]);

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      setIsLoading(true);

      try {
        const [employeesResponse, exceptionsResponse, templatesResponse] = await Promise.all([
          fetch("/api/employees"),
          fetch(`/api/planning/exceptions?month=${monthKey}`),
          fetch("/api/planning/base-schedules"),
        ]);
        const [employeesPayload, exceptionsPayload, templatesPayload] = await Promise.all([
          employeesResponse.json(),
          exceptionsResponse.json(),
          templatesResponse.json(),
        ]);

        if (!employeesResponse.ok) {
          throw new Error(employeesPayload.error || "No se pudieron cargar los empleados.");
        }

        if (!exceptionsResponse.ok) {
          throw new Error(exceptionsPayload.error || "No se pudieron cargar las excepciones.");
        }

        if (!templatesResponse.ok) {
          throw new Error(templatesPayload.error || "No se pudieron cargar los horarios base.");
        }

        if (!isCancelled) {
          setEmployees(employeesPayload.employees || []);
          setExceptions(exceptionsPayload.exceptions || []);
          setTemplates(templatesPayload.templates || []);
          setTypes(exceptionsPayload.options?.types || DEFAULT_TYPES);
          setResolutions(exceptionsPayload.options?.resolutions || DEFAULT_RESOLUTIONS);
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
  }, [clearNoticeTimers, monthKey, showNotice]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function moveMonth(getNextMonth) {
    setCurrentPage(1);
    setMonthDate((current) => getNextMonth(current));
  }

  function updateEmployee(value) {
    setForm((current) => ({
      ...current,
      employeeId: value,
      plannedStartTime: "",
      plannedEndTime: "",
      plannedLunchStartTime: "",
      plannedLunchEndTime: "",
      plannedLunchDurationMinutes: 0,
    }));
  }

  function setDateRangeEnabled(isEnabled) {
    setForm((current) => {
      if (!isEnabled) {
        return { ...current, endDateKey: "" };
      }

      return {
        ...current,
        endDateKey: current.endDateKey || current.dateKey,
      };
    });
  }

  function updateType(value) {
    setForm((current) => ({
      ...current,
      type: value,
      scope: value === OUTSIDE_WORK_PUNCH_TYPE ? "other" : current.scope,
      resolution: isLimitedExceptionUser
        ? "pending"
        : value === OUTSIDE_WORK_PUNCH_TYPE
          ? "approved_work_time"
          : current.resolution,
      manualPunchTime: value === OUTSIDE_WORK_PUNCH_TYPE ? current.manualPunchTime : "",
    }));
  }

  function updateAdjustmentType(value) {
    setForm((current) => ({
      ...current,
      scope: value,
      startTime: value === "partial_day" ? current.startTime : "",
      endTime: value === "partial_day" ? current.endTime : "",
      resolution: isLimitedExceptionUser
        ? "pending"
        : value === "other"
          ? "approved_work_time"
          : current.resolution,
      countsAsWorkedTime: value === "partial_day" && current.resolution !== "discount_day",
    }));
  }

  function updateSchedule(key) {
    const schedule = parseScheduleKey(key);

    setForm((current) => ({
      ...current,
      plannedStartTime: schedule.startTime,
      plannedEndTime: schedule.endTime,
      plannedLunchStartTime: schedule.lunchStartTime,
      plannedLunchEndTime: schedule.lunchEndTime,
      plannedLunchDurationMinutes: schedule.lunchDurationMinutes,
    }));
  }

  function updateResolution(value) {
    setForm((current) => ({
      ...current,
      resolution: value,
      countsAsWorkedTime: current.scope === "partial_day" && value !== "discount_day",
    }));
  }

  function describeExceptionTime(exception) {
    const range = exception.endDateKey ? `${exception.dateKey} hasta ${exception.endDateKey}` : exception.dateKey;

    if (exception.type === OUTSIDE_WORK_PUNCH_TYPE && exception.manualPunchTime) {
      return `${range} · picada ${exception.manualPunchTime}`;
    }

    return range;
  }

  function openCreateEditor() {
    setForm({
      ...EMPTY_FORM,
      dateKey: format(new Date(), "yyyy-MM-dd"),
      resolution: isLimitedExceptionUser ? "pending" : EMPTY_FORM.resolution,
      authorizedBy: "",
    });
    setIsEditorOpen(true);
  }

  function openEditEditor(exception) {
    if (isLimitedExceptionUser) {
      return;
    }

    setForm(buildExceptionForm(exception));
    setIsEditorOpen(true);
  }

  function closeEditor() {
    setForm(EMPTY_FORM);
    setIsEditorOpen(false);
  }

  function saveException(event) {
    event.preventDefault();

    if (!canSave) {
      showNotice("error", "Selecciona empleado, motivo, fecha y agrega una descripcion.");
      return;
    }

    const endpoint = form.id ? `/api/planning/exceptions/${form.id}` : "/api/planning/exceptions";
    const method = form.id ? "PATCH" : "POST";
    const requestBody = {
      ...form,
      resolution: isLimitedExceptionUser ? "pending" : form.resolution,
      authorizedBy: isLimitedExceptionUser ? "" : form.authorizedBy,
      scope: form.endDateKey && form.scope === "full_day" ? "date_range" : form.scope,
      startTime: form.scope === "partial_day" ? form.startTime : "",
      endTime: form.scope === "partial_day" ? form.endTime : "",
      destination: "",
      countsAsWorkedTime: form.scope === "partial_day" && form.resolution !== "discount_day",
      allowSupplementaryTime: false,
      resolutionNotes: "",
    };

    startTransition(async () => {
      try {
        const response = await fetch(endpoint, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar la justificacion.");
        }

        await loadExceptions();
        closeEditor();
        showNotice("success", payload.message || "Justificacion guardada correctamente.");
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  function confirmDeleteException() {
    if (!exceptionToDelete) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/planning/exceptions/${exceptionToDelete.id}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo anular la justificacion.");
        }

        setExceptionToDelete(null);
        await loadExceptions();
        showNotice("success", "Justificacion anulada correctamente.");
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  return (
    <div className={styles.stack}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />
      <ConfirmDialog
        isOpen={Boolean(exceptionToDelete)}
        title="Anular justificacion"
        message={`Deseas anular la justificacion de ${exceptionToDelete?.employeeName || ""}? Quedara archivada y no contara para el control operativo.`}
        confirmLabel={isPending ? "Anulando..." : "Anular"}
        isPending={isPending}
        onCancel={() => setExceptionToDelete(null)}
        onConfirm={confirmDeleteException}
      />

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2 className={styles.title}>{title}</h2>
            <p className={styles.description}>{description}</p>
          </div>

          <div className={styles.actionsGroup}>
            <div className={styles.monthControls}>
              <button type="button" onClick={() => moveMonth((current) => subMonths(current, 1))} aria-label="Mes anterior">
                <ChevronLeft size={16} />
              </button>
              <div className={styles.monthPill}>
                <CalendarDays size={16} />
                <span>{monthLabel}</span>
              </div>
              <button type="button" onClick={() => moveMonth((current) => addMonths(current, 1))} aria-label="Mes siguiente">
                <ChevronRight size={16} />
              </button>
            </div>

            <button type="button" className={styles.primaryButton} onClick={openCreateEditor}>
              <Plus size={16} />
              Nueva justificacion
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className={styles.summaryGrid} aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className={styles.metricSkeleton}>
                <span className={styles.skeletonLineShort} />
                <span className={styles.skeletonNumber} />
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.summaryGrid}>
            <div className={styles.metric}>
              <span>Registros</span>
              <strong>{exceptions.length}</strong>
            </div>
            <div className={styles.metric}>
              <span>Pendientes</span>
              <strong>{pendingCount}</strong>
            </div>
            <div className={styles.metric}>
              <span>Sin descuento</span>
              <strong>{approvedCount}</strong>
            </div>
            <div className={styles.metric}>
              <span>Con descuento</span>
              <strong>{discountCount}</strong>
            </div>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.listHeader}>
          <div>
            <h3>Justificaciones registradas</h3>
            <p>{isLoading ? "Cargando..." : `Periodo ${monthLabel} · mas recientes primero`}</p>
          </div>
        </div>

        {isLoading ? (
          <div className={styles.tableSkeleton} aria-live="polite" aria-label="Cargando justificaciones">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className={styles.skeletonRow}>
                <span className={styles.skeletonAvatar} />
                <span className={styles.skeletonCell} />
                <span className={styles.skeletonCell} />
                <span className={styles.skeletonPill} />
                <span className={styles.skeletonActions} />
              </div>
            ))}
          </div>
        ) : exceptions.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Motivo / fecha</th>
                  <th>Trazabilidad</th>
                  <th>Tratamiento</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {paginatedExceptions.map((exception) => (
                  <tr
                    key={exception.id}
                    className={isLimitedExceptionUser ? "" : styles.clickableRow}
                    onClick={() => openEditEditor(exception)}
                  >
                    <td>
                      <strong>{exception.employeeName}</strong>
                      <span>{[exception.branchName, exception.areaName, exception.roleName].filter(Boolean).join(" / ") || "Sin estructura"}</span>
                    </td>
                    <td>
                      <strong>{exception.typeLabel}</strong>
                      <span>{describeExceptionTime(exception)}</span>
                    </td>
                    <td>
                      <strong>Registro: {exception.registeredBy}</strong>
                      <span>Autorizo: {exception.authorizedBy || "Pendiente"}</span>
                    </td>
                    <td>
                      <span className={exception.resolution === "pending" ? styles.pendingPill : styles.resolvedPill}>
                        {exception.resolutionLabel}
                      </span>
                      {exception.resolutionNotes ? <small>{exception.resolutionNotes}</small> : null}
                    </td>
                    <td>
                      {isLimitedExceptionUser ? null : (
                        <div className={styles.rowActions}>
                          <button type="button" onClick={(event) => {
                            event.stopPropagation();
                            openEditEditor(exception);
                          }} aria-label="Editar justificacion">
                            <Edit3 size={15} />
                          </button>
                          <button type="button" onClick={(event) => {
                            event.stopPropagation();
                            setExceptionToDelete(exception);
                          }} aria-label="Anular justificacion">
                            <XCircle size={15} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {orderedExceptions.length > EXCEPTIONS_PAGE_SIZE ? (
              <div className={styles.paginationBar}>
                <span>
                  {paginationStart}-{paginationEnd} de {orderedExceptions.length}
                </span>
                <div className={styles.paginationActions}>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={safeCurrentPage <= 1}
                    aria-label="Pagina anterior"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <strong>Pagina {safeCurrentPage} de {totalPages}</strong>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={safeCurrentPage >= totalPages}
                    aria-label="Pagina siguiente"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <AlertTriangle size={26} />
            <strong>No hay justificaciones registradas para este mes.</strong>
            <span>Registra permisos, salidas tempranas, citas medicas o faltas justificadas cuando ocurran.</span>
          </div>
        )}
      </section>

      <CatalogDrawer
        isOpen={isEditorOpen}
        eyebrow={form.id ? "Editar registro" : "Nuevo registro"}
        title={form.id ? "Editar justificacion" : "Registrar justificacion"}
        onClose={closeEditor}
      >
        <form className={styles.editorForm} onSubmit={saveException}>
          <label className={styles.field}>
            <span>Empleado</span>
            <select value={form.employeeId} onChange={(event) => updateEmployee(event.target.value)}>
              <option value="">Seleccionar empleado</option>
              {activeEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName}
                </option>
              ))}
            </select>
          </label>

          {selectedEmployee ? (
            <div className={styles.employeeSnapshot}>
              <strong>{selectedEmployee.branchName || selectedEmployee.branch || "Sin sucursal"}</strong>
              <span>{[selectedEmployee.areaName, selectedEmployee.roleName].filter(Boolean).join(" / ") || "Sin area o rol"}</span>
            </div>
          ) : null}

          <div className={styles.twoColumnGrid}>
            <label className={styles.field}>
              <span>Motivo</span>
              <select value={form.type} onChange={(event) => updateType(event.target.value)}>
                {types.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>

            {isLimitedExceptionUser ? (
              <label className={styles.field}>
                <span>Tratamiento</span>
                <input value="Pendiente de revisar" readOnly />
              </label>
            ) : (
              <label className={styles.field}>
                <span>Tratamiento</span>
                <select value={form.resolution} onChange={(event) => updateResolution(event.target.value)}>
                  {resolutions.map((resolution) => (
                    <option key={resolution.value} value={resolution.value}>
                      {resolution.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className={styles.field}>
            <span>Tipo de ajuste</span>
            <select value={form.scope} onChange={(event) => updateAdjustmentType(event.target.value)}>
              {ADJUSTMENT_TYPES.map((adjustmentType) => (
                <option key={adjustmentType.value} value={adjustmentType.value}>
                  {adjustmentType.label}
                </option>
              ))}
            </select>
          </label>

          {createsManualPunch ? (
            <label className={styles.field}>
              <span>Hora de picada manual</span>
              <input
                type="time"
                value={form.manualPunchTime}
                onChange={(event) => updateForm("manualPunchTime", event.target.value)}
              />
            </label>
          ) : null}

          {form.scope !== "other" && !createsManualPunch ? (
            <label className={styles.field}>
              <span>Horario planificado</span>
              <select value={selectedScheduleKey} onChange={(event) => updateSchedule(event.target.value)}>
                <option value="">Seleccionar horario</option>
                {scheduleOptions.map((schedule) => (
                  <option key={schedule.key} value={schedule.key}>
                    {schedule.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {form.scope === "partial_day" ? (
            <div className={styles.twoColumnGrid}>
              <label className={styles.field}>
                <span>Hora inicio excepcion</span>
                <input type="time" value={form.startTime} onChange={(event) => updateForm("startTime", event.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Hora fin excepcion</span>
                <input type="time" value={form.endTime} onChange={(event) => updateForm("endTime", event.target.value)} />
              </label>
            </div>
          ) : null}

          <div className={styles.twoColumnGrid}>
            <label className={styles.field}>
              <span>Fecha inicio</span>
              <input type="date" value={form.dateKey} onChange={(event) => updateForm("dateKey", event.target.value)} />
            </label>
            <label className={styles.field} data-muted={!hasDateRange}>
              <span>Fecha fin</span>
              <input
                type="date"
                value={form.endDateKey}
                onChange={(event) => updateForm("endDateKey", event.target.value)}
                disabled={!hasDateRange}
              />
            </label>
          </div>

          <label className={styles.checkField}>
            <input
              type="checkbox"
              checked={hasDateRange}
              onChange={(event) => setDateRangeEnabled(event.target.checked)}
            />
            <span>Aplica por varios dias</span>
          </label>

          <label className={styles.field}>
            <span>Descripcion</span>
            <textarea
              value={form.notes}
              onChange={(event) => updateForm("notes", event.target.value)}
              placeholder="Ej. Sale de 15:00 a 17:00 por cita medica; apoyo en otra sucursal; carga pesada; permiso personal."
              rows={4}
            />
          </label>

          {isLimitedExceptionUser ? null : (
            <label className={styles.field}>
              <span>Autorizado por</span>
              <select value={form.authorizedBy} onChange={(event) => updateForm("authorizedBy", event.target.value)}>
                <option value="">Pendiente</option>
                {approverOptions.map((employee) => (
                  <option key={employee.id} value={employee.fullName}>
                    {employee.fullName}
                  </option>
                ))}
                {form.authorizedBy && !approverOptions.some((employee) => employee.fullName === form.authorizedBy) ? (
                  <option value={form.authorizedBy}>{form.authorizedBy}</option>
                ) : null}
              </select>
            </label>
          )}

          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={closeEditor} disabled={isPending}>
              Cancelar
            </button>
            <button type="submit" className={styles.primaryButton} disabled={!canSave || isPending}>
              <Save size={16} />
              {isPending ? "Guardando..." : "Guardar justificacion"}
            </button>
          </div>
        </form>
      </CatalogDrawer>
    </div>
  );
}
