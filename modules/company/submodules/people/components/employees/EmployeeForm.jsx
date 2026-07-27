"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BriefcaseBusiness, ChevronDown, Plus, Search, X } from "lucide-react";

import SelectInput from "@/components/ui/SelectInput";
import styles from "@/modules/company/submodules/people/styles/components/employees/EmployeeForm.module.scss";

const DOCUMENT_TYPES = [
  { value: "cedula", label: "Cédula" },
  { value: "pasaporte", label: "Pasaporte" },
];

const EMPLOYMENT_RELATIONS = [
  { value: "nomina", label: "Nómina" },
  { value: "prestacion_servicios", label: "Prestación de servicios" },
];

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function roleDisplayName(role) {
  if (!role) {
    return "";
  }

  return role.areaName ? `${role.name} · ${role.areaName}` : role.name;
}

export default function EmployeeForm({
  form,
  branches,
  roles,
  isEditing,
  isSaving,
  canSubmit,
  onCancel,
  onFieldChange,
  onBranchChange,
  onRoleChange,
  onSubmit,
}) {
  const roleAutocompleteRef = useRef(null);
  const selectedRole = roles.find((role) => role.code === form.roleCode) || null;
  const [roleQuery, setRoleQuery] = useState(() => roleDisplayName(selectedRole));
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
  const filteredRoles = useMemo(() => {
    const normalizedQuery = normalizeSearch(roleQuery);

    return roles
      .filter((role) => {
        if (!normalizedQuery) {
          return true;
        }

        return normalizeSearch([role.name, role.areaName, role.code].filter(Boolean).join(" ")).includes(normalizedQuery);
      })
      .slice(0, 24);
  }, [roleQuery, roles]);
  const roleFunctions = (selectedRole?.functions || selectedRole?.subroles || []).filter(
    (companyFunction) => companyFunction.isActive !== false,
  );
  const selectedOperationalCodes = new Set((form.roleAssignments || []).map((role) => role.code));

  useEffect(() => {
    function handlePointerDown(event) {
      if (!roleAutocompleteRef.current?.contains(event.target)) {
        setIsRoleMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  function handleRoleQueryChange(value) {
    setRoleQuery(value);
    setIsRoleMenuOpen(true);

    if (selectedRole && normalizeSearch(value) !== normalizeSearch(roleDisplayName(selectedRole))) {
      onRoleChange("", []);
    }
  }

  function selectRole(role) {
    onRoleChange(role.code, []);
    setRoleQuery(roleDisplayName(role));
    setIsRoleMenuOpen(false);
  }

  function clearRole() {
    onRoleChange("", []);
    setRoleQuery("");
    setIsRoleMenuOpen(false);
  }

  function toggleRoleFunction(companyFunction) {
    const currentCodes = (form.roleAssignments || []).map((assignment) => assignment.code);
    const nextCodes = selectedOperationalCodes.has(companyFunction.code)
      ? currentCodes.filter((code) => code !== companyFunction.code)
      : [...currentCodes, companyFunction.code];

    onRoleChange(form.roleCode, nextCodes);
  }

  function updateBiometricAlias(index, field, value) {
    const aliases = [...(form.biometricAliases || [])];
    const current = aliases[index] || {};
    const nextAlias = { ...current, [field]: value };

    if (field === "branchCode") {
      const branch = branches.find((candidate) => candidate.code === value);
      nextAlias.branchName = branch?.name || "";
    }

    aliases[index] = nextAlias;
    onFieldChange("biometricAliases", aliases);
  }

  function addBiometricAlias() {
    const usedBranchCodes = new Set([
      form.branchCode,
      ...(form.biometricAliases || []).map((alias) => alias.branchCode),
    ]);
    const branch = branches.find((candidate) => !usedBranchCodes.has(candidate.code));

    onFieldChange("biometricAliases", [
      ...(form.biometricAliases || []),
      {
        branchCode: branch?.code || "",
        branchName: branch?.name || "",
        biometricCode: "",
      },
    ]);
  }

  function removeBiometricAlias(index) {
    onFieldChange(
      "biometricAliases",
      (form.biometricAliases || []).filter((_, aliasIndex) => aliasIndex !== index),
    );
  }

  return (
    <form onSubmit={onSubmit} className={`catalog-form-grid ${styles.formGrid}`}>
      <fieldset className={styles.formFields} disabled={isSaving}>
      <SelectInput
        label="Documento de identidad"
        value={form.documentType}
        onChange={(event) => onFieldChange("documentType", event.target.value)}
        disabled={isSaving}
        className={`catalog-field ${styles.formSelect}`}
        labelClassName="catalog-label"
        controlClassName={styles.formSelectControl}
        selectClassName={styles.formSelectButton}
      >
        {DOCUMENT_TYPES.map((documentType) => (
          <option key={documentType.value} value={documentType.value}>
            {documentType.label}
          </option>
        ))}
      </SelectInput>

      <label className="catalog-field">
        <span className="catalog-label">DNI</span>
        <input
          value={form.dni}
          onChange={(event) => onFieldChange("dni", event.target.value)}
          className="catalog-input"
          placeholder="Numero de documento"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Nombre completo</span>
        <input
          value={form.fullName}
          onChange={(event) => onFieldChange("fullName", event.target.value)}
          className="catalog-input"
          placeholder="Ej. Maria Fernanda Perez"
          required
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Email personal</span>
        <input
          type="email"
          value={form.personalEmail}
          onChange={(event) => onFieldChange("personalEmail", event.target.value)}
          className="catalog-input"
          placeholder="correo@dominio.com"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Direccion</span>
        <input
          value={form.address}
          onChange={(event) => onFieldChange("address", event.target.value)}
          className="catalog-input"
          placeholder="Direccion domiciliaria"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Numero de contacto</span>
        <input
          value={form.phone}
          onChange={(event) => onFieldChange("phone", event.target.value)}
          className="catalog-input"
          placeholder="Telefono o celular"
        />
      </label>

      <SelectInput
        label="Relación de dependencia"
        value={form.employmentRelation}
        onChange={(event) => onFieldChange("employmentRelation", event.target.value)}
        disabled={isSaving}
        className={`catalog-field ${styles.formSelect}`}
        labelClassName="catalog-label"
        controlClassName={styles.formSelectControl}
        selectClassName={styles.formSelectButton}
      >
        {EMPLOYMENT_RELATIONS.map((relation) => (
          <option key={relation.value} value={relation.value}>
            {relation.label}
          </option>
        ))}
      </SelectInput>

      <SelectInput
        label="Sucursal"
        value={form.branchId}
        onChange={(event) => onBranchChange(event.target.value)}
        disabled={isSaving}
        className={`catalog-field ${styles.formSelect}`}
        labelClassName="catalog-label"
        controlClassName={styles.formSelectControl}
        selectClassName={styles.formSelectButton}
      >
        <option value="">Selecciona una sucursal</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </SelectInput>

      <div className="catalog-field">
        <span className="catalog-label">Cargo principal</span>
        <div ref={roleAutocompleteRef} className={styles.roleAutocomplete}>
          <div className={styles.roleInputWrap}>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={roleQuery}
              onChange={(event) => handleRoleQueryChange(event.target.value)}
              onFocus={() => {
                setRoleQuery(roleDisplayName(selectedRole));
                setIsRoleMenuOpen(true);
              }}
              placeholder="Buscar cargo"
              autoComplete="off"
              role="combobox"
              aria-expanded={isRoleMenuOpen}
              aria-controls="employee-role-options"
            />
            {selectedRole ? (
              <button
                type="button"
                className={styles.roleClearButton}
                onClick={clearRole}
                aria-label="Quitar cargo"
                title="Quitar cargo"
              >
                <X size={14} />
              </button>
            ) : (
              <ChevronDown size={16} aria-hidden="true" className={styles.roleChevron} />
            )}
          </div>

          {isRoleMenuOpen ? (
            <div id="employee-role-options" className={styles.roleMenu} role="listbox">
              {filteredRoles.length ? (
                filteredRoles.map((role) => (
                  <button
                    key={role.id || role.code}
                    type="button"
                    className={styles.roleMenuOption}
                    onClick={() => selectRole(role)}
                    role="option"
                    aria-selected={role.code === form.roleCode}
                  >
                    <span className={styles.roleMenuTitle}>
                      <BriefcaseBusiness size={15} />
                      {role.name}
                    </span>
                    <span className={styles.roleMenuMeta}>
                      {role.areaName || "Sin área vinculada"}{role.code ? ` · ${role.code}` : ""}
                    </span>
                  </button>
                ))
              ) : (
                <div className={styles.roleMenuEmpty}>No encontramos cargos relacionados.</div>
              )}
            </div>
          ) : null}
        </div>
        {selectedRole?.areaName ? (
          <span className={styles.roleHint}>Área derivada desde el organigrama: {selectedRole.areaName}.</span>
        ) : (
          <span className={styles.roleHint}>El área se toma automáticamente desde el cargo configurado.</span>
        )}
      </div>

      {roleFunctions.length ? (
        <div className="catalog-field">
          <span className="catalog-label">Funciones que puede ejercer</span>
          <div className={styles.rolePicker}>
            {roleFunctions.map((companyFunction) => {
              const isSelected = selectedOperationalCodes.has(companyFunction.code);

              return (
                <button
                  key={companyFunction.code}
                  type="button"
                  className={`${styles.roleOption} ${isSelected ? styles.roleOptionSelected : ""}`}
                  onClick={() => toggleRoleFunction(companyFunction)}
                  aria-pressed={isSelected}
                >
                  <span>{companyFunction.name}</span>
                  <small>{selectedRole.name}</small>
                </button>
              );
            })}
          </div>
          {form.roleAssignments?.length ? (
            <span className={styles.roleHint}>Estas funciones se usan para planificación semanal. El cargo principal se mantiene como {selectedRole.name}.</span>
          ) : (
            <span className={styles.roleHint}>Selecciona las funciones que esta persona puede ejercer en planificación.</span>
          )}
        </div>
      ) : null}

      <label className="catalog-field">
        <span className="catalog-label">Sueldo</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={form.salary}
          onChange={(event) => onFieldChange("salary", event.target.value)}
          className="catalog-input"
          placeholder="0.00"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Fecha de ingreso</span>
        <input
          type="date"
          value={form.employmentStartDate}
          onInput={(event) => onFieldChange("employmentStartDate", event.currentTarget.value)}
          className="catalog-input"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Fecha de nacimiento</span>
        <input
          type="date"
          value={form.birthDate}
          onChange={(event) => onFieldChange("birthDate", event.target.value)}
          className="catalog-input"
        />
      </label>

      <label className="catalog-field">
        <span className="catalog-label">Código biométrico principal</span>
        <input
          value={form.biometricCode}
          onChange={(event) => onFieldChange("biometricCode", event.target.value)}
          className="catalog-input"
          placeholder="Código en la sucursal principal"
        />
      </label>

      <div className={styles.biometricSection}>
        <div className={styles.biometricHeader}>
          <div>
            <strong>Códigos biométricos adicionales</strong>
            <span>
              Asigna los códigos que identifica a esta persona en otras sucursales.
            </span>
          </div>
          <button type="button" onClick={addBiometricAlias} className={styles.addBiometricButton}>
            <Plus size={15} />
            Agregar código
          </button>
        </div>

        {(form.biometricAliases || []).length ? (
          <div className={styles.biometricAliases}>
            {(form.biometricAliases || []).map((alias, index) => (
              <div
                key={`${alias.branchCode || "branch"}-${index}`}
                className={styles.biometricAliasRow}
              >
                <label>
                  <span>Sucursal</span>
                  <select
                    value={alias.branchCode || ""}
                    onChange={(event) => updateBiometricAlias(index, "branchCode", event.target.value)}
                  >
                    <option value="">Seleccionar sucursal</option>
                    {branches.map((branch) => (
                      <option key={branch.id || branch.code} value={branch.code}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Código</span>
                  <input
                    value={alias.biometricCode || ""}
                    onChange={(event) => updateBiometricAlias(index, "biometricCode", event.target.value)}
                    placeholder="Código biométrico"
                  />
                </label>
                <button
                  type="button"
                  className={styles.removeBiometricButton}
                  onClick={() => removeBiometricAlias(index)}
                  aria-label="Eliminar código biométrico"
                  title="Eliminar código"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.biometricEmpty}>
            No hay códigos adicionales. El código principal se usa en la sucursal del empleado.
          </p>
        )}
      </div>

      </fieldset>

      <div className={`catalog-actions catalog-actions-end ${styles.actions}`}>
        <button type="button" onClick={onCancel} disabled={isSaving} className="catalog-button-ghost">
          Cancelar
        </button>
        <button type="submit" disabled={isSaving || !canSubmit} className="catalog-button-primary">
          <Plus size={16} />
          {isSaving ? "Guardando..." : isEditing ? "Actualizar" : "Crear"}
        </button>
      </div>
    </form>
  );
}
