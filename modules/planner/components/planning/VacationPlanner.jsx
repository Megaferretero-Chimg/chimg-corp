"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addMonths, differenceInCalendarDays, format, parseISO, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Plane,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmployeeAutocomplete from "@/components/ui/EmployeeAutocomplete";
import FloatingNotice from "@/components/ui/FloatingNotice";
import styles from "@/modules/planner/styles/components/planning/VacationPlanner.module.scss";

const EMPTY_FORM = {
  employeeId: "",
  isDateRange: false,
  startDateKey: "",
  endDateKey: "",
  notes: "",
};

function calculateDays(startDateKey, endDateKey) {
  if (!startDateKey || !endDateKey) {
    return 0;
  }

  const startDate = parseISO(startDateKey);
  const endDate = parseISO(endDateKey);
  const total = differenceInCalendarDays(endDate, startDate) + 1;

  return Number.isFinite(total) && total > 0 ? total : 0;
}

function vacationDateLabel(vacation) {
  if (!vacation) return "";

  return vacation.startDateKey === vacation.endDateKey
    ? `el ${vacation.startDateKey}`
    : `del ${vacation.startDateKey} al ${vacation.endDateKey}`;
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export default function VacationPlanner() {
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [employees, setEmployees] = useState([]);
  const [vacations, setVacations] = useState([]);
  const [capabilities, setCapabilities] = useState({
    canRequest: false,
    canManage: false,
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [vacationEmployeeQuery, setVacationEmployeeQuery] = useState("");
  const [vacationEmployeeId, setVacationEmployeeId] = useState("");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [vacationToDelete, setVacationToDelete] = useState(null);
  const [vacationDecision, setVacationDecision] = useState(null);
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const monthKey = format(monthDate, "yyyy-MM");
  const monthLabel = format(monthDate, "MMMM yyyy", { locale: es });

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.isActive !== false),
    [employees],
  );
  const selectedEmployee = useMemo(
    () => activeEmployees.find((employee) => employee.id === form.employeeId),
    [activeEmployees, form.employeeId],
  );
  const filteredVacations = useMemo(() => {
    if (vacationEmployeeId) {
      return vacations.filter((vacation) => vacation.employeeId === vacationEmployeeId);
    }

    const query = normalizeSearch(vacationEmployeeQuery);

    if (!query) return vacations;

    return vacations.filter((vacation) => normalizeSearch([
      vacation.employeeName,
      vacation.employeeDni,
      vacation.branchName,
      vacation.areaName,
      vacation.roleName,
    ].filter(Boolean).join(" ")).includes(query));
  }, [vacationEmployeeId, vacationEmployeeQuery, vacations]);
  const approvedVacations = useMemo(
    () => vacations.filter((vacation) => vacation.status === "approved"),
    [vacations],
  );
  const pendingVacationsCount = useMemo(
    () => vacations.filter((vacation) => vacation.status === "pending").length,
    [vacations],
  );
  const requestedDays = calculateDays(form.startDateKey, form.endDateKey);
  const hasValidVacationDates = Boolean(
    form.startDateKey
    && form.endDateKey
    && (form.isDateRange ? requestedDays > 1 : requestedDays === 1),
  );
  const canSave = Boolean(form.employeeId && hasValidVacationDates);

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

  const loadVacations = useCallback(async () => {
    const response = await fetch(`/api/planner/planning/vacations?month=${monthKey}&includeRequests=true`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "No se pudieron cargar las vacaciones.");
    }

    setVacations(payload.vacations || []);
    setCapabilities(payload.capabilities || { canRequest: false, canManage: false });
  }, [monthKey]);

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      setIsLoading(true);

      try {
        const [employeesResponse, vacationsResponse] = await Promise.all([
          fetch("/api/company/employees?scope=planning"),
          fetch(`/api/planner/planning/vacations?month=${monthKey}&includeRequests=true`),
        ]);
        const [employeesPayload, vacationsPayload] = await Promise.all([
          employeesResponse.json(),
          vacationsResponse.json(),
        ]);

        if (!employeesResponse.ok) {
          throw new Error(employeesPayload.error || "No se pudieron cargar los empleados.");
        }

        if (!vacationsResponse.ok) {
          throw new Error(vacationsPayload.error || "No se pudieron cargar las vacaciones.");
        }

        if (!isCancelled) {
          setEmployees(employeesPayload.employees || []);
          setVacations(vacationsPayload.vacations || []);
          setCapabilities(vacationsPayload.capabilities || { canRequest: false, canManage: false });
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

  function updateStartDate(value) {
    setForm((current) => {
      const endDateKey = !value
        ? ""
        : current.isDateRange && current.endDateKey >= value
          ? current.endDateKey
          : value;

      return {
        ...current,
        startDateKey: value,
        endDateKey,
      };
    });
  }

  function toggleDateRange(isDateRange) {
    setForm((current) => ({
      ...current,
      isDateRange,
      endDateKey: isDateRange ? current.endDateKey || current.startDateKey : current.startDateKey,
    }));
  }

  function selectEmployee(employee) {
    updateForm("employeeId", employee?.id || "");
    setEmployeeQuery(employee?.fullName || "");
  }

  function handleEmployeeQueryChange(value) {
    setEmployeeQuery(value);
  }

  function selectVacationEmployee(employee) {
    setVacationEmployeeId(employee?.id || "");
    setVacationEmployeeQuery(employee?.fullName || "");
  }

  function clearVacationEmployee() {
    setVacationEmployeeId("");
  }

  function openCreateEditor() {
    setForm(EMPTY_FORM);
    setEmployeeQuery("");
    setIsEditorOpen(true);
  }

  const closeEditor = useCallback(() => {
    setForm(EMPTY_FORM);
    setEmployeeQuery("");
    setIsEditorOpen(false);
  }, []);

  function saveVacation(event) {
    event.preventDefault();

    if (!canSave) {
      if (!form.employeeId) {
        showNotice("error", "Debes seleccionar un empleado.");
      } else if (!form.startDateKey) {
        showNotice("error", "Debes seleccionar la fecha de vacaciones.");
      } else if (form.isDateRange && (!form.endDateKey || form.endDateKey <= form.startDateKey)) {
        showNotice("error", "Para varios días, la fecha final debe ser posterior a la fecha inicial.");
      } else {
        showNotice("error", "Las fechas de vacaciones no son válidas.");
      }
      return;
    }

    const requestPayload = {
      employeeId: form.employeeId,
      isDateRange: form.isDateRange,
      startDateKey: form.startDateKey,
      endDateKey: form.isDateRange ? form.endDateKey : form.startDateKey,
      notes: form.notes,
    };

    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/planning/vacations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar la vacacion.");
        }

        await loadVacations();
        closeEditor();
        showNotice("success", payload.message || "Vacaciones guardadas correctamente.");
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  function confirmDeleteVacation() {
    if (!vacationToDelete) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/planner/planning/vacations/${vacationToDelete.id}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo eliminar la vacacion.");
        }

        setVacationToDelete(null);
        await loadVacations();
        showNotice("success", "Vacaciones eliminadas correctamente.");
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  function confirmVacationDecision() {
    if (!vacationDecision) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/planner/planning/vacations/${vacationDecision.vacation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: vacationDecision.action }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo resolver la solicitud.");
        }

        setVacationDecision(null);
        await loadVacations();
        showNotice("success", payload.message || "Solicitud resuelta correctamente.");
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  return (
    <div className={styles.stack}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />
      <ConfirmDialog
        isOpen={Boolean(vacationToDelete)}
        title="Eliminar vacaciones"
        message={`Deseas quitar las vacaciones de ${vacationToDelete?.employeeName || ""}? Ya no se consideraran en la planificacion.`}
        confirmLabel={isPending ? "Eliminando..." : "Eliminar"}
        isPending={isPending}
        onCancel={() => setVacationToDelete(null)}
        onConfirm={confirmDeleteVacation}
      />
      <ConfirmDialog
        isOpen={Boolean(vacationDecision)}
        title={vacationDecision?.action === "approve" ? "Aprobar solicitud" : "Rechazar solicitud"}
        message={vacationDecision
          ? `${vacationDecision.action === "approve" ? "Se aprobaran" : "Se rechazaran"} las vacaciones de ${vacationDecision.vacation.employeeName} ${vacationDateLabel(vacationDecision.vacation)}.`
          : ""}
        confirmLabel={isPending
          ? "Procesando..."
          : vacationDecision?.action === "approve" ? "Aprobar" : "Rechazar"}
        tone={vacationDecision?.action === "reject" ? "danger" : "primary"}
        isPending={isPending}
        onCancel={() => setVacationDecision(null)}
        onConfirm={confirmVacationDecision}
      />

      <section className={styles.panel}>
        <div className={styles.filtersToolbar}>
          <div className={styles.filtersBar}>
            <div className={styles.monthFilter}>
              <span className={styles.filterLabel}>Mes</span>
              <div className={styles.monthSlider}>
                <button type="button" onClick={() => setMonthDate((current) => subMonths(current, 1))} aria-label={`Mes anterior desde ${monthLabel}`}>
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <output aria-live="polite" aria-label={`Mes seleccionado: ${monthLabel}`}>
                  {monthLabel}
                </output>
                <button type="button" onClick={() => setMonthDate((current) => addMonths(current, 1))} aria-label={`Mes siguiente desde ${monthLabel}`}>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className={styles.employeeFilterLinear}>
              <EmployeeAutocomplete
                employees={activeEmployees}
                value={vacationEmployeeId}
                query={vacationEmployeeQuery}
                onQueryChange={setVacationEmployeeQuery}
                onSelect={selectVacationEmployee}
                onClearSelection={clearVacationEmployee}
                label="Empleado"
                placeholder="Seleccionar empleado"
                disabled={isLoading}
              />
            </div>
          </div>
          {capabilities.canRequest ? (
            <button type="button" className={styles.primaryButton} onClick={openCreateEditor}>
              <Plus size={16} />
              {capabilities.canManage ? "Registrar vacaciones" : "Solicitar vacaciones"}
            </button>
          ) : null}
        </div>

        {isLoading ? (
          <div className={styles.summaryGrid} aria-hidden="true">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className={styles.metricSkeleton}>
                <span className={styles.skeletonLineShort} />
                <span className={styles.skeletonNumber} />
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.summaryGrid}>
            <div className={styles.metric}>
              <span>Solicitudes</span>
              <strong>{vacations.length}</strong>
            </div>
            <div className={styles.metric}>
              <span>Pendientes</span>
              <strong>{pendingVacationsCount}</strong>
            </div>
            <div className={styles.metric}>
              <span>Dias aprobados</span>
              <strong>{approvedVacations.reduce((total, vacation) => total + vacation.totalCalendarDays, 0)}</strong>
            </div>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.listHeader}>
          <div>
            <h3>Solicitudes de vacaciones</h3>
            <p>
              {isLoading
                ? "Cargando..."
                : vacationEmployeeId || vacationEmployeeQuery.trim()
                  ? `${filteredVacations.length} de ${vacations.length} registros · Periodo ${monthLabel}`
                  : `Periodo ${monthLabel}`}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className={styles.tableSkeleton} aria-live="polite" aria-label="Cargando vacaciones">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className={styles.skeletonRow}>
                <span className={styles.skeletonAvatar} />
                <span className={styles.skeletonCell} />
                <span className={styles.skeletonCell} />
                <span className={styles.skeletonDays} />
                <span className={styles.skeletonActions} />
              </div>
            ))}
          </div>
        ) : filteredVacations.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Area / rol</th>
                  <th>Fechas</th>
                  <th>Dias</th>
                  <th>Estado</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {filteredVacations.map((vacation) => (
                  <tr key={vacation.id}>
                    <td>
                      <strong>{vacation.employeeName}</strong>
                      <span>{vacation.employeeDni || "Sin DNI"}</span>
                    </td>
                    <td>
                      <strong>{vacation.areaName || "Sin area"}</strong>
                      <span>{vacation.roleName || "Sin rol"}</span>
                    </td>
                    <td>
                      <strong>{vacation.startDateKey}</strong>
                      {vacation.startDateKey !== vacation.endDateKey
                        ? <span>hasta {vacation.endDateKey}</span>
                        : <span>un solo día</span>}
                    </td>
                    <td>{vacation.totalCalendarDays}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${styles[`status_${vacation.status}`] || ""}`}>
                        {vacation.statusLabel}
                      </span>
                      {vacation.status === "pending" && vacation.requestedBy
                        ? <small>solicitada por {vacation.requestedBy}</small>
                        : vacation.reviewedBy ? <small>revisada por {vacation.reviewedBy}</small> : null}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        {capabilities.canManage && vacation.status === "pending" ? (
                          <button
                            type="button"
                            className={styles.approveAction}
                            onClick={() => setVacationDecision({ action: "approve", vacation })}
                            aria-label="Aprobar solicitud de vacaciones"
                            title="Aprobar"
                          >
                            <Check size={15} />
                          </button>
                        ) : null}
                        {capabilities.canManage && vacation.status === "pending" ? (
                          <button
                            type="button"
                            className={styles.rejectAction}
                            onClick={() => setVacationDecision({ action: "reject", vacation })}
                            aria-label="Rechazar solicitud de vacaciones"
                            title="Rechazar"
                          >
                            <X size={15} />
                          </button>
                        ) : null}
                        {capabilities.canManage ? (
                          <button type="button" onClick={() => setVacationToDelete(vacation)} aria-label="Eliminar vacaciones" title="Eliminar">
                            <Trash2 size={15} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <Plane size={26} />
            <strong>
              {vacationEmployeeId || vacationEmployeeQuery.trim()
                ? "No hay vacaciones para el empleado seleccionado."
                : "No hay solicitudes de vacaciones para este mes."}
            </strong>
            <span>
              {vacationEmployeeId || vacationEmployeeQuery.trim()
                ? "Selecciona otro empleado o limpia el filtro."
                : capabilities.canRequest
                  ? "Registra una solicitud para que pueda ser revisada."
                  : "No existen registros disponibles para este periodo."}
            </span>
          </div>
        )}
      </section>

      <CatalogDrawer
        isOpen={isEditorOpen}
        eyebrow="Nueva solicitud"
        title={capabilities.canManage ? "Registrar vacaciones" : "Solicitar vacaciones"}
        onClose={closeEditor}
      >
        <form className={styles.editorForm} onSubmit={saveVacation}>
          <fieldset className={styles.editorFields} disabled={isPending}>
            <EmployeeAutocomplete
              employees={activeEmployees}
              value={form.employeeId}
              query={employeeQuery}
              onQueryChange={handleEmployeeQueryChange}
              onSelect={selectEmployee}
              onClearSelection={() => updateForm("employeeId", "")}
              placeholder="Buscar por nombre, cedula, area o rol"
              disabled={isPending}
            />

            {selectedEmployee ? (
              <div className={styles.employeeSnapshot}>
                <strong>{selectedEmployee.branchName || selectedEmployee.branch || "Sin sucursal"}</strong>
                <span>{[selectedEmployee.areaName, selectedEmployee.roleName].filter(Boolean).join(" / ") || "Sin area o rol"}</span>
              </div>
            ) : null}

            <label className={styles.rangeToggle}>
              <input
                type="checkbox"
                checked={form.isDateRange}
                onChange={(event) => toggleDateRange(event.target.checked)}
              />
              <span>Aplica por varios días</span>
            </label>

            <div className={`${styles.dateGrid} ${!form.isDateRange ? styles.dateGridSingle : ""}`}>
              <label className={styles.field}>
                <span>{form.isDateRange ? "Inicio" : "Fecha"}</span>
                <input
                  type="date"
                  value={form.startDateKey}
                  onChange={(event) => updateStartDate(event.target.value)}
                  required
                />
              </label>
              {form.isDateRange ? (
                <label className={styles.field}>
                  <span>Fin</span>
                  <input
                    type="date"
                    min={form.startDateKey || undefined}
                    value={form.endDateKey}
                    onChange={(event) => updateForm("endDateKey", event.target.value)}
                    required
                  />
                </label>
              ) : null}
            </div>

            <label className={styles.field}>
              <span>Notas</span>
              <textarea
                value={form.notes}
                onChange={(event) => updateForm("notes", event.target.value)}
                placeholder="Observacion interna opcional"
                rows={3}
              />
            </label>

            <div className={styles.formSummary}>
              <span>
                {requestedDays || 0} {requestedDays === 1 ? "día calendario" : "días calendario"}
              </span>
              {form.isDateRange && form.startDateKey && form.endDateKey <= form.startDateKey ? (
                <small>La fecha final debe ser posterior a la fecha inicial.</small>
              ) : null}
            </div>
          </fieldset>

          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={closeEditor} disabled={isPending}>
              Cancelar
            </button>
            <button type="submit" className={styles.primaryButton} disabled={!canSave || isPending}>
              <Save size={16} />
              {isPending
                ? "Guardando..."
                : capabilities.canManage ? "Registrar vacaciones" : "Enviar solicitud"}
            </button>
          </div>
        </form>
      </CatalogDrawer>
    </div>
  );
}
