"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  X,
} from "lucide-react";

import useClientReady from "@/hooks/useClientReady";
import { isEmployeeActiveOnDate } from "@/modules/company/submodules/people/lib/employees";
import styles from "@/modules/planner/styles/components/attendance/AttendancePunchReview.module.scss";

function toDateInput(value) {
  const parsed = value ? new Date(value) : new Date();

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

function todayRange() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);

  return {
    from: toDateInput(firstDay),
    to: toDateInput(now),
  };
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePageSize(value) {
  const parsed = parsePositiveInteger(value, 50);

  if (![25, 50, 100].includes(parsed)) {
    return 50;
  }

  return parsed;
}

function readInitialFilters() {
  const fallbackRange = todayRange();

  if (typeof window === "undefined") {
    return {
      filters: fallbackRange,
      branchCode: "",
      employeeId: "",
      page: 1,
      pageSize: 50,
    };
  }

  const params = new URLSearchParams(window.location.search);

  return {
    filters: {
      from: params.get("from") || fallbackRange.from,
      to: params.get("to") || fallbackRange.to,
    },
    branchCode: (params.get("branchCode") || "").toUpperCase(),
    employeeId: params.get("employeeId") || "",
    page: parsePositiveInteger(params.get("page"), 1),
    pageSize: parsePageSize(params.get("pageSize")),
  };
}

const DEFAULT_PAGINATION = {
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
  hasPreviousPage: false,
  hasNextPage: false,
};

export default function AttendancePunchReview() {
  const isClientReady = useClientReady();
  const [initialFilters] = useState(() => readInitialFilters());
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [punches, setPunches] = useState([]);
  const [filters, setFilters] = useState(() => initialFilters.filters);
  const [branchCode, setBranchCode] = useState(() => initialFilters.branchCode);
  const [employeeId, setEmployeeId] = useState(() => initialFilters.employeeId);
  const [page, setPage] = useState(() => initialFilters.page);
  const [pageSize, setPageSize] = useState(() => initialFilters.pageSize);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [isPunchesLoading, setIsPunchesLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);
  const punchesRequestRef = useRef(0);

  const filteredEmployees = useMemo(
    () =>
      employees.filter((employee) => {
        if (!isEmployeeActiveOnDate(employee, filters.from)) return false;
        if (branchCode && employee.branchCode !== branchCode) return false;
        return true;
      }),
    [branchCode, employees, filters.from],
  );
  const isLoading = isCatalogLoading || isPunchesLoading;

  const showToast = useCallback((type, message) => {
    setToast({ type, message });

    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 5000);
  }, []);

  const syncUrlParams = useCallback(({
    nextFilters = filters,
    nextBranchCode = branchCode,
    nextEmployeeId = employeeId,
    nextPage = page,
    nextPageSize = pageSize,
  } = {}) => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams();
    params.set("from", nextFilters.from);
    params.set("to", nextFilters.to);
    params.set("page", String(nextPage));
    params.set("pageSize", String(nextPageSize));

    if (nextBranchCode) params.set("branchCode", nextBranchCode);
    if (nextEmployeeId) params.set("employeeId", nextEmployeeId);

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [branchCode, employeeId, filters, page, pageSize]);

  const buildPunchParams = useCallback(({
    nextFilters = filters,
    nextBranchCode = branchCode,
    nextEmployeeId = employeeId,
    nextPage = page,
    nextPageSize = pageSize,
  } = {}) => {
    const params = new URLSearchParams();
    params.set("from", nextFilters.from);
    params.set("to", nextFilters.to);
    params.set("page", String(nextPage));
    params.set("pageSize", String(nextPageSize));

    if (nextBranchCode) params.set("branchCode", nextBranchCode);
    if (nextEmployeeId) params.set("employeeId", nextEmployeeId);

    return params;
  }, [branchCode, employeeId, filters, page, pageSize]);

  const loadInitial = useCallback(async () => {
    try {
      setIsCatalogLoading(true);
      const [employeesResponse, branchesResponse] = await Promise.all([
        fetch("/api/company/employees"),
        fetch("/api/company/branches"),
      ]);
      const [employeesPayload, branchesPayload] = await Promise.all([
        employeesResponse.json(),
        branchesResponse.json(),
      ]);

      if (!employeesResponse.ok) {
        throw new Error(employeesPayload.error || "No se pudieron cargar empleados.");
      }

      if (!branchesResponse.ok) {
        throw new Error(branchesPayload.error || "No se pudieron cargar sucursales.");
      }

      setEmployees(employeesPayload.employees || []);
      setBranches(branchesPayload.branches || []);
    } catch (error) {
      showToast("error", error.message);
    } finally {
      setIsCatalogLoading(false);
    }
  }, [showToast]);

  const loadPunches = useCallback(async (nextPage = page, nextPageSize = pageSize, overrides = {}) => {
    const requestId = punchesRequestRef.current + 1;
    punchesRequestRef.current = requestId;

    try {
      setIsPunchesLoading(true);
      const nextFilters = overrides.nextFilters || filters;
      const nextBranchCode = overrides.nextBranchCode ?? branchCode;
      const nextEmployeeId = overrides.nextEmployeeId ?? employeeId;
      const params = buildPunchParams({
        nextFilters,
        nextBranchCode,
        nextEmployeeId,
        nextPage,
        nextPageSize,
      });

      const response = await fetch(`/api/planner/attendance/punches?${params.toString()}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudieron cargar las picadas.");
      }

      if (requestId !== punchesRequestRef.current) {
        return;
      }

      const nextPagination = payload.pagination || {
        ...DEFAULT_PAGINATION,
        page: nextPage,
        pageSize: nextPageSize,
      };

      setPunches(payload.punches || []);
      setPagination(nextPagination);
      setPage(nextPagination.page);
      syncUrlParams({
        nextFilters,
        nextBranchCode,
        nextEmployeeId,
        nextPage: nextPagination.page,
        nextPageSize: nextPagination.pageSize,
      });
    } catch (error) {
      if (requestId === punchesRequestRef.current) {
        showToast("error", error.message);
      }
    } finally {
      if (requestId === punchesRequestRef.current) {
        setIsPunchesLoading(false);
      }
    }
  }, [branchCode, buildPunchParams, employeeId, filters, page, pageSize, showToast, syncUrlParams]);

  function handleDateFilterChange(key, value) {
    const nextFilters = { ...filters, [key]: value };

    setFilters(nextFilters);
    setPage(1);
    syncUrlParams({ nextFilters, nextPage: 1 });
  }

  function handleBranchChange(value) {
    const nextBranchCode = value;

    setBranchCode(nextBranchCode);
    setEmployeeId("");
    setPage(1);
    syncUrlParams({ nextBranchCode, nextEmployeeId: "", nextPage: 1 });
  }

  function handleEmployeeChange(value) {
    const nextEmployeeId = value;

    setEmployeeId(nextEmployeeId);
    setPage(1);
    syncUrlParams({ nextEmployeeId, nextPage: 1 });
  }

  function handlePageSizeChange(value) {
    const nextPageSize = Number.parseInt(value, 10);

    setPageSize(nextPageSize);
    setPage(1);
    syncUrlParams({ nextPage: 1, nextPageSize });
  }

  function handlePageChange(nextPage) {
    setPage(nextPage);
    syncUrlParams({ nextPage, nextPageSize: pageSize });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setIsMutating(true);

    try {
      const response = await fetch(`/api/planner/attendance/punches/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo anular la picada.");
      }

      setDeleteTarget(null);
      setDeleteReason("");
      showToast("success", "Picada anulada con auditoría.");
      await loadPunches();
    } catch (error) {
      showToast("error", error.message);
    } finally {
      setIsMutating(false);
    }
  }

  function closeDeleteDialog() {
    setDeleteTarget(null);
    setDeleteReason("");
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadInitial();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, [loadInitial]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadPunches(page, pageSize);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadPunches, page, pageSize]);

  useEffect(() => {
    if (isCatalogLoading) {
      return;
    }

    if (employeeId && !filteredEmployees.some((employee) => employee.id === employeeId)) {
      const timeoutId = window.setTimeout(() => {
        setEmployeeId("");
        syncUrlParams({ nextEmployeeId: "", nextPage: 1 });
      }, 0);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }

    return undefined;
  }, [employeeId, filteredEmployees, isCatalogLoading, syncUrlParams]);

  useEffect(() => {
    if (!deleteTarget) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeDeleteDialog();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteTarget]);

  return (
    <>
      {toast ? (
        <div className={`${styles.toast} ${toast.type === "success" ? styles.toastSuccess : styles.toastError}`}>
          <span>{toast.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}</span>
          <p>{toast.message}</p>
          <button type="button" onClick={() => setToast(null)} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>
      ) : null}

      {deleteTarget && isClientReady
        ? createPortal(
            <div className={styles.modalBackdrop}>
              <div className={styles.modal}>
                <h2>Anular picada</h2>
                <p>
                  La picada quedará visible, pero no afectará los cálculos de {deleteTarget.employee?.fullName || "el empleado"}.
                </p>
                <textarea
                  value={deleteReason}
                  onChange={(event) => setDeleteReason(event.target.value)}
                  placeholder="Motivo del cambio"
                  className={styles.textarea}
                />
                <div className={styles.modalActions}>
                  <button type="button" className={styles.secondaryButton} onClick={closeDeleteDialog}>
                    Cancelar
                  </button>
                  <button type="button" className={styles.dangerButton} onClick={confirmDelete} disabled={isMutating}>
                    Anular
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label>
            <span>Desde</span>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => handleDateFilterChange("from", event.target.value)}
              disabled={isLoading}
            />
          </label>
          <label>
            <span>Hasta</span>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => handleDateFilterChange("to", event.target.value)}
              disabled={isLoading}
            />
          </label>
          <label>
            <span>Sucursal</span>
            <select value={branchCode} onChange={(event) => handleBranchChange(event.target.value)} disabled={isLoading}>
              <option value="">Todas</option>
              {branches.map((branch) => (
                <option key={branch.id || branch.code} value={branch.code}>
                  {branch.name || branch.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Empleado</span>
            <select value={employeeId} onChange={(event) => handleEmployeeChange(event.target.value)} disabled={isLoading}>
              <option value="">Todos</option>
              {filteredEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={`${styles.tableShell} ${isPunchesLoading ? styles.tableShellLoading : ""}`}>
          {isPunchesLoading ? <span className={styles.loadingRail} aria-hidden="true" /> : null}
          <div className={styles.tableHeader}>
            <div>
              <strong>{pagination.total} picadas</strong>
              <span>
                Página {pagination.page} de {pagination.totalPages}
              </span>
            </div>
            <div className={styles.tableHeaderActions}>
              {isLoading ? (
                <span className={styles.loadingBadge} aria-label="Cargando" />
              ) : null}
            </div>
          </div>

          <div className={styles.tableScroller}>
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Sucursal</th>
                  <th>Fecha y hora</th>
                  <th>Origen</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {isPunchesLoading && !punches.length
                  ? Array.from({ length: 8 }).map((_, index) => (
                    <tr key={`loading-${index}`} className={styles.skeletonRow}>
                      <td>
                        <span className={styles.skeletonName} />
                        <span className={styles.skeletonMeta} />
                      </td>
                      <td><span className={styles.skeletonShort} /></td>
                      <td><span className={styles.skeletonMedium} /></td>
                      <td><span className={styles.skeletonTag} /></td>
                      <td><span className={styles.skeletonAction} /></td>
                    </tr>
                  ))
                  : punches.map((punch) => (
                    <tr key={punch.id}>
                      <td>
                        <div>
                          <strong>{punch.employee?.fullName || "Sin empleado"}</strong>
                          <span>{punch.employee?.areaName || "Sin área"} · {punch.employee?.roleName || "Sin rol"}</span>
                        </div>
                      </td>
                      <td>{punch.employee?.branchName || punch.employee?.branchCode || "N/D"}</td>
                      <td>{punch.punchedAtLabel}</td>
                      <td>
                        <span className={punch.isIgnored ? styles.ignoredTag : punch.source === "manual" ? styles.manualTag : styles.uploadTag}>
                          {punch.isIgnored ? "Anulada" : punch.source === "manual" ? "Manual" : "Archivo"}
                        </span>
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <button type="button" onClick={() => setDeleteTarget(punch)} disabled={punch.isIgnored}>
                            <Ban size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                {!isPunchesLoading && !punches.length ? (
                  <tr>
                    <td colSpan={5} className={styles.emptyCell}>
                      No hay picadas para los filtros seleccionados.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className={styles.paginationBar}>
            <div className={styles.paginationInfo}>
              <span>Mostrar</span>
              <select
                value={pageSize}
                onChange={(event) => handlePageSizeChange(event.target.value)}
                aria-label="Picadas por página"
                disabled={isLoading}
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
              <span>por página</span>
            </div>
            <div className={styles.paginationControls}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={!pagination.hasPreviousPage || isLoading}
              >
                Anterior
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={!pagination.hasNextPage || isLoading}
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      </section>

    </>
  );
}
