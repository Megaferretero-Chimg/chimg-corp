"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addMonths, format, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Save,
  XCircle,
} from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import AutocompleteSelect from "@/components/ui/AutocompleteSelect";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmployeeAutocomplete from "@/components/ui/EmployeeAutocomplete";
import FloatingModal from "@/components/ui/FloatingModal";
import FloatingNotice from "@/components/ui/FloatingNotice";
import TimeInput24 from "@/components/ui/TimeInput24";
import styles from "@/modules/planner/styles/components/planning/ExceptionManager.module.scss";

const EXCEPTION_FLOWS = [
  {
    category: "planning",
    value: "absence_report",
    label: "Falta o ausencia",
    description: "Registra una falta informada por la jefatura para que Talento Humano decida si corresponde descontar la jornada.",
    type: "absence",
    scope: "full_day",
    resolution: "approved_work_time",
    effect: "paid_absence",
    attendanceMode: "ignore_attendance",
    payMode: "regular_only",
    reviewMode: "deduction",
  },
  {
    category: "planning",
    value: "hourly_permission",
    label: "Permiso de salida",
    description: "Registra un permiso por horas para que Talento Humano decida si ese tiempo se descuenta.",
    type: "permission",
    scope: "partial_day",
    resolution: "approved_work_time",
    effect: "paid_partial_leave",
    attendanceMode: "ignore_attendance",
    payMode: "regular_only",
    reviewMode: "deduction",
  },
  {
    category: "planning",
    value: "overtime_authorization",
    label: "Autorización de tiempo adicional",
    description: "Solicita autorizar un rango adicional trabajado; al aprobarse se clasifica como suplementario o extraordinario según el día.",
    type: "overtime_authorization",
    scope: "partial_day",
    resolution: "approved_work_time",
    effect: "authorized_overtime",
    attendanceMode: "use_punches",
    payMode: "regular_and_extra",
    reviewMode: "approval",
  },
  {
    category: "planning",
    value: "temporary_schedule_change",
    label: "Cambio temporal de horario",
    description: "Cambia el horario esperado por un periodo definido, sin tocar el cargo ni el grupo.",
    type: "schedule_change",
    scope: "full_day",
    resolution: "approved_work_time",
    effect: "planning_change",
    attendanceMode: "use_punches",
    payMode: "no_pay_change",
  },
  {
    category: "planning",
    value: "external_work",
    label: "Trabajo externo",
    description: "Reconoce trabajo realizado fuera de la empresa cuando no aplica la picada normal.",
    type: "outside_work",
    scope: "full_day",
    resolution: "approved_work_time",
    effect: "external_work",
    attendanceMode: "use_authorized_schedule",
    payMode: "regular_only",
  },
  {
    category: "execution",
    value: "missed_punch",
    label: "Justificar marcación omitida",
    description: "Reconoce el horario autorizado cuando la persona trabajó pero no pudo marcar.",
    type: "missing_punch",
    scope: "missing_punch",
    resolution: "approved_work_time",
    effect: "external_work",
    attendanceMode: "use_authorized_schedule",
    payMode: "regular_only",
  },
];
const EXCEPTIONS_PAGE_SIZE = 10;
const FLOW_GROUPS = [
  { value: "planning", label: "Planificacion", description: "Permisos y autorizaciones conocidas antes o durante la jornada." },
  { value: "execution", label: "Ejecucion", description: "Novedades inesperadas detectadas al revisar la asistencia real." },
];
const FLOW_OPTIONS = EXCEPTION_FLOWS.map((flow) => ({
  value: flow.value,
  label: flow.label,
  searchText: FLOW_GROUPS.find((group) => group.value === flow.category)?.label || "",
}));
const FLOW_VALUES = new Set(EXCEPTION_FLOWS.map((flow) => flow.value));
const WEEKDAY_OPTIONS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mie" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Dom" },
];
const DEFAULT_APPLICABLE_WEEKDAYS = [1, 2, 3, 4, 5];

const EMPTY_FORM = {
  id: "",
  employeeId: "",
  flowType: "absence_report",
  type: "absence",
  scope: "full_day",
  dateKey: format(new Date(), "yyyy-MM-dd"),
  endDateKey: "",
  startTime: "",
  endTime: "",
  plannedStartTime: "",
  plannedEndTime: "",
  plannedDayType: "workday",
  isExtraDay: false,
  plannedLunchStartTime: "",
  plannedLunchEndTime: "",
  plannedLunchDurationMinutes: 0,
  applicableWeekdays: DEFAULT_APPLICABLE_WEEKDAYS,
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
  if (flowType === "full_day_permission") return EXCEPTION_FLOWS.find((flow) => flow.value === "absence_report");

  return EXCEPTION_FLOWS.find((flow) => flow.value === flowType) || DEFAULT_FLOW;
}

function inferFlowType(exception) {
  const effect = String(exception?.effect || "");
  const type = String(exception?.type || "");
  const resolution = String(exception?.resolution || "");
  const scope = String(exception?.scope || "");

  if (type === "overtime_authorization" || effect === "authorized_overtime") return "overtime_authorization";
  if (effect === "manual_punch" || type === "missing_punch" || type === "outside_work_punch" || scope === "missing_punch") return "missed_punch";
  if (effect === "planning_change" || type === "schedule_change" || resolution === "reschedule") return "temporary_schedule_change";
  if (effect === "external_work" || type === "outside_work") return "external_work";

  if (type === "permission" && scope === "partial_day") return "hourly_permission";

  return "absence_report";
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
    plannedDayType: exception.plannedDayType === "off_day" ? "off_day" : "workday",
    isExtraDay: Boolean(exception.isExtraDay),
    plannedLunchStartTime: exception.plannedLunchStartTime || "",
    plannedLunchEndTime: exception.plannedLunchEndTime || "",
    plannedLunchDurationMinutes: Number(exception.plannedLunchDurationMinutes) || 0,
    applicableWeekdays: Array.isArray(exception.applicableWeekdays) && exception.applicableWeekdays.length
      ? exception.applicableWeekdays
      : DEFAULT_APPLICABLE_WEEKDAYS,
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

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatTimeLabel(value) {
  return String(value || "").replace(":", "H");
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

  if (flow.value === "external_work") {
    return {
      type: flow.type,
      scope: form.endDateKey ? "date_range" : flow.scope,
      effect: flow.effect,
      attendanceMode: flow.attendanceMode,
      payMode: flow.payMode,
    };
  }

  if (flow.value === "temporary_schedule_change") {
    return {
      type: flow.type,
      scope: form.endDateKey ? "date_range" : flow.scope,
      effect: flow.effect,
      attendanceMode: flow.attendanceMode,
      payMode: flow.payMode,
    };
  }

  if (flow.value === "absence_report" || flow.value === "hourly_permission") {
    return {
      type: flow.type,
      scope: flow.scope,
      effect: flow.effect,
      attendanceMode: flow.attendanceMode,
      payMode: flow.payMode,
    };
  }

  if (flow.value === "overtime_authorization") {
    return {
      type: flow.type,
      scope: flow.scope,
      effect: flow.effect,
      attendanceMode: flow.attendanceMode,
      payMode: flow.payMode,
    };
  }

  if (flow.value === "missed_punch") {
    return {
      type: flow.type,
      scope: flow.scope,
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
  onlyPending = false,
  showCreateButton = true,
  showBulkDeleteButton = true,
  listTitle = "Justificaciones registradas",
  emptyTitle = "No hay justificaciones registradas para este mes.",
  emptyFilteredTitle = "No hay justificaciones para ese filtro.",
  emptyDescription = "Registra permisos, salidas tempranas, citas medicas o faltas justificadas cuando ocurran.",
  emptyFilteredDescription = "Prueba con otro nombre, cedula, sucursal, area o rol.",
  initialDraft = null,
  compactPendingView = false,
  compactListView = false,
}) {
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [employees, setEmployees] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [canApproveExceptions, setCanApproveExceptions] = useState(false);
  const [canCreateExceptions, setCanCreateExceptions] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [exceptionSearch, setExceptionSearch] = useState("");
  const [exceptionEmployeeId, setExceptionEmployeeId] = useState("");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [reviewException, setReviewException] = useState(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [exceptionToDelete, setExceptionToDelete] = useState(null);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const initialDraftAppliedRef = useRef("");
  const monthKey = format(monthDate, "yyyy-MM");
  const monthLabel = format(monthDate, "MMMM yyyy", { locale: es });
  const canResolveExceptions = canApproveExceptions;
  const isCompactList = compactListView || compactPendingView;
  const deleteActionMessage = `Deseas eliminar la justificacion pendiente de ${exceptionToDelete?.employeeName || ""}?`;

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.isActive !== false),
    [employees],
  );
  const employeeFilterOptions = useMemo(
    () => activeEmployees.map((employee) => ({
      value: employee.id,
      label: employee.fullName,
      searchText: [
        employee.dni,
        employee.branchName || employee.branch,
        employee.areaName,
        employee.roleName,
      ].filter(Boolean).join(" "),
    })),
    [activeEmployees],
  );
  const selectedEmployee = useMemo(
    () => activeEmployees.find((employee) => employee.id === form.employeeId),
    [activeEmployees, form.employeeId],
  );
  const scopedExceptions = useMemo(
    () => (onlyPending ? exceptions.filter((exception) => exception.resolution === "pending") : exceptions),
    [exceptions, onlyPending],
  );
  const noDiscountCount = scopedExceptions.filter((exception) =>
    exception.resolution === "approved_work_time"
    && getFlowDefinition(inferFlowType(exception)).reviewMode === "deduction",
  ).length;
  const approvedCount = scopedExceptions.filter((exception) =>
    !["pending", "discount_day", "no_action"].includes(exception.resolution)
    && getFlowDefinition(inferFlowType(exception)).reviewMode !== "deduction",
  ).length;
  const discountCount = scopedExceptions.filter((exception) => exception.resolution === "discount_day").length;
  const rejectedCount = scopedExceptions.filter((exception) => exception.resolution === "no_action").length;
  const pendingCount = scopedExceptions.filter((exception) => exception.resolution === "pending").length;
  const filteredExceptions = useMemo(() => {
    if (exceptionEmployeeId) {
      return scopedExceptions.filter((exception) => exception.employeeId === exceptionEmployeeId);
    }

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
  }, [exceptionEmployeeId, exceptionSearch, scopedExceptions]);
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
  const deletablePendingExceptions = useMemo(
    () => orderedExceptions.filter((exception) =>
      exception.canDelete === true
      && exception.resolution === "pending"
      && exception.status !== "void"),
    [orderedExceptions],
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
  const createsManualPunch = selectedFlow.effect === "manual_punch";
  const needsTimeRange = ["hourly_permission", "overtime_authorization"].includes(selectedFlow.value);
  const needsTemporarySchedule = selectedFlow.effect === "planning_change";
  const canUseDateRange = selectedFlow.category === "planning" && !needsTimeRange;
  const isEditingException = Boolean(form.id);
  const canSave = Boolean(
    form.employeeId
    && selectedFlow.value
    && form.dateKey
    && form.notes.trim()
    && (!createsManualPunch || form.manualPunchTime)
    && (!needsTimeRange || (form.startTime && form.endTime))
    && (!needsTemporarySchedule || (
      (form.plannedDayType === "off_day" || (form.plannedStartTime && form.plannedEndTime))
      && Array.isArray(form.applicableWeekdays)
      && form.applicableWeekdays.length
    )),
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
    setCanCreateExceptions(Boolean(payload.options?.canCreateExceptions));
  }, [monthKey]);

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      setIsLoading(true);

      try {
        const [employeesResponse, exceptionsResponse] = await Promise.all([
          fetch("/api/company/employees?scope=planning"),
          fetch(`/api/planner/planning/exceptions?month=${monthKey}`),
        ]);
        const [employeesPayload, exceptionsPayload] = await Promise.all([
          employeesResponse.json(),
          exceptionsResponse.json(),
        ]);

        if (!employeesResponse.ok) {
          throw new Error(employeesPayload.error || "No se pudieron cargar los empleados.");
        }

        if (!exceptionsResponse.ok) {
          throw new Error(exceptionsPayload.error || "No se pudieron cargar las excepciones.");
        }

        if (!isCancelled) {
          setEmployees(employeesPayload.employees || []);
          setExceptions(exceptionsPayload.exceptions || []);
          setCanApproveExceptions(Boolean(exceptionsPayload.options?.canApproveExceptions));
          setCanCreateExceptions(Boolean(exceptionsPayload.options?.canCreateExceptions));
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

  useEffect(() => {
    if (!initialDraft) return;
    if (initialDraft.employeeId && !activeEmployees.length) return;

    const draftKey = JSON.stringify(initialDraft);
    if (initialDraftAppliedRef.current === draftKey) return;

    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(initialDraft.dateKey || "")
      ? initialDraft.dateKey
      : EMPTY_FORM.dateKey;
    const month = /^\d{4}-\d{2}$/.test(initialDraft.month || "")
      ? initialDraft.month
      : dateKey.slice(0, 7);
    const flowType = FLOW_VALUES.has(initialDraft.flowType)
      ? initialDraft.flowType
      : initialDraft.flowType === "full_day_permission"
        ? "absence_report"
        : "absence_report";
    const employee = activeEmployees.find((entry) => entry.id === initialDraft.employeeId);

    setMonthDate(new Date(`${month}-01T12:00:00.000Z`));
    setForm({
      ...EMPTY_FORM,
      employeeId: initialDraft.employeeId || "",
      flowType,
      type: getFlowDefinition(flowType).type,
      scope: getFlowDefinition(flowType).scope,
      effect: getFlowDefinition(flowType).effect,
      attendanceMode: getFlowDefinition(flowType).attendanceMode,
      payMode: getFlowDefinition(flowType).payMode,
      dateKey,
      notes: initialDraft.notes || "",
      resolution: "pending",
      authorizedBy: "",
    });
    setEmployeeQuery(employee?.fullName || "");
    setIsEditorOpen(true);
    initialDraftAppliedRef.current = draftKey;
  }, [activeEmployees, initialDraft]);

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

  function selectExceptionEmployee(employee) {
    setExceptionEmployeeId(employee?.id || "");
    setExceptionSearch(employee?.fullName || "");
    setCurrentPage(1);
  }

  function clearExceptionEmployee() {
    setExceptionEmployeeId("");
    setCurrentPage(1);
  }

  function updateEmployee(value) {
    setForm((current) => ({
      ...current,
      employeeId: value,
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

  function updateFlowType(value) {
    const flow = getFlowDefinition(value);

    setForm((current) => ({
      ...current,
      flowType: flow.value,
      type: flow.type,
      scope: flow.scope,
      effect: flow.effect,
      attendanceMode: flow.attendanceMode,
      payMode: flow.payMode,
      resolution: current.id && canResolveExceptions ? flow.resolution : "pending",
      startTime: "",
      endTime: "",
      plannedStartTime: flow.effect === "planning_change" ? current.plannedStartTime : "",
      plannedEndTime: flow.effect === "planning_change" ? current.plannedEndTime : "",
      plannedDayType: flow.effect === "planning_change" ? current.plannedDayType || "workday" : "workday",
      plannedLunchStartTime: flow.effect === "planning_change" ? current.plannedLunchStartTime : "",
      plannedLunchEndTime: flow.effect === "planning_change" ? current.plannedLunchEndTime : "",
      plannedLunchDurationMinutes: flow.effect === "planning_change" ? current.plannedLunchDurationMinutes : 0,
      applicableWeekdays: flow.effect === "planning_change"
        ? current.applicableWeekdays || DEFAULT_APPLICABLE_WEEKDAYS
        : DEFAULT_APPLICABLE_WEEKDAYS,
      manualPunchTime: flow.effect === "manual_punch" ? current.manualPunchTime : "",
      endDateKey: flow.category === "planning" ? current.endDateKey : "",
      countsAsWorkedTime: flow.value === "hourly_permission",
      allowSupplementaryTime: flow.value === "overtime_authorization",
      isExtraDay: false,
    }));
  }

  function describeExceptionTime(exception) {
    const range = exception.endDateKey ? `${exception.dateKey} hasta ${exception.endDateKey}` : exception.dateKey;

    if (exception.effect === "manual_punch" && exception.manualPunchTime) {
      return `${range} · picada ${formatTimeLabel(exception.manualPunchTime)}`;
    }

    return range;
  }

  function getStatusPillClass(exception) {
    if (exception.resolution === "pending") return styles.pendingPill;
    if (exception.resolution === "no_action") return styles.rejectedPill;

    return styles.resolvedPill;
  }

  function openReviewModal(exception) {
    setReviewException(exception);
    setReviewNotes(exception.resolutionNotes || "");
  }

  const closeReviewModal = useCallback(() => {
    if (isPending) return;
    setReviewException(null);
    setReviewNotes("");
  }, [isPending]);

  function openCreateEditor() {
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
    setEmployeeQuery(employee?.fullName || exception.employeeName || "");
    setIsEditorOpen(true);
  }

  function buildReviewPayload(exception, resolution) {
    const flow = getFlowDefinition(inferFlowType(exception));
    const isRejected = resolution === "no_action";
    const isDiscounted = resolution === "discount_day";
    const isDeductionDecision = flow.reviewMode === "deduction";
    const isAuthorizedOvertime = flow.value === "overtime_authorization" && resolution === "approved_work_time";

    return {
      id: exception.id,
      employeeId: exception.employeeId,
      type: isRejected ? exception.type : exception.type || flow.type,
      scope: isRejected
        ? exception.scope
        : exception.scope || (exception.endDateKey && flow.category === "planning" ? "date_range" : flow.scope),
      dateKey: exception.dateKey,
      endDateKey: isRejected ? exception.endDateKey : exception.endDateKey || "",
      startTime: isRejected ? exception.startTime : exception.startTime || "",
      endTime: isRejected ? exception.endTime : exception.endTime || "",
      manualPunchTime: isRejected ? exception.manualPunchTime : exception.manualPunchTime || "",
      plannedStartTime: isRejected ? exception.plannedStartTime : exception.plannedStartTime || "",
      plannedEndTime: isRejected ? exception.plannedEndTime : exception.plannedEndTime || "",
      plannedDayType: exception.plannedDayType === "off_day" ? "off_day" : "workday",
      isExtraDay: Boolean(exception.isExtraDay),
      plannedLunchStartTime: isRejected ? exception.plannedLunchStartTime : exception.plannedLunchStartTime || "",
      plannedLunchEndTime: isRejected ? exception.plannedLunchEndTime : exception.plannedLunchEndTime || "",
      plannedLunchDurationMinutes: isRejected ? exception.plannedLunchDurationMinutes : Number(exception.plannedLunchDurationMinutes) || 0,
      applicableWeekdays: Array.isArray(exception.applicableWeekdays) && exception.applicableWeekdays.length
        ? exception.applicableWeekdays
        : DEFAULT_APPLICABLE_WEEKDAYS,
      effect: isRejected
        ? "alert_review"
        : isDiscounted
          ? "unpaid_absence"
          : flow.effect || exception.effect,
      attendanceMode: isRejected
        ? "none"
        : isDiscounted
          ? "ignore_attendance"
          : flow.attendanceMode || exception.attendanceMode,
      payMode: isRejected
        ? "no_pay_change"
        : isDiscounted
          ? "discount"
          : flow.payMode || exception.payMode,
      countsAsWorkedTime: isDeductionDecision && !isDiscounted,
      allowSupplementaryTime: isAuthorizedOvertime,
      resolution,
      resolutionNotes: reviewNotes.trim(),
      notes: exception.notes || "",
    };
  }

  function reviewCurrentException(resolution) {
    if (!reviewException || !canResolveExceptions) return;

    startTransition(async () => {
      try {
        const response = await fetch(`/api/planner/planning/exceptions/${reviewException.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildReviewPayload(reviewException, resolution)),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo actualizar la aprobacion.");
        }

        await loadExceptions();
        setReviewException(null);
        setReviewNotes("");
        const flow = getFlowDefinition(inferFlowType(reviewException));
        const message = flow.reviewMode === "deduction"
          ? resolution === "discount_day"
            ? "Novedad resuelta con descuento de horas."
            : "Novedad resuelta sin descuento de horas."
          : flow.value === "overtime_authorization" && resolution === "no_action"
            ? "Autorización rechazada."
            : flow.value === "overtime_authorization"
              ? "Autorización aprobada."
              : resolution === "no_action"
                ? "Justificación rechazada."
                : "Justificación aprobada.";

        showNotice("success", message);
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  const closeEditor = useCallback(() => {
    setForm(EMPTY_FORM);
    setEmployeeQuery("");
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
    const resolution = form.id ? form.resolution : "pending";
    const requestBody = {
      ...form,
      ...resolutionEffect,
      resolution,
      authorizedBy: "",
      startTime: needsTimeRange ? form.startTime : "",
      endTime: needsTimeRange ? form.endTime : "",
      plannedDayType: needsTemporarySchedule && form.plannedDayType === "off_day" ? "off_day" : "workday",
      plannedStartTime: needsTemporarySchedule && form.plannedDayType !== "off_day" ? form.plannedStartTime : "",
      plannedEndTime: needsTemporarySchedule && form.plannedDayType !== "off_day" ? form.plannedEndTime : "",
      plannedLunchStartTime: needsTemporarySchedule && form.plannedDayType !== "off_day" ? form.plannedLunchStartTime : "",
      plannedLunchEndTime: needsTemporarySchedule && form.plannedDayType !== "off_day" ? form.plannedLunchEndTime : "",
      plannedLunchDurationMinutes: needsTemporarySchedule && form.plannedDayType !== "off_day" ? form.plannedLunchDurationMinutes : 0,
      applicableWeekdays: needsTemporarySchedule ? form.applicableWeekdays : undefined,
      manualPunchTime: createsManualPunch ? form.manualPunchTime : "",
      destination: "",
      countsAsWorkedTime:
        resolution === "approved_work_time"
        && selectedFlow.value === "hourly_permission",
      allowSupplementaryTime:
        resolution === "approved_work_time"
        && selectedFlow.value === "overtime_authorization",
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

  function toggleApplicableWeekday(day) {
    setForm((current) => {
      const currentDays = Array.isArray(current.applicableWeekdays) && current.applicableWeekdays.length
        ? current.applicableWeekdays
        : DEFAULT_APPLICABLE_WEEKDAYS;
      const nextDays = currentDays.includes(day)
        ? currentDays.filter((entry) => entry !== day)
        : [...currentDays, day];

      return {
        ...current,
        applicableWeekdays: nextDays.sort((left, right) => left - right),
      };
    });
  }

  function confirmDeleteException() {
    if (!exceptionToDelete) {
      return;
    }

    if (exceptionToDelete.resolution !== "pending" || exceptionToDelete.status === "void") {
      setExceptionToDelete(null);
      showNotice("error", "Las excepciones aprobadas o resueltas no se pueden eliminar.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/planner/planning/exceptions/${exceptionToDelete.id}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo procesar la justificacion.");
        }

        setExceptionToDelete(null);
        await loadExceptions();
        showNotice("success", payload.message || "Justificacion procesada correctamente.");
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  function confirmBulkDeleteExceptions() {
    if (!deletablePendingExceptions.length) {
      return;
    }

    startTransition(async () => {
      try {
        for (const exception of deletablePendingExceptions) {
          const response = await fetch(`/api/planner/planning/exceptions/${exception.id}`, {
            method: "DELETE",
          });
          const payload = await response.json();

          if (!response.ok) {
            throw new Error(payload.error || "No se pudo procesar una justificacion filtrada.");
          }
        }

        setIsBulkDeleteOpen(false);
        await loadExceptions();
        showNotice("success", "Excepciones pendientes eliminadas correctamente.");
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
        title="Eliminar justificacion pendiente"
        message={deleteActionMessage}
        confirmLabel={isPending ? "Procesando..." : "Eliminar"}
        isPending={isPending}
        onCancel={() => setExceptionToDelete(null)}
        onConfirm={confirmDeleteException}
      />
      <ConfirmDialog
        isOpen={isBulkDeleteOpen}
        title="Eliminar excepciones pendientes"
        message={`Se eliminaran ${deletablePendingExceptions.length} excepciones pendientes del filtro actual.`}
        confirmLabel={isPending ? "Procesando..." : "Eliminar pendientes"}
        isPending={isPending}
        onCancel={() => setIsBulkDeleteOpen(false)}
        onConfirm={confirmBulkDeleteExceptions}
      />
      <FloatingModal
        isOpen={Boolean(reviewException)}
        eyebrow="Revision"
        title={reviewException?.employeeName || "Justificacion"}
        isPending={isPending}
        onClose={closeReviewModal}
      >
        {reviewException ? (
          <div className={styles.reviewStack}>
            <div className={styles.reviewHeader}>
              <span className={getStatusPillClass(reviewException)}>{reviewException.resolutionLabel}</span>
              <strong>{reviewException.typeLabel}</strong>
              <small>{describeExceptionTime(reviewException)}</small>
            </div>

            <dl className={styles.reviewGrid}>
              <div>
                <dt>Sucursal</dt>
                <dd>{reviewException.branchName || "Sin sucursal"}</dd>
              </div>
              <div>
                <dt>Area</dt>
                <dd>{reviewException.areaName || "Sin area"}</dd>
              </div>
              <div>
                <dt>Rol</dt>
                <dd>{reviewException.roleName || "Sin rol"}</dd>
              </div>
              <div>
                <dt>Registrado por</dt>
                <dd>{reviewException.registeredBy || "Sin registro"}</dd>
              </div>
              {reviewException.startTime || reviewException.endTime ? (
                <div>
                  <dt>Rango</dt>
                  <dd>{[reviewException.startTime, reviewException.endTime].filter(Boolean).map(formatTimeLabel).join(" - ")}</dd>
                </div>
              ) : null}
              {reviewException.manualPunchTime ? (
                <div>
                  <dt>Picada</dt>
                  <dd>{formatTimeLabel(reviewException.manualPunchTime)}</dd>
                </div>
              ) : null}
              {reviewException.plannedDayType === "off_day" ? (
                <div>
                  <dt>Planificación temporal</dt>
                  <dd>Descanso</dd>
                </div>
              ) : reviewException.plannedStartTime || reviewException.plannedEndTime ? (
                <div>
                  <dt>Horario temporal</dt>
                  <dd>{[reviewException.plannedStartTime, reviewException.plannedEndTime].filter(Boolean).map(formatTimeLabel).join(" - ")}</dd>
                </div>
              ) : null}
            </dl>

            <div className={styles.reviewNotes}>
              <span>Descripcion</span>
              <p>{reviewException.notes || "Sin descripcion."}</p>
            </div>

            {canResolveExceptions && reviewException.resolution === "pending" ? (
              <label className={styles.field}>
                <span>Nota de revision</span>
                <textarea
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                  rows={3}
                  placeholder="Opcional"
                  disabled={isPending}
                />
              </label>
            ) : reviewException.resolutionNotes ? (
              <div className={styles.reviewNotes}>
                <span>Nota de revision</span>
                <p>{reviewException.resolutionNotes}</p>
              </div>
            ) : null}

            {canResolveExceptions && reviewException.resolution === "pending" ? (
              getFlowDefinition(inferFlowType(reviewException)).reviewMode === "deduction" ? (
                <div className={styles.reviewActions}>
                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={() => reviewCurrentException("discount_day")}
                    disabled={isPending}
                  >
                    Resolver con descuento
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => reviewCurrentException("approved_work_time")}
                    disabled={isPending}
                  >
                    Resolver sin descuento
                  </button>
                </div>
              ) : (
                <div className={styles.reviewActions}>
                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={() => reviewCurrentException("no_action")}
                    disabled={isPending}
                  >
                    Rechazar
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => reviewCurrentException(getFlowDefinition(inferFlowType(reviewException)).resolution)}
                    disabled={isPending}
                  >
                    Aprobar
                  </button>
                </div>
              )
            ) : null}
          </div>
        ) : null}
      </FloatingModal>

      {!isCompactList ? (
        <section className={styles.panel}>
          <div className={styles.toolbar}>
            <div>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h2 className={styles.title}>{title}</h2>
              {description ? <p className={styles.description}>{description}</p> : null}
            </div>

            <div className={styles.actionsGroup}>
              {showCreateButton && canCreateExceptions ? (
                <button type="button" className={styles.primaryButton} onClick={openCreateEditor}>
                  <Plus size={16} />
                  Nueva justificacion
                </button>
              ) : null}
            </div>
          </div>

          <div className={styles.filtersBar}>
            <div className={styles.monthFilter}>
              <span className={styles.filterLabel}>Mes</span>
              <div className={styles.monthSlider}>
                <button type="button" onClick={() => moveMonth((current) => subMonths(current, 1))} aria-label={`Mes anterior desde ${monthLabel}`}>
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <output aria-live="polite" aria-label={`Mes seleccionado: ${monthLabel}`}>
                  {monthLabel}
                </output>
                <button type="button" onClick={() => moveMonth((current) => addMonths(current, 1))} aria-label={`Mes siguiente desde ${monthLabel}`}>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className={`${styles.employeeFilter} ${styles.employeeFilterLinear}`}>
              <EmployeeAutocomplete
                employees={activeEmployees}
                value={exceptionEmployeeId}
                query={exceptionSearch}
                onQueryChange={updateExceptionSearch}
                onSelect={selectExceptionEmployee}
                onClearSelection={clearExceptionEmployee}
                label="Empleado"
                placeholder="Seleccionar empleado"
                disabled={isLoading}
              />
            </div>
          </div>

          {isLoading ? (
            <div className={styles.summaryGrid} aria-hidden="true">
              {Array.from({ length: 6 }, (_, index) => (
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
                <strong>{noDiscountCount}</strong>
              </div>
              <div className={styles.metric}>
                <span>Aprobadas</span>
                <strong>{approvedCount}</strong>
              </div>
              <div className={styles.metric}>
                <span>Autorizaciones rechazadas</span>
                <strong>{rejectedCount}</strong>
              </div>
              <div className={styles.metric}>
                <span>Con descuento</span>
                <strong>{discountCount}</strong>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <section className={styles.panel}>
        {isCompactList ? (
          <div className={styles.compactFiltersToolbar}>
            <div className={`${styles.filtersBar} ${styles.compactFiltersBar}`}>
              <div className={styles.monthFilter}>
                <span className={styles.filterLabel}>Mes</span>
                <div className={styles.monthSlider}>
                  <button type="button" onClick={() => moveMonth((current) => subMonths(current, 1))} aria-label={`Mes anterior desde ${monthLabel}`}>
                    <ChevronLeft size={18} aria-hidden="true" />
                  </button>
                  <output aria-live="polite" aria-label={`Mes seleccionado: ${monthLabel}`}>
                    {monthLabel}
                  </output>
                  <button type="button" onClick={() => moveMonth((current) => addMonths(current, 1))} aria-label={`Mes siguiente desde ${monthLabel}`}>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {compactPendingView ? (
                <AutocompleteSelect
                  className={styles.pendingEmployeeSelect}
                  controlClassName={styles.pendingEmployeeSelectControl}
                  options={employeeFilterOptions}
                  value={exceptionEmployeeId}
                  onChange={(employeeId) => {
                    const employee = activeEmployees.find((entry) => entry.id === employeeId);

                    if (employee) {
                      selectExceptionEmployee(employee);
                      return;
                    }

                    updateExceptionSearch("");
                    clearExceptionEmployee();
                  }}
                  label="Empleado"
                  placeholder="Seleccionar empleado"
                  searchPlaceholder="Buscar empleado"
                  emptyText="No encontramos empleados relacionados."
                  disabled={isLoading}
                />
              ) : (
                <div className={`${styles.employeeFilter} ${styles.employeeFilterLinear}`}>
                  <EmployeeAutocomplete
                    employees={activeEmployees}
                    value={exceptionEmployeeId}
                    query={exceptionSearch}
                    onQueryChange={updateExceptionSearch}
                    onSelect={selectExceptionEmployee}
                    onClearSelection={clearExceptionEmployee}
                    label="Empleado"
                    placeholder="Seleccionar empleado"
                    disabled={isLoading}
                  />
                </div>
              )}
            </div>
            <div className={styles.compactFilterActions}>
              {showCreateButton && canCreateExceptions ? (
                <button type="button" className={styles.primaryButton} onClick={openCreateEditor}>
                  <Plus size={16} />
                  Nueva justificacion
                </button>
              ) : null}
              {showBulkDeleteButton && canResolveExceptions && (exceptionEmployeeId || exceptionSearch.trim()) && deletablePendingExceptions.length ? (
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => setIsBulkDeleteOpen(true)}
                  disabled={isPending}
                >
                  Eliminar pendientes
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className={styles.listHeader}>
            <div>
              <h3>{listTitle}</h3>
              <p>
                {isLoading
                  ? "Cargando..."
                  : exceptionEmployeeId || exceptionSearch.trim()
                    ? `${orderedExceptions.length} de ${scopedExceptions.length} registros · Periodo ${monthLabel}`
                    : `Periodo ${monthLabel} · mas recientes primero`}
              </p>
            </div>
            {showBulkDeleteButton && canResolveExceptions && (exceptionEmployeeId || exceptionSearch.trim()) && deletablePendingExceptions.length ? (
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => setIsBulkDeleteOpen(true)}
                disabled={isPending}
              >
                Eliminar pendientes
              </button>
            ) : null}
          </div>
        )}

        {!isLoading && (exceptionEmployeeId || exceptionSearch.trim()) && !orderedExceptions.length && scopedExceptions.length ? (
          <div className={styles.filterNotice}>
            <span>No hay registros para ese empleado en {monthLabel}.</span>
            <button type="button" onClick={() => {
              updateExceptionSearch("");
              clearExceptionEmployee();
            }}>Limpiar filtro</button>
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
                  <th>Registrado por</th>
                  <th>Fecha</th>
                  <th className={styles.optionsColumn}>Opciones</th>
                </tr>
              </thead>
              <tbody>
              {paginatedExceptions.map((exception) => (
                  <tr
                    key={exception.id}
                    className={styles.clickableRow}
                    onClick={() => openReviewModal(exception)}
                  >
                    <td>
                      <strong>{exception.employeeName}</strong>
                    </td>
                    <td>
                      <span>{exception.registeredBy || "Sin registro"}</span>
                    </td>
                    <td>
                      <span>{describeExceptionTime(exception)}</span>
                    </td>
                    <td className={styles.optionsColumn}>
                      {exception.canDelete === true
                        && exception.resolution === "pending"
                        && exception.status !== "void" ? (
                        <div className={styles.rowActions}>
                          <button type="button" onClick={(event) => {
                            event.stopPropagation();
                            setExceptionToDelete(exception);
                          }} aria-label="Eliminar justificacion pendiente">
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

          <AutocompleteSelect
            className={styles.adjustmentTypeSelect}
            label="Tipo de ajuste"
            options={FLOW_OPTIONS}
            value={form.flowType}
            placeholder="Seleccionar tipo"
            searchPlaceholder="Buscar tipo"
            emptyText="Sin tipos"
            onChange={updateFlowType}
          />

          <div className={styles.presetPanel}>
            <span>Cómo se procesa</span>
            <p>{selectedFlow.description}</p>
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

          {createsManualPunch ? (
            <label className={styles.field}>
              <span>Hora a registrar</span>
              <TimeInput24
                value={form.manualPunchTime}
                onChange={(event) => updateForm("manualPunchTime", event.target.value)}
                separator="H"
              />
            </label>
          ) : null}

          {needsTimeRange ? (
            <div className={styles.twoColumnGrid}>
              <label className={styles.field}>
                <span>{selectedFlow.value === "overtime_authorization" ? "Inicio autorizado" : "Inicio del permiso"}</span>
                <TimeInput24 separator="H" value={form.startTime} onChange={(event) => updateForm("startTime", event.target.value)} />
              </label>
              <label className={styles.field}>
                <span>{selectedFlow.value === "overtime_authorization" ? "Fin autorizado" : "Fin del permiso"}</span>
                <TimeInput24 separator="H" value={form.endTime} onChange={(event) => updateForm("endTime", event.target.value)} />
              </label>
            </div>
          ) : null}

          {needsTemporarySchedule ? (
            <div className={styles.presetPanel}>
              <span>Planificación temporal</span>
              <label className={styles.field}>
                <span>Tipo de día</span>
                <select value={form.plannedDayType || "workday"} onChange={(event) => updateForm("plannedDayType", event.target.value)}>
                  <option value="workday">Horario laboral</option>
                  <option value="off_day">Descanso</option>
                </select>
              </label>
              {form.plannedDayType !== "off_day" ? (
                <>
                  <div className={styles.twoColumnGrid}>
                    <label className={styles.field}>
                      <span>Entrada</span>
                      <TimeInput24 separator="H" value={form.plannedStartTime} onChange={(event) => updateForm("plannedStartTime", event.target.value)} />
                    </label>
                    <label className={styles.field}>
                      <span>Salida</span>
                      <TimeInput24 separator="H" value={form.plannedEndTime} onChange={(event) => updateForm("plannedEndTime", event.target.value)} />
                    </label>
                  </div>
                  <div className={styles.twoColumnGrid}>
                    <label className={styles.field}>
                      <span>Inicio almuerzo</span>
                      <TimeInput24 separator="H" value={form.plannedLunchStartTime} onChange={(event) => updateForm("plannedLunchStartTime", event.target.value)} />
                    </label>
                    <label className={styles.field}>
                      <span>Fin almuerzo</span>
                      <TimeInput24 separator="H" value={form.plannedLunchEndTime} onChange={(event) => updateForm("plannedLunchEndTime", event.target.value)} />
                    </label>
                  </div>
                </>
              ) : null}
              <div className={styles.weekdayPicker}>
                {WEEKDAY_OPTIONS.map((day) => {
                  const isSelected = Array.isArray(form.applicableWeekdays) && form.applicableWeekdays.includes(day.value);

                  return (
                    <button
                      key={day.value}
                      type="button"
                      className={isSelected ? styles.weekdayButtonActive : styles.weekdayButton}
                      onClick={() => toggleApplicableWeekday(day.value)}
                      aria-pressed={isSelected}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <label className={styles.field}>
            <span>Descripcion</span>
            <textarea
              value={form.notes}
              onChange={(event) => updateForm("notes", event.target.value)}
              placeholder="Ej. permiso de 10:00 a 12:00, trabajo externo autorizado, salida no marcada por cierre de tarea fuera del local."
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
              {isPending ? "Guardando..." : isEditingException ? "Guardar cambios" : "Guardar justificacion"}
            </button>
          </div>
        </form>
      </CatalogDrawer>
    </div>
  );
}
