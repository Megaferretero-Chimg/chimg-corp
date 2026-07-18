"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addMonths, endOfMonth, format, getDay, startOfMonth, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Save, Trash2 } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingModal from "@/components/ui/FloatingModal";
import FloatingNotice from "@/components/ui/FloatingNotice";
import styles from "@/modules/planner/styles/components/planning/HolidaysCalendar.module.scss";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

function buildMonthDays(monthDate) {
  const firstDay = startOfMonth(monthDate);
  const lastDay = endOfMonth(monthDate);
  const days = [];
  const startOffset = (getDay(firstDay) + 6) % 7;

  for (let index = 0; index < startOffset; index += 1) {
    days.push(null);
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
    days.push({
      day,
      dateKey: format(date, "yyyy-MM-dd"),
      weekday: getDay(date),
    });
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

export default function HolidaysCalendar() {
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [holidays, setHolidays] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [holidayName, setHolidayName] = useState("");
  const [holidayToDelete, setHolidayToDelete] = useState(null);
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const monthKey = format(monthDate, "yyyy-MM");
  const monthLabel = format(monthDate, "MMMM yyyy", { locale: es });

  const holidaysByDate = useMemo(
    () => new Map(holidays.map((holiday) => [holiday.dateKey, holiday])),
    [holidays],
  );
  const monthDays = useMemo(() => buildMonthDays(monthDate), [monthDate]);
  const selectedHoliday = selectedDay ? holidaysByDate.get(selectedDay.dateKey) : null;

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

  useEffect(() => {
    let isCancelled = false;

    async function loadHolidays() {
      try {
        const response = await fetch(`/api/planner/planning/holidays?month=${monthKey}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudieron cargar los feriados.");
        }

        if (!isCancelled) {
          setHolidays(payload.holidays || []);
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

    loadHolidays();

    return () => {
      isCancelled = true;
      clearNoticeTimers();
    };
  }, [clearNoticeTimers, monthKey, showNotice]);

  function openDay(day) {
    if (!day) {
      return;
    }

    const holiday = holidaysByDate.get(day.dateKey);
    setSelectedDay(day);
    setHolidayName(holiday?.name || "");
  }

  function closeEditor() {
    setSelectedDay(null);
    setHolidayName("");
  }

  function saveHoliday(event) {
    event.preventDefault();

    if (!selectedDay || !holidayName.trim()) {
      showNotice("error", "Escribe el nombre del feriado.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/planning/holidays", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dateKey: selectedDay.dateKey,
            name: holidayName,
          }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar el feriado.");
        }

        setHolidays((current) => {
          const exists = current.some((holiday) => holiday.id === payload.holiday.id);
          const next = exists
            ? current.map((holiday) => (holiday.id === payload.holiday.id ? payload.holiday : holiday))
            : [...current.filter((holiday) => holiday.dateKey !== payload.holiday.dateKey), payload.holiday];

          return next.sort((left, right) => left.dateKey.localeCompare(right.dateKey));
        });
        closeEditor();
        showNotice("success", payload.message);
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  function confirmDeleteHoliday() {
    if (!holidayToDelete) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/planner/planning/holidays/${holidayToDelete.id}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo eliminar el feriado.");
        }

        setHolidays((current) => current.filter((holiday) => holiday.id !== holidayToDelete.id));
        setHolidayToDelete(null);
        closeEditor();
        showNotice("success", "Feriado eliminado correctamente.");
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  return (
    <div className={styles.stack}>
      <FloatingNotice notice={notice} onClose={dismissNotice} />
      <ConfirmDialog
        isOpen={Boolean(holidayToDelete)}
        title="Eliminar feriado"
        message={`Deseas eliminar "${holidayToDelete?.name || ""}"? Esta fecha dejara de contarse como feriado.`}
        confirmLabel={isPending ? "Eliminando..." : "Eliminar"}
        isPending={isPending}
        onCancel={() => setHolidayToDelete(null)}
        onConfirm={confirmDeleteHoliday}
      />

      <section className={styles.panel}>
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
        </div>

        <div className={styles.calendar}>
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className={styles.weekday}>{label}</div>
          ))}

          {monthDays.map((day, index) => {
            const holiday = day ? holidaysByDate.get(day.dateKey) : null;
            const isWeekend = day ? day.weekday === 0 || day.weekday === 6 : false;

            return (
              <button
                key={day?.dateKey || `empty-${index}`}
                type="button"
                className={`${styles.dayCell} ${!day ? styles.dayCellEmpty : ""} ${day && !isWeekend ? styles.dayCellWorkday : ""} ${isWeekend ? styles.dayCellWeekend : ""} ${holiday ? styles.dayCellHoliday : ""}`}
                onClick={() => openDay(day)}
                disabled={!day}
              >
                {day ? (
                  <>
                    <span className={styles.dayNumber}>{day.day}</span>
                    {holiday ? <strong className={styles.holidayName}>{holiday.name}</strong> : <span className={styles.addHint}><Plus size={14} /> Agregar</span>}
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <FloatingModal
        isOpen={Boolean(selectedDay)}
        eyebrow={selectedDay?.dateKey || ""}
        title={selectedHoliday ? "Editar feriado" : "Agregar feriado"}
        isPending={isPending}
        onClose={closeEditor}
      >
        <form className={styles.editorForm} onSubmit={saveHoliday}>
          <label className={styles.field}>
            <span>Nombre del feriado</span>
            <input value={holidayName} onChange={(event) => setHolidayName(event.target.value)} placeholder="Ej. INDEPENDENCIA DE AMBATO" autoFocus disabled={isPending} />
          </label>

          <div className={styles.actions}>
            {selectedHoliday ? (
              <button type="button" className={styles.dangerButton} onClick={() => setHolidayToDelete(selectedHoliday)}>
                <Trash2 size={16} />
                Eliminar
              </button>
            ) : null}
            <button type="submit" className={styles.primaryButton} disabled={isPending || !holidayName.trim()}>
              <Save size={16} />
              {isPending ? "Guardando..." : "Guardar feriado"}
            </button>
          </div>
        </form>
      </FloatingModal>

      <section className={styles.summaryPanel}>
        <strong>{holidays.length}</strong>
        <span>{holidays.length === 1 ? "feriado registrado" : "feriados registrados"} en {monthLabel}</span>
        {isLoading ? <em>Cargando...</em> : null}
      </section>
    </div>
  );
}
