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
  Search,
  XCircle,
} from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmployeeAutocomplete from "@/components/ui/EmployeeAutocomplete";
import FloatingNotice from "@/components/ui/FloatingNotice";
import { PLANNING_EXCEPTIONS_ACCESS_ROLE } from "@/lib/access-roles";
import styles from "@/modules/planner/styles/components/planning/ExceptionManager.module.scss";

const EXCEPTION_FLOWS = [
  {
    value: "paid_absence",
    label: "Falta justificada",
    description: "Reconoce las horas laborables planificadas del dia, sin suplementarias ni extraordinarias.",
    type: "permission",
    scope: "full_day",
    resolution: "approved_work_time",
    effect: "paid_absence",
    attendanceMode: "ignore_attendance",
    payMode: "regular_only",
  },
  {
    value: "partial_leave",
    label: "Permiso por horas",
    description: "Justifica solo un rango de horas y mantiene las picadas del resto del dia.",
    type: "medical_appointment",
    scope: "partial_day",
    resolution: "approved_work_time",
    effect: "paid_partial_leave",
    attendanceMode: "ignore_attendance",
    payMode: "regular_only",
  },
  {
    value: "schedule_change",
    label: "Cambio de horario",
    description: "Cambia lo planificado para comparar contra las picadas reales.",
    type: "schedule_change",
    scope: "full_day",
    resolution: "approved_work_time",
    effect: "planning_change",
    attendanceMode: "use_punches",
    payMode: "no_pay_change",
  },
  {
    value: "external_work",
    label: "Trabajo externo",
    description: "Justifica una jornada realizada fuera del punto habitual y cubre el horario planificado sin exigir picadas.",
    type: "outside_work",
    scope: "full_day",
    resolution: "approved_work_time",
    effect: "external_work",
    attendanceMode: "use_authorized_schedule",
    payMode: "regular_and_extra",
  },
  {
    value: "manual_punch",
    label: "Agregar picada manual",
    description: "Corrige una picada omitida con hora registrada y trazabilidad.",
    type: "outside_work_punch",
    scope: "other",
    resolution: "approved_work_time",
    effect: "manual_punch",
    attendanceMode: "add_manual_punch",
    payMode: "no_pay_change",
  },
  {
    value: "unpaid_absence",
    label: "Falta con descuento",
    description: "Registra una ausencia que no debe reconocerse como tiempo laborable.",
    type: "permission",
    scope: "full_day",
    resolution: "discount_day",
    effect: "unpaid_absence",
    attendanceMode: "ignore_attendance",
    payMode: "discount",
  },
];
const OUTSIDE_WORK_PUNCH_TYPE = "outside_work_punch";
const EXCEPTIONS_PAGE_SIZE = 10;
const CUSTOM_SCHEDULE_KEY = "__custom_schedule__";

const EMPTY_FORM = {
  id: "",
  employeeId: "",
  flowType: "paid_absence",
  type: "permission",
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
  effect: "paid_absence",
  attendanceMode: "ignore_attendance",
  payMode: "regular_only",
  countsAsWorkedTime: false,
  allowSupplementaryTime: false,
  registeredBy: "",
  authorizedBy: "",
  resolution: "approved_work_time",
  resolutionNotes: "",
  notes: "",
};

const DEFAULT_FLOW = EXCEPTION_FLOWS[0];

function getFlowDefinition(flowType) {
  return EXCEPTION_FLOWS.find((flow) => flow.value === flowType) || DEFAULT_FLOW;
}

function inferFlowType(exception) {
  const effect = String(exception?.effect || "");
  const type = String(exception?.type || "");
  const resolution = String(exception?.resolution || "");
  const scope = String(exception?.scope || "");

  if (effect === "manual_punch" || type === OUTSIDE_WORK_PUNCH_TYPE || scope === "missing_punch") return "manual_punch";
  if (effect === "external_work" || type === "outside_work") return "external_work";
  if (effect === "planning_change" || type === "schedule_change") return "schedule_change";
  if (effect === "unpaid_absence" || resolution === "discount_day") return "unpaid_absence";
  if (effect === "paid_partial_leave" || scope === "partial_day") return "partial_leave";

  return "paid_absence";
}

function buildExceptionForm(exception) {
  const supportedScope = ["full_day", "partial_day", "other"].includes(exception.scope)
    ? exception.scope
    : "other";

  return {
    id: exception.id,
    employeeId: exception.employeeId,
    flowType: inferFlowType(exception),
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
    effect: exception.effect || "other",
    attendanceMode: exception.attendanceMode || "use_punches",
    payMode: exception.payMode || "regular_only",
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

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function dateKeyToLocalDate(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);

  if (!year || !month || !day) return new Date();

  return new Date(year, month - 1, day);
}

function addMonthsRangeEnd(dateKey, months) {
  const startDate = dateKeyToLocalDate(dateKey);
  const endDate = addMonths(startDate, Math.max(1, Number(months) || 1));

  endDate.setDate(endDate.getDate() - 1);

  return format(endDate, "yyyy-MM-dd");
}

function deriveResolutionEffect(form) {
  const flow = getFlowDefinition(form.flowType);

  if (flow.value === "manual_punch") {
    return {
      type: flow.type,
      scope: flow.scope,
      effect: flow.effect,
      attendanceMode: flow.attendanceMode,
      payMode: flow.payMode,
    };
  }

  if (flow.value === "schedule_change") {
    return {
      type: flow.type,
      scope: form.endDateKey ? "date_range" : flow.scope,
      effect: flow.effect,
      attendanceMode: flow.attendanceMode,
      payMode: flow.payMode,
    };
  }

  if (flow.value === "external_work") {
    return {
      type: flow.type,
      scope: form.endDateKey ? "date_range" : flow.scope,
      effect: flow.effect,
      attendanceMode: flow.attendanceMode,
      payMode: flow.payMode,
    };
  }

  if (flow.value === "partial_leave") {
    return {
      type: flow.type,
      scope: flow.scope,
      effect: flow.effect,
      attendanceMode: flow.attendanceMode,
      payMode: flow.payMode,
    };
  }

  if (flow.value === "unpaid_absence") {
    return {
      type: flow.type,
      scope: form.endDateKey ? "date_range" : flow.scope,
      effect: flow.effect,
      attendanceMode: flow.attendanceMode,
      payMode: flow.payMode,
    };
  }

  return {
    type: flow.type,
    scope: form.endDateKey ? "date_range" : flow.scope,
    effect: flow.effect,
    attendanceMode: flow.attendanceMode,
    payMode: flow.payMode,
  };
}

export default function ExceptionManager({
  eyebrow = "Control operativo",
  title = "Ajustes y excepciones",
  description = "Registra novedades reales por empleado y deja trazabilidad de la resolucion tomada.",
  currentUserAccessRole = "",
  onlyPending = false,
  showCreateButton = true,
  showBulkDeleteButton = true,
  listTitle = "Justificaciones registradas",
  emptyTitle = "No hay justificaciones registradas para este mes.",
  emptyFilteredTitle = "No hay justificaciones para ese filtro.",
  emptyDescription = "Registra permisos, salidas tempranas, citas medicas o faltas justificadas cuando ocurran.",
  emptyFilteredDescription = "Prueba con otro nombre, cedula, sucursal, area o rol.",
}) {
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [employees, setEmployees] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [canApproveExceptions, setCanApproveExceptions] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [exceptionSearch, setExceptionSearch] = useState("");
  const [isCustomScheduleMode, setIsCustomScheduleMode] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [exceptionToDelete, setExceptionToDelete] = useState(null);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const monthKey = format(monthDate, "yyyy-MM");
  const monthLabel = format(monthDate, "MMMM yyyy", { locale: es });
  const isLimitedExceptionUser = currentUserAccessRole === PLANNING_EXCEPTIONS_ACCESS_ROLE;
  const canResolveExceptions = !isLimitedExceptionUser && canApproveExceptions;

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
  const selectedScheduleExists = scheduleOptions.some((schedule) => schedule.key === selectedScheduleKey);
  const selectedScheduleValue = selectedScheduleKey && selectedScheduleExists
    ? selectedScheduleKey
    : selectedScheduleKey || isCustomScheduleMode
      ? CUSTOM_SCHEDULE_KEY
      : "";
  const usesCustomSchedule = isCustomScheduleMode || selectedScheduleValue === CUSTOM_SCHEDULE_KEY;
  const scopedExceptions = useMemo(
    () => (onlyPending ? exceptions.filter((exception) => exception.resolution === "pending") : exceptions),
    [exceptions, onlyPending],
  );
  const approvedCount = scopedExceptions.filter((exception) => exception.resolution !== "pending" && exception.resolution !== "discount_day").length;
  const discountCount = scopedExceptions.filter((exception) => exception.resolution === "discount_day").length;
  const pendingCount = scopedExceptions.filter((exception) => exception.resolution === "pending").length;
  const filteredExceptions = useMemo(() => {
    const query = normalizeSearch(exceptionSearch);

    if (!query) return scopedExceptions;

    return scopedExceptions.filter((exception) =>
      normalizeSearch([
        exception.employeeName,
        exception.employeeDni,
        exception.branchName,
        exception.areaName,
        exception.roleName,
      ].filter(Boolean).join(" ")).includes(query),
    );
  }, [exceptionSearch, scopedExceptions]);
  const orderedExceptions = useMemo(
    () =>
      [...filteredExceptions].sort((left, right) => {
        const rightDate = new Date(right.dateKey || right.date || right.createdAt || 0).getTime();
        const leftDate = new Date(left.dateKey || left.date || left.createdAt || 0).getTime();

        if (rightDate !== leftDate) {
          return rightDate - leftDate;
        }

        return String(left.employeeName || "").localeCompare(String(right.employeeName || ""), "es");
      }),
    [filteredExceptions],
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
  const selectedFlow = getFlowDefinition(form.flowType);
  const createsManualPunch = selectedFlow.value === "manual_punch";
  const needsSchedule = selectedFlow.value === "schedule_change";
  const needsTimeRange = selectedFlow.value === "partial_leave";
  const canUseDateRange = !createsManualPunch && selectedFlow.value !== "partial_leave";
  const showsSchedulePresets = selectedFlow.value === "schedule_change";
  const canSave = Boolean(
    form.employeeId
    && selectedFlow.value
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
    const response = await fetch(`/api/planner/planning/exceptions?month=${monthKey}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "No se pudieron cargar las excepciones.");
    }

    setExceptions(payload.exceptions || []);
    setCanApproveExceptions(Boolean(payload.options?.canApproveExceptions));
  }, [monthKey]);

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      setIsLoading(true);

      try {
        const [employeesResponse, exceptionsResponse, templatesResponse] = await Promise.all([
          fetch("/api/company/employees?scope=planning"),
          fetch(`/api/planner/planning/exceptions?month=${monthKey}`),
          fetch("/api/planner/planning/base-schedules"),
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
          setCanApproveExceptions(Boolean(exceptionsPayload.options?.canApproveExceptions));
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

  function updateExceptionSearch(value) {
    setExceptionSearch(value);
    setCurrentPage(1);
  }

  function updateEmployee(value) {
    setIsCustomScheduleMode(false);
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

  function selectEmployee(employee) {
    updateEmployee(employee?.id || "");
    setEmployeeQuery(employee?.fullName || "");
  }

  function handleEmployeeQueryChange(value) {
    setEmployeeQuery(value);
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

  function applyRangePreset(months) {
    setForm((current) => ({
      ...current,
      endDateKey: addMonthsRangeEnd(current.dateKey, months),
    }));
  }

  function applyMaternitySchedulePreset() {
    setForm((current) => ({
      ...current,
      flowType: "schedule_change",
      type: "schedule_change",
      scope: "full_day",
      resolution: current.id && canResolveExceptions ? "approved_work_time" : "pending",
      effect: "planning_change",
      attendanceMode: "use_punches",
      payMode: "no_pay_change",
      countsAsWorkedTime: false,
      allowSupplementaryTime: false,
      startTime: "",
      endTime: "",
      endDateKey: current.endDateKey || addMonthsRangeEnd(current.dateKey, 1),
      notes: current.notes || "Permiso de maternidad: cambio de horario laboral, mantiene control por picadas.",
    }));
  }

  function updateFlowType(value) {
    const flow = getFlowDefinition(value);

    setIsCustomScheduleMode(false);
    setForm((current) => ({
      ...current,
      flowType: flow.value,
      type: flow.type,
      scope: flow.scope,
      effect: flow.effect,
      attendanceMode: flow.attendanceMode,
      payMode: flow.payMode,
      resolution: current.id && canResolveExceptions ? flow.resolution : "pending",
      startTime: flow.value === "partial_leave" ? current.startTime : "",
      endTime: flow.value === "partial_leave" ? current.endTime : "",
      plannedStartTime: flow.value === "schedule_change" ? current.plannedStartTime : "",
      plannedEndTime: flow.value === "schedule_change" ? current.plannedEndTime : "",
      plannedLunchStartTime: flow.value === "schedule_change" ? current.plannedLunchStartTime : "",
      plannedLunchEndTime: flow.value === "schedule_change" ? current.plannedLunchEndTime : "",
      plannedLunchDurationMinutes: flow.value === "schedule_change" ? current.plannedLunchDurationMinutes : 0,
      manualPunchTime: flow.value === "manual_punch" ? current.manualPunchTime : "",
      endDateKey: ["manual_punch", "partial_leave"].includes(flow.value) ? "" : current.endDateKey,
      countsAsWorkedTime: false,
      allowSupplementaryTime: false,
    }));
  }

  function updateSchedule(key) {
    if (key === CUSTOM_SCHEDULE_KEY) {
      setIsCustomScheduleMode(true);
      setForm((current) => ({
        ...current,
        plannedStartTime: current.plannedStartTime || "",
        plannedEndTime: current.plannedEndTime || "",
        plannedLunchStartTime: current.plannedLunchStartTime || "",
        plannedLunchEndTime: current.plannedLunchEndTime || "",
        plannedLunchDurationMinutes: Number(current.plannedLunchDurationMinutes) || 0,
      }));
      return;
    }

    setIsCustomScheduleMode(false);
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

  function describeExceptionTime(exception) {
    const range = exception.endDateKey ? `${exception.dateKey} hasta ${exception.endDateKey}` : exception.dateKey;

    if (exception.type === OUTSIDE_WORK_PUNCH_TYPE && exception.manualPunchTime) {
      return `${range} · picada ${exception.manualPunchTime}`;
    }

    return range;
  }

  function openCreateEditor() {
    setIsCustomScheduleMode(false);
    setForm({
      ...EMPTY_FORM,
      dateKey: `${monthKey}-01`,
      resolution: "pending",
      authorizedBy: "",
    });
    setEmployeeQuery("");
    setIsEditorOpen(true);
  }

  function openEditEditor(exception) {
    if (!canResolveExceptions) {
      return;
    }

    const employee = activeEmployees.find((entry) => entry.id === exception.employeeId);

    setForm(buildExceptionForm(exception));
    setIsCustomScheduleMode(false);
    setEmployeeQuery(employee?.fullName || exception.employeeName || "");
    setIsEditorOpen(true);
  }

  const closeEditor = useCallback(() => {
    setForm(EMPTY_FORM);
    setEmployeeQuery("");
    setIsCustomScheduleMode(false);
    setIsEditorOpen(false);
  }, []);

  function saveException(event) {
    event.preventDefault();

    if (!canSave) {
      showNotice("error", "Selecciona empleado, motivo, fecha y agrega una descripcion.");
      return;
    }

    const endpoint = form.id ? `/api/planner/planning/exceptions/${form.id}` : "/api/planner/planning/exceptions";
    const method = form.id ? "PATCH" : "POST";
    const resolutionEffect = deriveResolutionEffect(form);
    const canResolveCurrentException = Boolean(form.id && canResolveExceptions);
    const requestBody = {
      ...form,
      ...resolutionEffect,
      resolution: canResolveCurrentException ? form.resolution : "pending",
      authorizedBy: "",
      startTime: needsTimeRange ? form.startTime : "",
      endTime: needsTimeRange ? form.endTime : "",
      plannedStartTime: needsSchedule ? form.plannedStartTime : "",
      plannedEndTime: needsSchedule ? form.plannedEndTime : "",
      plannedLunchStartTime: needsSchedule ? form.plannedLunchStartTime : "",
      plannedLunchEndTime: needsSchedule ? form.plannedLunchEndTime : "",
      plannedLunchDurationMinutes: needsSchedule ? form.plannedLunchDurationMinutes : 0,
      manualPunchTime: createsManualPunch ? form.manualPunchTime : "",
      destination: "",
      countsAsWorkedTime: false,
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
        const response = await fetch(`/api/planner/planning/exceptions/${exceptionToDelete.id}`, {
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

  function confirmBulkDeleteExceptions() {
    if (!orderedExceptions.length) {
      return;
    }

    startTransition(async () => {
      try {
        for (const exception of orderedExceptions) {
          const response = await fetch(`/api/planner/planning/exceptions/${exception.id}`, {
            method: "DELETE",
          });
          const payload = await response.json();

          if (!response.ok) {
            throw new Error(payload.error || "No se pudo anular una justificacion filtrada.");
          }
        }

        setIsBulkDeleteOpen(false);
        await loadExceptions();
        showNotice("success", "Justificaciones filtradas anuladas correctamente.");
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
      <ConfirmDialog
        isOpen={isBulkDeleteOpen}
        title="Anular justificaciones filtradas"
        message={`Se anularan ${orderedExceptions.length} registros del filtro actual. No se tocaran horarios planificados ni picadas.`}
        confirmLabel={isPending ? "Anulando..." : "Anular filtradas"}
        isPending={isPending}
        onCancel={() => setIsBulkDeleteOpen(false)}
        onConfirm={confirmBulkDeleteExceptions}
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

            {showCreateButton ? (
              <button type="button" className={styles.primaryButton} onClick={openCreateEditor}>
                <Plus size={16} />
                Nueva justificacion
              </button>
            ) : null}
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
              <strong>{scopedExceptions.length}</strong>
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
            <h3>{listTitle}</h3>
            <p>
              {isLoading
                ? "Cargando..."
                : exceptionSearch.trim()
                  ? `${orderedExceptions.length} de ${scopedExceptions.length} registros · Periodo ${monthLabel}`
                  : `Periodo ${monthLabel} · mas recientes primero`}
            </p>
          </div>
          <label className={styles.searchField}>
            <Search size={16} />
            <input
              type="search"
              value={exceptionSearch}
              onChange={(event) => updateExceptionSearch(event.target.value)}
              placeholder="Filtrar por empleado"
              aria-label="Filtrar justificaciones por empleado"
              disabled={isLoading}
            />
          </label>
          {showBulkDeleteButton && canResolveExceptions && exceptionSearch.trim() && orderedExceptions.length ? (
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => setIsBulkDeleteOpen(true)}
              disabled={isPending}
            >
              Anular filtradas
            </button>
          ) : null}
        </div>

        {!isLoading && exceptionSearch.trim() && !orderedExceptions.length && scopedExceptions.length ? (
          <div className={styles.filterNotice}>
            <span>No hay registros para ese empleado en {monthLabel}.</span>
            <button type="button" onClick={() => updateExceptionSearch("")}>Limpiar filtro</button>
          </div>
        ) : null}

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
        ) : orderedExceptions.length ? (
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
                    className={canResolveExceptions ? styles.clickableRow : ""}
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
                      {canResolveExceptions ? (
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
                      ) : null}
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
            <strong>
              {scopedExceptions.length ? emptyFilteredTitle : emptyTitle}
            </strong>
            <span>
              {scopedExceptions.length ? emptyFilteredDescription : emptyDescription}
            </span>
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
          <fieldset className={styles.editorFields} disabled={isPending}>
            <EmployeeAutocomplete
              employees={activeEmployees}
              value={form.employeeId}
              query={employeeQuery}
              onQueryChange={handleEmployeeQueryChange}
              onSelect={selectEmployee}
              onClearSelection={() => updateEmployee("")}
              placeholder="Buscar por nombre, cedula, area o rol"
              disabled={isPending}
            />

          {selectedEmployee ? (
            <div className={styles.employeeSnapshot}>
              <strong>{selectedEmployee.branchName || selectedEmployee.branch || "Sin sucursal"}</strong>
              <span>{[selectedEmployee.areaName, selectedEmployee.roleName].filter(Boolean).join(" / ") || "Sin area o rol"}</span>
            </div>
          ) : null}

          <fieldset className={styles.flowFieldset}>
            <legend>Tipo de resolucion</legend>
            <div className={styles.flowGrid}>
              {EXCEPTION_FLOWS.map((flow) => (
                <button
                  key={flow.value}
                  type="button"
                  className={styles.flowOption}
                  data-active={form.flowType === flow.value}
                  onClick={() => updateFlowType(flow.value)}
                >
                  <strong>{flow.label}</strong>
                  <span>{flow.description}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className={styles.flowSummary}>
            <strong>{selectedFlow.label}</strong>
            <span>{selectedFlow.description}</span>
          </div>

          <div className={styles.twoColumnGrid}>
            <label className={styles.field}>
              <span>Fecha</span>
              <input type="date" value={form.dateKey} onChange={(event) => updateForm("dateKey", event.target.value)} />
            </label>
            <label className={styles.field} data-muted={!hasDateRange || !canUseDateRange}>
              <span>Fecha fin</span>
              <input
                type="date"
                value={form.endDateKey}
                onChange={(event) => updateForm("endDateKey", event.target.value)}
                disabled={!hasDateRange || !canUseDateRange}
              />
            </label>
          </div>

          {canUseDateRange ? (
            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={hasDateRange}
                onChange={(event) => setDateRangeEnabled(event.target.checked)}
              />
              <span>Aplica por varios dias</span>
            </label>
          ) : null}

          {showsSchedulePresets ? (
            <div className={styles.presetPanel}>
              <span>Atajos de cambio de horario</span>
              <div className={styles.presetActions}>
                <button type="button" onClick={applyMaternitySchedulePreset}>
                  Maternidad / cambio de horario
                </button>
                <button type="button" onClick={() => applyRangePreset(1)}>
                  Todo el mes
                </button>
                <button type="button" onClick={() => applyRangePreset(3)}>
                  3 meses
                </button>
                <button type="button" onClick={() => applyRangePreset(12)}>
                  12 meses
                </button>
              </div>
            </div>
          ) : null}

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

          {needsSchedule ? (
            <label className={styles.field}>
              <span>Nuevo horario planificado</span>
              <select value={selectedScheduleValue} onChange={(event) => updateSchedule(event.target.value)}>
                <option value="">Seleccionar horario</option>
                {scheduleOptions.map((schedule) => (
                  <option key={schedule.key} value={schedule.key}>
                    {schedule.label}
                  </option>
                ))}
                <option value={CUSTOM_SCHEDULE_KEY}>Horario personalizado</option>
              </select>
            </label>
          ) : null}

          {needsSchedule && usesCustomSchedule ? (
            <>
              <div className={styles.twoColumnGrid}>
                <label className={styles.field}>
                  <span>Inicio planificado</span>
                  <input type="time" value={form.plannedStartTime} onChange={(event) => updateForm("plannedStartTime", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span>Fin planificado</span>
                  <input type="time" value={form.plannedEndTime} onChange={(event) => updateForm("plannedEndTime", event.target.value)} />
                </label>
              </div>
              <div className={styles.twoColumnGrid}>
                <label className={styles.field}>
                  <span>Inicio almuerzo</span>
                  <input type="time" value={form.plannedLunchStartTime} onChange={(event) => updateForm("plannedLunchStartTime", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span>Fin almuerzo</span>
                  <input type="time" value={form.plannedLunchEndTime} onChange={(event) => updateForm("plannedLunchEndTime", event.target.value)} />
                </label>
              </div>
            </>
          ) : null}

          {needsTimeRange ? (
            <div className={styles.twoColumnGrid}>
              <label className={styles.field}>
                <span>Hora inicio permiso</span>
                <input type="time" value={form.startTime} onChange={(event) => updateForm("startTime", event.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Hora fin permiso</span>
                <input type="time" value={form.endTime} onChange={(event) => updateForm("endTime", event.target.value)} />
              </label>
            </div>
          ) : null}

          <label className={styles.field}>
            <span>Descripcion</span>
            <textarea
              value={form.notes}
              onChange={(event) => updateForm("notes", event.target.value)}
              placeholder="Ej. falta por enfermedad, permiso de 10:00 a 12:00, trabajo externo autorizado, cambio de horario por maternidad."
              rows={4}
            />
          </label>

          </fieldset>

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
