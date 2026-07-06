"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import styles from "./EmployeeAutocomplete.module.scss";

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function employeeMeta(employee) {
  return [
    employee?.branchName || employee?.branch,
    employee?.areaName,
    employee?.roleName,
  ].filter(Boolean).join(" / ") || "Sin area o rol";
}

export default function EmployeeAutocomplete({
  employees = [],
  value = "",
  query = "",
  onQueryChange,
  onSelect,
  onClearSelection,
  label = "Empleado",
  placeholder = "Buscar empleado",
  disabled = false,
  maxOptions = 24,
}) {
  const rootRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === value) || null,
    [employees, value],
  );
  const filteredEmployees = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);

    return employees
      .filter((employee) => {
        if (!normalizedQuery) return true;

        return normalizeSearch([
          employee.fullName,
          employee.dni,
          employee.branchName || employee.branch,
          employee.areaName,
          employee.roleName,
        ].filter(Boolean).join(" ")).includes(normalizedQuery);
      })
      .slice(0, maxOptions);
  }, [employees, maxOptions, query]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  function handleInputChange(nextQuery) {
    onQueryChange?.(nextQuery);
    setIsOpen(true);

    const normalizedNextQuery = normalizeSearch(nextQuery);
    const normalizedSelectedName = normalizeSearch(selectedEmployee?.fullName);

    if (!normalizedNextQuery || (selectedEmployee && normalizedNextQuery !== normalizedSelectedName)) {
      onClearSelection?.();
    }
  }

  function selectEmployee(employee) {
    onSelect?.(employee);
    onQueryChange?.(employee?.fullName || "");
    setIsOpen(false);
  }

  return (
    <label className={styles.field}>
      <span>{label}</span>
      <div ref={rootRef} className={styles.autocomplete}>
        <div className={styles.inputWrap}>
          <input
            type="search"
            value={query}
            onChange={(event) => handleInputChange(event.target.value)}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            autoComplete="off"
            disabled={disabled}
          />
          <ChevronDown size={16} aria-hidden="true" className={styles.chevron} />
        </div>

        {isOpen && !disabled ? (
          <div className={styles.menu} role="listbox">
            {filteredEmployees.length ? (
              filteredEmployees.map((employee) => (
                <button
                  key={employee.id}
                  type="button"
                  className={styles.option}
                  onClick={() => selectEmployee(employee)}
                  role="option"
                  aria-selected={employee.id === value}
                >
                  <span className={styles.name}>{employee.fullName}</span>
                  <span className={styles.meta}>{employeeMeta(employee)}</span>
                </button>
              ))
            ) : (
              <div className={styles.empty}>No encontramos empleados relacionados.</div>
            )}
          </div>
        ) : null}
      </div>
    </label>
  );
}
