"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  BriefcaseBusiness,
  Edit3,
  Landmark,
  Layers3,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  UserCheck,
  UserMinus,
  UserRound,
} from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import CatalogPageLoader from "@/components/catalog/CatalogPageLoader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import SelectInput from "@/components/ui/SelectInput";
import { planningModulePath } from "@/modules/planner/routes";
import EmployeeDetailModal from "./EmployeeDetailModal";
import EmployeeForm from "./EmployeeForm";
import styles from "@/modules/company/submodules/people/styles/components/employees/EmployeeManagement.module.scss";

const EMPLOYEES_PER_PAGE = 8;

const EMPLOYMENT_RELATION_LABELS = {
  nomina: "Nomina",
  prestacion_servicios: "Prestacion de servicios",
};

const EMPLOYMENT_RELATION_OPTIONS = [
  { value: "nomina", label: "Nomina" },
  { value: "prestacion_servicios", label: "Prestacion de servicios" },
];

function getTodayInputValue() {
  const today = new Date();
  const offset = today.getTimezoneOffset();
  const localDate = new Date(today.getTime() - offset * 60 * 1000);

  return localDate.toISOString().slice(0, 10);
}

function getInitialEmployeeUrlState() {
  if (typeof window === "undefined") {
    return { search: "", page: 1, area: "", role: "", branch: "", relation: "" };
  }

  const params = new URLSearchParams(window.location.search);
  const initialPage = Number(params.get("page") || 1);

  return {
    search: params.get("q") || "",
    page: Number.isFinite(initialPage) && initialPage > 0 ? Math.floor(initialPage) : 1,
    area: params.get("area") || "",
    role: params.get("role") || "",
    branch: params.get("branch") || "",
    relation: params.get("relation") || "",
  };
}

const INITIAL_FORM = {
  documentType: "cedula",
  dni: "",
  fullName: "",
  personalEmail: "",
  address: "",
  phone: "",
  employmentRelation: "nomina",
  branchId: "",
  branchCode: "",
  branchName: "",
  roleCode: "",
  roleName: "",
  areaCode: "",
  areaName: "",
  roleAssignments: [],
  salary: "",
  employmentStartDate: "",
  birthDate: "",
  biometricCode: "",
};

function mapEmployeeToForm(employee, branches = [], roles = []) {
  const branch = branches.find((candidate) => {
    const employeeBranch = String(employee.branchName || employee.branch || employee.branchCode || "").toUpperCase();

    return [candidate.id, candidate.code, candidate.name]
      .map((value) => String(value || "").toUpperCase())
      .includes(employeeBranch);
  });
  const roleAssignments = (employee.roleAssignments || [])
    .map((assignment) => {
      const roleMatch = roles.find((candidate) => candidate.code === assignment.code);

      return roleMatch
        ? {
            code: roleMatch.code,
            name: roleMatch.name,
            areaCode: roleMatch.areaCode,
            areaName: roleMatch.areaName,
            isPrimary: Boolean(assignment.isPrimary),
          }
        : assignment;
    })
    .filter((assignment) => assignment.code && assignment.name);
  const role = roles.find((candidate) => {
    const employeeRoleCode = String(employee.roleCode || "").toUpperCase();
    const employeeRoleName = String(employee.roleName || "").toUpperCase();

    return (
      String(candidate.code || "").toUpperCase() === employeeRoleCode ||
      String(candidate.name || "").toUpperCase() === employeeRoleName
    );
  });

  return {
    documentType: ["cedula", "pasaporte"].includes(employee.documentType) ? employee.documentType : "cedula",
    dni: employee.dni || "",
    fullName: employee.fullName || "",
    personalEmail: employee.personalEmail || "",
    address: employee.address || "",
    phone: employee.phone || "",
    employmentRelation: employee.employmentRelation || "nomina",
    branchId: employee.branchId || branch?.id || "",
    branchCode: employee.branchCode || branch?.code || "",
    branchName: employee.branchName || employee.branch || branch?.name || "",
    roleCode: role?.code || employee.roleCode || "",
    roleName: role?.name || employee.roleName || "",
    areaCode: role?.areaCode || employee.areaCode || "",
    areaName: role?.areaName || employee.areaName || "",
    roleAssignments: roleAssignments.length
      ? roleAssignments.map((assignment, index) => ({ ...assignment, isPrimary: index === 0 }))
      : role
        ? [{
            code: role.code,
            name: role.name,
            areaCode: role.areaCode,
            areaName: role.areaName,
            isPrimary: true,
          }]
        : [],
    salary: String(employee.salary ?? ""),
    employmentStartDate: employee.employmentStartDate || "",
    birthDate: employee.birthDate || "",
    biometricCode: employee.biometricCode || "",
  };
}

function buildEmployeeSearchText(employee) {
  return [
    employee.documentType,
    employee.dni,
    employee.fullName,
    employee.personalEmail,
    employee.phone,
    employee.address,
    EMPLOYMENT_RELATION_LABELS[employee.employmentRelation],
    employee.branchName,
    employee.branch,
    employee.roleName,
    employee.areaName,
    ...(employee.roleAssignments || []).flatMap((role) => [role.name, role.areaName]),
    employee.biometricCode,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getEmployeeRoleCodes(employee) {
  const assignmentCodes = (employee.roleAssignments || [])
    .map((role) => role.code)
    .filter(Boolean);

  return new Set([employee.roleCode, ...assignmentCodes].filter(Boolean));
}

function getEmployeeAreaCodes(employee) {
  const assignmentAreaCodes = (employee.roleAssignments || [])
    .map((role) => role.areaCode)
    .filter(Boolean);

  return new Set([employee.areaCode, ...assignmentAreaCodes].filter(Boolean));
}

function getEmployeeBranchCodes(employee) {
  return new Set([employee.branchCode, employee.branchId, employee.branchName, employee.branch].filter(Boolean));
}

export default function EmployeeManagement() {
  const initialUrlState = useMemo(() => getInitialEmployeeUrlState(), []);
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [search, setSearch] = useState(initialUrlState.search);
  const [areaFilter, setAreaFilter] = useState(initialUrlState.area);
  const [roleFilter, setRoleFilter] = useState(initialUrlState.role);
  const [branchFilter, setBranchFilter] = useState(initialUrlState.branch);
  const [relationFilter, setRelationFilter] = useState(initialUrlState.relation);
  const [page, setPage] = useState(initialUrlState.page);
  const [editingEmployeeId, setEditingEmployeeId] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [employeeToDismiss, setEmployeeToDismiss] = useState(null);
  const [employeeToReactivate, setEmployeeToReactivate] = useState(null);
  const [reactivationReason, setReactivationReason] = useState("");
  const [dismissDate, setDismissDate] = useState("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [isPending, startTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);

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
    noticeExitTimeoutRef.current = window.setTimeout(dismissNotice, 4000);
  }, [clearNoticeTimers, dismissNotice]);

  useEffect(() => {
    return () => {
      clearNoticeTimers();
    };
  }, [clearNoticeTimers]);

  const replaceEmployeeUrlState = useCallback((nextState) => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const cleanSearch = String(nextState.search || "").trim();
    const cleanPage = Math.max(1, Math.floor(Number(nextState.page) || 1));
    const cleanArea = String(nextState.area || "").trim();
    const cleanRole = String(nextState.role || "").trim();
    const cleanBranch = String(nextState.branch || "").trim();
    const cleanRelation = String(nextState.relation || "").trim();

    if (cleanSearch) {
      params.set("q", cleanSearch);
    } else {
      params.delete("q");
    }

    if (cleanPage > 1) {
      params.set("page", String(cleanPage));
    } else {
      params.delete("page");
    }

    if (cleanArea) {
      params.set("area", cleanArea);
    } else {
      params.delete("area");
    }

    if (cleanRole) {
      params.set("role", cleanRole);
    } else {
      params.delete("role");
    }

    if (cleanBranch) {
      params.set("branch", cleanBranch);
    } else {
      params.delete("branch");
    }

    if (cleanRelation) {
      params.set("relation", cleanRelation);
    } else {
      params.delete("relation");
    }

    const queryString = params.toString();
    window.history.replaceState(null, "", queryString ? `?${queryString}` : window.location.pathname);
  }, []);

  async function loadData() {
    const [employeesResponse, branchesResponse, rolesResponse] = await Promise.all([
      fetch("/api/company/employees"),
      fetch("/api/company/branches"),
      fetch("/api/company/roles"),
    ]);
    const [employeesPayload, branchesPayload, rolesPayload] = await Promise.all([
      employeesResponse.json(),
      branchesResponse.json(),
      rolesResponse.json(),
    ]);

    if (!employeesResponse.ok) {
      throw new Error(employeesPayload.error || "No se pudo cargar la lista de empleados.");
    }

    if (!branchesResponse.ok) {
      throw new Error(branchesPayload.error || "No se pudo cargar la lista de sucursales.");
    }

    if (!rolesResponse.ok) {
      throw new Error(rolesPayload.error || "No se pudo cargar la lista de cargos.");
    }

    setEmployees(employeesPayload.employees || []);
    setBranches(branchesPayload.branches || []);
    setRoles(rolesPayload.roles || []);
  }

  useEffect(() => {
    startTransition(async () => {
      try {
        await loadData();
      } catch (requestError) {
        showNotice("error", requestError.message);
      } finally {
        setIsLoading(false);
      }
    });
  }, [showNotice]);

  const sortedEmployees = useMemo(
    () => [...employees].sort((left, right) => left.fullName.localeCompare(right.fullName, "es")),
    [employees],
  );

  const areaOptions = useMemo(() => {
    const byCode = new Map();

    for (const role of roles) {
      if (role.areaCode && role.areaName) {
        byCode.set(role.areaCode, role.areaName);
      }
    }

    for (const employee of employees) {
      if (employee.areaCode && employee.areaName) {
        byCode.set(employee.areaCode, employee.areaName);
      }

      for (const assignment of employee.roleAssignments || []) {
        if (assignment.areaCode && assignment.areaName) {
          byCode.set(assignment.areaCode, assignment.areaName);
        }
      }
    }

    return [...byCode]
      .map(([code, name]) => ({ code, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "es"));
  }, [employees, roles]);

  const roleOptions = useMemo(() => {
    const byCode = new Map();

    for (const role of roles) {
      if (role.code && role.name) {
        byCode.set(role.code, {
          code: role.code,
          name: role.name,
          areaCode: role.areaCode || "",
          areaName: role.areaName || "",
        });
      }
    }

    for (const employee of employees) {
      if (employee.roleCode && employee.roleName) {
        byCode.set(employee.roleCode, {
          code: employee.roleCode,
          name: employee.roleName,
          areaCode: employee.areaCode || "",
          areaName: employee.areaName || "",
        });
      }

      for (const assignment of employee.roleAssignments || []) {
        if (assignment.code && assignment.name) {
          byCode.set(assignment.code, {
            code: assignment.code,
            name: assignment.name,
            areaCode: assignment.areaCode || "",
            areaName: assignment.areaName || "",
          });
        }
      }
    }

    return [...byCode.values()]
      .filter((role) => !areaFilter || role.areaCode === areaFilter)
      .sort((left, right) => {
        const areaComparison = left.areaName.localeCompare(right.areaName, "es");

        return areaComparison || left.name.localeCompare(right.name, "es");
      });
  }, [areaFilter, employees, roles]);

  const branchOptions = useMemo(() => {
    const byKey = new Map();

    for (const branch of branches) {
      const code = branch.code || branch.id || branch.name;

      if (code) {
        byKey.set(code, {
          code,
          name: branch.name || branch.code || code,
        });
      }
    }

    for (const employee of employees) {
      const code = employee.branchCode || employee.branchId || employee.branchName || employee.branch;

      if (code) {
        byKey.set(code, {
          code,
          name: employee.branchName || employee.branch || employee.branchCode || code,
        });
      }
    }

    return [...byKey.values()].sort((left, right) => left.name.localeCompare(right.name, "es"));
  }, [branches, employees]);

  const filteredEmployees = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return sortedEmployees.filter((employee) =>
      (!normalizedSearch || buildEmployeeSearchText(employee).includes(normalizedSearch)) &&
      (!areaFilter || getEmployeeAreaCodes(employee).has(areaFilter)) &&
      (!roleFilter || getEmployeeRoleCodes(employee).has(roleFilter)) &&
      (!branchFilter || getEmployeeBranchCodes(employee).has(branchFilter)) &&
      (!relationFilter || (employee.employmentRelation || "nomina") === relationFilter),
    );
  }, [areaFilter, branchFilter, relationFilter, roleFilter, search, sortedEmployees]);

  const hasActiveFilters = Boolean(search.trim() || areaFilter || roleFilter || branchFilter || relationFilter);

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / EMPLOYEES_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const paginationStart = (currentPage - 1) * EMPLOYEES_PER_PAGE;
  const paginatedEmployees = filteredEmployees.slice(
    paginationStart,
    paginationStart + EMPLOYEES_PER_PAGE,
  );

  const canSubmit = useMemo(() => Boolean(form.fullName.trim()), [form.fullName]);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setEditingEmployeeId("");
    setForm(INITIAL_FORM);
  }, []);

  function updateField(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleSearchChange(value) {
    setSearch(value);
    setPage(1);
    replaceEmployeeUrlState({
      search: value,
      page: 1,
      area: areaFilter,
      role: roleFilter,
      branch: branchFilter,
      relation: relationFilter,
    });
  }

  function handleAreaFilterChange(value) {
    setAreaFilter(value);
    setRoleFilter("");
    setPage(1);
    replaceEmployeeUrlState({
      search,
      page: 1,
      area: value,
      role: "",
      branch: branchFilter,
      relation: relationFilter,
    });
  }

  function handleRoleFilterChange(value) {
    setRoleFilter(value);
    setPage(1);
    replaceEmployeeUrlState({
      search,
      page: 1,
      area: areaFilter,
      role: value,
      branch: branchFilter,
      relation: relationFilter,
    });
  }

  function handleBranchFilterChange(value) {
    setBranchFilter(value);
    setPage(1);
    replaceEmployeeUrlState({
      search,
      page: 1,
      area: areaFilter,
      role: roleFilter,
      branch: value,
      relation: relationFilter,
    });
  }

  function handleRelationFilterChange(value) {
    setRelationFilter(value);
    setPage(1);
    replaceEmployeeUrlState({
      search,
      page: 1,
      area: areaFilter,
      role: roleFilter,
      branch: branchFilter,
      relation: value,
    });
  }

  function clearFilters() {
    setSearch("");
    setAreaFilter("");
    setRoleFilter("");
    setBranchFilter("");
    setRelationFilter("");
    setPage(1);
    replaceEmployeeUrlState({
      search: "",
      page: 1,
      area: "",
      role: "",
      branch: "",
      relation: "",
    });
  }

  function handlePageChange(nextPage) {
    const cleanPage = Math.min(Math.max(1, nextPage), totalPages);

    setPage(cleanPage);
    replaceEmployeeUrlState({
      search,
      page: cleanPage,
      area: areaFilter,
      role: roleFilter,
      branch: branchFilter,
      relation: relationFilter,
    });
  }

  function openEmployeeDetail(employee) {
    setSelectedEmployee(employee);
  }

  function handleBranchChange(branchId) {
    const branch = branches.find((candidate) => candidate.id === branchId);

    setForm((current) => ({
      ...current,
      branchId: branch?.id || "",
      branchCode: branch?.code || "",
      branchName: branch?.name || "",
    }));
  }

  function handleRoleChange(primaryRoleCode, operationalCodes = []) {
    const primaryRole = roles.find((candidate) => candidate.code === primaryRoleCode) || null;
    const selectedOperationalCodes = Array.isArray(operationalCodes) ? operationalCodes : [];
    const functionsByCode = new Map(
      (primaryRole?.functions || primaryRole?.subroles || []).map((companyFunction) => [
        companyFunction.code,
        companyFunction,
      ]),
    );
    const operationalAssignments = selectedOperationalCodes
      .map((functionCode) => functionsByCode.get(functionCode))
      .filter(Boolean);

    setForm((current) => ({
      ...current,
      roleCode: primaryRole?.code || "",
      roleName: primaryRole?.name || "",
      areaCode: primaryRole?.areaCode || "",
      areaName: primaryRole?.areaName || "",
      roleAssignments: operationalAssignments.map((companyFunction, index) => ({
        code: companyFunction.code,
        name: companyFunction.name,
        areaCode: primaryRole.areaCode,
        areaName: primaryRole.areaName,
        isPrimary: index === 0,
      })),
    }));
  }

  function openCreateDrawer() {
    setEditingEmployeeId("");
    setForm(INITIAL_FORM);
    setIsDrawerOpen(true);
  }

  function handleEdit(employee) {
    setSelectedEmployee(null);
    setEditingEmployeeId(employee.id);
    setForm(mapEmployeeToForm(employee, branches, roles));
    setIsDrawerOpen(true);
  }

  async function refreshEmployees() {
    const response = await fetch("/api/company/employees");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "No se pudo recargar la lista de empleados.");
    }

    setEmployees(payload.employees || []);
  }

  function handleSubmit(event) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const method = editingEmployeeId ? "PATCH" : "POST";
        const endpoint = editingEmployeeId ? `/api/company/employees/${editingEmployeeId}` : "/api/company/employees";
        const response = await fetch(endpoint, {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...form,
            salary: Number(form.salary || 0),
          }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar el empleado.");
        }

        await refreshEmployees();
        showNotice("success", editingEmployeeId ? "Empleado actualizado correctamente." : "Empleado creado correctamente.");
        closeDrawer();
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  function requestDismiss(employee) {
    setEmployeeToDismiss(employee);
    setDismissDate(employee.terminationDate || getTodayInputValue());
  }

  function confirmDismiss() {
    if (!employeeToDismiss) {
      return;
    }

    if (!dismissDate) {
      showNotice("error", "Selecciona la fecha de salida del empleado.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/company/employees/${employeeToDismiss.id}`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            terminationDate: dismissDate,
          }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo despedir el empleado.");
        }

        await refreshEmployees();
        setSelectedEmployee(null);
        showNotice("success", "Empleado despedido correctamente. Su historial se mantiene disponible.");

        if (editingEmployeeId === employeeToDismiss.id) {
          closeDrawer();
        }

        setEmployeeToDismiss(null);
        setDismissDate("");
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  function requestReactivation(employee) {
    setEmployeeToReactivate(employee);
    setReactivationReason("");
  }

  function confirmReactivation() {
    if (!employeeToReactivate) {
      return;
    }

    if (reactivationReason.trim().length < 5) {
      showNotice("error", "Escribe un motivo de al menos 5 caracteres para anular la baja.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/company/employees/${employeeToReactivate.id}/reactivate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason: reactivationReason.trim() }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo anular la baja del empleado.");
        }

        await refreshEmployees();
        setSelectedEmployee(null);
        setEmployeeToReactivate(null);
        setReactivationReason("");
        showNotice("success", "Baja anulada correctamente. El empleado y sus accesos vinculados están activos nuevamente.");
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  if (isLoading) {
    return <CatalogPageLoader formVisible={false} />;
  }

  return (
    <div className="catalog-page-shell">
      <FloatingNotice notice={notice} onClose={dismissNotice} />

      <section className={`catalog-panel page-entrance ${styles.tablePanel}`}>
        <div className="catalog-toolbar">
          <p className="catalog-count">
            {filteredEmployees.length} empleado{filteredEmployees.length === 1 ? "" : "s"}
            {hasActiveFilters ? ` de ${sortedEmployees.length}` : ""}
          </p>

          <div className={styles.filterGrid}>
            <label className="catalog-search">
              <Search size={16} />
              <input
                type="search"
                value={search}
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder="Buscar empleado"
                className="catalog-search-input"
                disabled={isPending}
              />
            </label>

            <div className={styles.filterControl}>
              <Layers3 size={16} />
              <SelectInput
                value={areaFilter}
                onChange={(event) => handleAreaFilterChange(event.target.value)}
                aria-label="Filtrar por área"
                disabled={isPending}
                className={styles.filterSelectField}
                controlClassName={styles.filterSelectControl}
                selectClassName={styles.filterSelectButton}
                menuClassName={styles.filterSelectMenu}
              >
                <option value="">Todas las áreas</option>
                {areaOptions.map((area) => (
                  <option key={area.code} value={area.code}>
                    {area.name}
                  </option>
                ))}
              </SelectInput>
            </div>

            <div className={styles.filterControl}>
              <BriefcaseBusiness size={16} />
              <SelectInput
                value={roleFilter}
                onChange={(event) => handleRoleFilterChange(event.target.value)}
                aria-label="Filtrar por cargo"
                disabled={isPending}
                className={styles.filterSelectField}
                controlClassName={styles.filterSelectControl}
                selectClassName={styles.filterSelectButton}
                menuClassName={styles.filterSelectMenu}
              >
                <option value="">Todos los cargos</option>
                {roleOptions.map((role) => (
                  <option key={role.code} value={role.code}>
                    {role.areaName ? `${role.name} · ${role.areaName}` : role.name}
                  </option>
                ))}
              </SelectInput>
            </div>

            <div className={styles.filterControl}>
              <Landmark size={16} />
              <SelectInput
                value={branchFilter}
                onChange={(event) => handleBranchFilterChange(event.target.value)}
                aria-label="Filtrar por sucursal"
                disabled={isPending}
                className={styles.filterSelectField}
                controlClassName={styles.filterSelectControl}
                selectClassName={styles.filterSelectButton}
                menuClassName={styles.filterSelectMenu}
              >
                <option value="">Todas las sucursales</option>
                {branchOptions.map((branch) => (
                  <option key={branch.code} value={branch.code}>
                    {branch.name}
                  </option>
                ))}
              </SelectInput>
            </div>

            <div className={styles.filterControl}>
              <ReceiptText size={16} />
              <SelectInput
                value={relationFilter}
                onChange={(event) => handleRelationFilterChange(event.target.value)}
                aria-label="Filtrar por relación"
                disabled={isPending}
                className={styles.filterSelectField}
                controlClassName={styles.filterSelectControl}
                selectClassName={styles.filterSelectButton}
                menuClassName={styles.filterSelectMenu}
              >
                <option value="">Todas las relaciones</option>
                {EMPLOYMENT_RELATION_OPTIONS.map((relation) => (
                  <option key={relation.value} value={relation.value}>
                    {relation.label}
                  </option>
                ))}
              </SelectInput>
            </div>
          </div>

          {hasActiveFilters ? (
            <button
              type="button"
              className="catalog-button-ghost"
              onClick={clearFilters}
              aria-label="Limpiar filtros"
              title="Limpiar filtros"
              disabled={isPending}
            >
              <RotateCcw size={16} />
              Limpiar
            </button>
          ) : null}

          <button
            type="button"
            className="catalog-button-primary"
            onClick={openCreateDrawer}
            aria-haspopup="dialog"
            aria-expanded={isDrawerOpen}
            aria-label="Crear empleado"
            title="Crear empleado"
          >
            <Plus size={16} />
            Crear
          </button>
        </div>

        {filteredEmployees.length ? (
          <div className={`catalog-table-shell ${styles.tableShell}`}>
            <div className={`catalog-table-scroll ${styles.tableScroll}`}>
              <table className={`catalog-table ${styles.table}`}>
                <colgroup>
                  <col className={styles.statusColumn} />
                  <col className={styles.employeeColumn} />
                  <col className={styles.structureColumn} />
                  <col className={styles.actionsColumn} />
                </colgroup>
                <thead>
                  <tr>
                    <th aria-label="Estado" />
                    <th>Empleado</th>
                    <th>Estructura</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedEmployees.map((employee) => (
                    <tr
                      key={employee.id}
                      className={styles.employeeRow}
                      tabIndex={0}
                      onClick={() => openEmployeeDetail(employee)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openEmployeeDetail(employee);
                        }
                      }}
                    >
                      <td>
                        <span
                          className={`${styles.statusMarker} ${employee.isActive ? styles.statusActive : styles.statusInactive}`}
                          aria-label={employee.isActive ? "Empleado activo" : "Empleado inactivo"}
                          title={employee.isActive ? "Activo" : "Inactivo"}
                        />
                      </td>
                      <td>
                        <div className={styles.employeeName}>{employee.fullName}</div>
                        <span className={styles.employeeMeta}>
                          <UserRound size={14} />
                          {EMPLOYMENT_RELATION_LABELS[employee.employmentRelation] || "Nomina"} ·{" "}
                          {employee.organizationLabel || "Estructura pendiente"}
                        </span>
                      </td>
                      <td>
                        <div className={styles.stack}>
                          <span className={styles.badge}>
                            <Landmark size={14} />
                            {employee.branchName || employee.branch || "Sucursal pendiente"}
                          </span>
                          <span className={styles.badgeMuted}>
                            <BriefcaseBusiness size={14} />
                            {employee.roleName || "Cargo pendiente"}
                          </span>
                        </div>
                      </td>
                      <td className={styles.actionsCell}>
                        <div className="catalog-row-actions">
                          <Link
                            href={`${planningModulePath("/payroll")}?employeeId=${employee.id}&employeeName=${encodeURIComponent(employee.fullName)}&mode=month`}
                            className="catalog-icon-button"
                            aria-label={`Ver nómina de ${employee.fullName}`}
                            title="Ir a nómina"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <ReceiptText size={16} />
                          </Link>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleEdit(employee);
                            }}
                            className="catalog-icon-button"
                            aria-label={`Editar ${employee.fullName}`}
                            title="Editar empleado"
                          >
                            <Edit3 size={16} />
                          </button>
                          {employee.isActive !== false ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                requestDismiss(employee);
                              }}
                              className="catalog-icon-button danger"
                              aria-label={`Despedir ${employee.fullName}`}
                              title="Despedir empleado"
                            >
                              <UserMinus size={16} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                requestReactivation(employee);
                              }}
                              className="catalog-icon-button"
                              aria-label={`Anular baja de ${employee.fullName}`}
                              title="Anular baja"
                            >
                              <UserCheck size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.paginationBar}>
              <span>
                {paginationStart + 1}-{Math.min(paginationStart + EMPLOYEES_PER_PAGE, filteredEmployees.length)} de{" "}
                {filteredEmployees.length}
              </span>
              <div className={styles.paginationActions}>
                <button
                  type="button"
                  className="catalog-button-ghost"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  Anterior
                </button>
                <strong>
                  {currentPage} / {totalPages}
                </strong>
                <button
                  type="button"
                  className="catalog-button-ghost"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  Siguiente
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="catalog-empty-state">
            {sortedEmployees.length
              ? "No encontramos empleados con ese criterio de búsqueda."
              : "Todavía no hay empleados registrados. Crea el primero desde el formulario."}
          </div>
        )}
      </section>

      <CatalogDrawer
        isOpen={isDrawerOpen}
        eyebrow={editingEmployeeId ? "Modo edición" : "Nuevo registro"}
        title={editingEmployeeId ? "Editar empleado" : "Formulario de empleado"}
        onClose={closeDrawer}
      >
        <EmployeeForm
          key={`${editingEmployeeId || "new-employee"}-${isDrawerOpen ? "open" : "closed"}`}
          form={form}
          branches={branches}
          roles={roles}
          isEditing={Boolean(editingEmployeeId)}
          isSaving={isPending}
          canSubmit={canSubmit}
          onCancel={closeDrawer}
          onFieldChange={updateField}
          onBranchChange={handleBranchChange}
          onRoleChange={handleRoleChange}
          onSubmit={handleSubmit}
        />
      </CatalogDrawer>

      <EmployeeDetailModal
        employee={selectedEmployee}
        onClose={() => setSelectedEmployee(null)}
        onEdit={handleEdit}
        onDelete={requestDismiss}
        onReactivate={requestReactivation}
      />

      <ConfirmDialog
        isOpen={Boolean(employeeToDismiss)}
        title="Despedir empleado"
        message={`¿Deseas despedir a "${employeeToDismiss?.fullName || ""}"? Sus registros se conservarán para histórico, pero ya no se incluirá en horarios ni procesos futuros.`}
        confirmLabel={isPending ? "Procesando..." : "Despedir"}
        isPending={isPending}
        confirmDisabled={!dismissDate}
        onCancel={() => {
          setEmployeeToDismiss(null);
          setDismissDate("");
        }}
        onConfirm={confirmDismiss}
      >
        <label className={styles.dismissField}>
          <span>Último día de actividades</span>
          <input
            type="date"
            value={dismissDate}
            onChange={(event) => setDismissDate(event.target.value)}
            disabled={isPending}
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={Boolean(employeeToReactivate)}
        title="Anular baja"
        message={`¿Deseas anular la baja de "${employeeToReactivate?.fullName || ""}"? Volverá a incluirse en horarios y procesos futuros.`}
        confirmLabel={isPending ? "Procesando..." : "Anular baja"}
        tone="neutral"
        isPending={isPending}
        confirmDisabled={reactivationReason.trim().length < 5}
        onCancel={() => {
          setEmployeeToReactivate(null);
          setReactivationReason("");
        }}
        onConfirm={confirmReactivation}
      >
        <label className={styles.dismissField}>
          <span>Motivo de la anulación (obligatorio)</span>
          <textarea
            value={reactivationReason}
            onChange={(event) => setReactivationReason(event.target.value)}
            placeholder="Ej.: La baja fue registrada por error y el empleado continúa trabajando."
            maxLength={500}
            rows={4}
            disabled={isPending}
          />
          <small>{reactivationReason.trim().length}/500 caracteres</small>
        </label>
      </ConfirmDialog>
    </div>
  );
}
