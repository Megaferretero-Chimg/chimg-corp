"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addMonths, differenceInCalendarDays, format, parseISO, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Edit3,
  Plane,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmployeeAutocomplete from "@/components/ui/EmployeeAutocomplete";
import FloatingNotice from "@/components/ui/FloatingNotice";
import styles from "@/modules/planner/styles/components/planning/VacationPlanner.module.scss";

const EMPTY_FORM = {
  id: "",
  employeeId: "",
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
  const [form, setForm] = useState(EMPTY_FORM);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [vacationEmployeeQuery, setVacationEmployeeQuery] = useState("");
  const [vacationEmployeeId, setVacationEmployeeId] = useState("");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [vacationToDelete, setVacationToDelete] = useState(null);
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
  const requestedDays = calculateDays(form.startDateKey, form.endDateKey);
  const canSave = Boolean(form.employeeId && form.startDateKey && form.endDateKey && requestedDays > 0);

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
    const response = await fetch(`/api/planner/planning/vacations?month=${monthKey}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "No se pudieron cargar las vacaciones.");
    }

    setVacations(payload.vacations || []);
  }, [monthKey]);

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      setIsLoading(true);

      try {
        const [employeesResponse, vacationsResponse] = await Promise.all([
          fetch("/api/company/employees"),
          fetch(`/api/planner/planning/vacations?month=${monthKey}`),
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

  function openEditEditor(vacation) {
    const employee = activeEmployees.find((entry) => entry.id === vacation.employeeId);

    setForm({
      id: vacation.id,
      employeeId: vacation.employeeId,
      startDateKey: vacation.startDateKey,
      endDateKey: vacation.endDateKey,
      notes: vacation.notes || "",
    });
    setEmployeeQuery(employee?.fullName || vacation.employeeName || "");
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
      showNotice("error", "Selecciona empleado y un rango de fechas valido.");
      return;
    }

    const endpoint = form.id ? `/api/planner/planning/vacations/${form.id}` : "/api/planner/planning/vacations";
    const method = form.id ? "PATCH" : "POST";

    startTransition(async () => {
      try {
        const response = await fetch(endpoint, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
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
          <button type="button" className={styles.primaryButton} onClick={openCreateEditor}>
            <Plus size={16} />
            Nueva vacacion
          </button>
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
              <span>Registros</span>
              <strong>{vacations.length}</strong>
            </div>
            <div className={styles.metric}>
              <span>Dias calendario</span>
              <strong>{vacations.reduce((total, vacation) => total + vacation.totalCalendarDays, 0)}</strong>
            </div>
            <div className={styles.metric}>
              <span>Empleados activos</span>
              <strong>{activeEmployees.length}</strong>
            </div>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.listHeader}>
          <div>
            <h3>Vacaciones registradas</h3>
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
                      <span>hasta {vacation.endDateKey}</span>
                    </td>
                    <td>{vacation.totalCalendarDays}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <button type="button" onClick={() => openEditEditor(vacation)} aria-label="Editar vacaciones">
                          <Edit3 size={15} />
                        </button>
                        <button type="button" onClick={() => setVacationToDelete(vacation)} aria-label="Eliminar vacaciones">
                          <Trash2 size={15} />
                        </button>
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
                : "No hay vacaciones registradas para este mes."}
            </strong>
            <span>
              {vacationEmployeeId || vacationEmployeeQuery.trim()
                ? "Selecciona otro empleado o limpia el filtro."
                : "Agrega los registros de vacaciones antes de armar el horario."}
            </span>
          </div>
        )}
      </section>

      <CatalogDrawer
        isOpen={isEditorOpen}
        eyebrow={form.id ? "Editar registro" : "Nuevo registro"}
        title={form.id ? "Editar vacaciones" : "Registrar vacaciones"}
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

            <div className={styles.dateGrid}>
              <label className={styles.field}>
                <span>Inicio</span>
                <input type="date" value={form.startDateKey} onChange={(event) => updateForm("startDateKey", event.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Fin</span>
                <input type="date" value={form.endDateKey} onChange={(event) => updateForm("endDateKey", event.target.value)} />
              </label>
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
              <span>{requestedDays || 0} dias calendario</span>
            </div>
          </fieldset>

          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={closeEditor} disabled={isPending}>
              Cancelar
            </button>
            <button type="submit" className={styles.primaryButton} disabled={!canSave || isPending}>
              <Save size={16} />
              {isPending ? "Guardando..." : "Guardar vacaciones"}
            </button>
          </div>
        </form>
      </CatalogDrawer>
    </div>
  );
}
