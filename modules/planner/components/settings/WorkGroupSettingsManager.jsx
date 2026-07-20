"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Edit3, Plus, Search, Trash2, UsersRound } from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import CatalogPageLoader from "@/components/catalog/CatalogPageLoader";
import AutocompleteSelect from "@/components/ui/AutocompleteSelect";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import HydrationGate from "@/components/ui/HydrationGate";
import styles from "@/modules/planner/styles/components/settings/WorkGroupSettingsManager.module.scss";

const EMPTY_FORM = { name: "", ownerEmployeeId: "", memberIds: [], notes: "", isActive: true };

function normalizeSearch(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function mapGroupToForm(group) {
  return {
    name: group.name || "",
    ownerEmployeeId: group.ownerEmployeeId || "",
    memberIds: (group.members || [])
      .filter((member) => member.isActive !== false)
      .map((member) => member.employeeId)
      .filter(Boolean),
    notes: group.notes || "",
    isActive: group.isActive !== false,
  };
}

export default function WorkGroupSettingsManager() {
  const [groups, setGroups] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [query, setQuery] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingGroupId, setEditingGroupId] = useState("");
  const [groupToDeactivate, setGroupToDeactivate] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [isPending, startTransition] = useTransition();
  const noticeTimeoutRef = useRef(null);

  const dismissNotice = useCallback(() => {
    if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current);
    noticeTimeoutRef.current = null;
    setNotice(null);
  }, []);

  const showNotice = useCallback((type, message) => {
    if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current);
    setNotice({ type, message, isLeaving: false });
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimeoutRef.current = null;
    }, 4000);
  }, []);

  const loadData = useCallback(async () => {
    const [groupsResponse, employeesResponse] = await Promise.all([
      fetch("/api/planner/planning/work-groups"),
      fetch("/api/company/employees?scope=planning"),
    ]);
    const [groupsPayload, employeesPayload] = await Promise.all([
      groupsResponse.json(),
      employeesResponse.json(),
    ]);

    if (!groupsResponse.ok) throw new Error(groupsPayload.error || "No se pudieron cargar los grupos de trabajo.");
    if (!employeesResponse.ok) throw new Error(employeesPayload.error || "No se pudieron cargar los empleados.");

    setGroups(groupsPayload.groups || []);
    setCanManage(Boolean(groupsPayload.canManage));
    setEmployees((employeesPayload.employees || []).sort((left, right) =>
      String(left.fullName || "").localeCompare(String(right.fullName || ""), "es"),
    ));
  }, []);

  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      try {
        await loadData();
      } catch (error) {
        if (!cancelled) showNotice("error", error.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
      if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current);
    };
  }, [loadData, showNotice]);

  const employeesById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const ownerOptions = useMemo(() => employees.filter((employee) => employee.isActive !== false).map((employee) => ({
    value: employee.id,
    label: employee.fullName,
    description: [employee.branchName || employee.branchCode, employee.roleName].filter(Boolean).join(" · "),
    searchText: [employee.dni, employee.branchName, employee.areaName, employee.roleName].filter(Boolean).join(" "),
  })), [employees]);
  const filteredGroups = useMemo(() => {
    const needle = normalizeSearch(query);
    if (!needle) return groups;

    return groups.filter((group) => normalizeSearch([
      group.name,
      group.branchName,
      group.ownerEmployeeName,
      ...(group.members || []).map((member) => member.employeeName),
    ].filter(Boolean).join(" ")).includes(needle));
  }, [groups, query]);
  const filteredMembers = useMemo(() => {
    const needle = normalizeSearch(memberQuery);
    const owner = employeesById.get(form.ownerEmployeeId);
    const available = owner?.branchCode
      ? employees.filter((employee) => employee.branchCode === owner.branchCode)
      : employees;

    return available.filter((employee) => employee.isActive !== false && (!needle || normalizeSearch([
      employee.fullName,
      employee.dni,
      employee.areaName,
      employee.roleName,
    ].filter(Boolean).join(" ")).includes(needle)));
  }, [employees, employeesById, form.ownerEmployeeId, memberQuery]);
  const canSubmit = Boolean(form.name.trim() && form.ownerEmployeeId && form.memberIds.length);

  function resetForm() {
    setEditingGroupId("");
    setForm(EMPTY_FORM);
    setMemberQuery("");
  }

  function openCreate() {
    resetForm();
    setIsDrawerOpen(true);
  }

  function openEdit(group) {
    setEditingGroupId(group.id);
    setForm(mapGroupToForm(group));
    setMemberQuery("");
    setIsDrawerOpen(true);
  }

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setEditingGroupId("");
    setForm(EMPTY_FORM);
    setMemberQuery("");
  }, []);

  function updateField(field, value) {
    setForm((current) => {
      if (field !== "ownerEmployeeId") return { ...current, [field]: value };

      const nextOwner = employeesById.get(value);
      const nextMemberIds = current.memberIds.filter((employeeId) => {
        const employee = employeesById.get(employeeId);
        return !nextOwner?.branchCode || employee?.branchCode === nextOwner.branchCode;
      });

      if (value && !nextMemberIds.includes(value)) nextMemberIds.unshift(value);
      return { ...current, ownerEmployeeId: value, memberIds: nextMemberIds };
    });
  }

  function toggleMember(employeeId) {
    if (employeeId === form.ownerEmployeeId) return;
    setForm((current) => ({
      ...current,
      memberIds: current.memberIds.includes(employeeId)
        ? current.memberIds.filter((id) => id !== employeeId)
        : [...current.memberIds, employeeId],
    }));
  }

  function saveGroup(event) {
    event.preventDefault();
    if (!canSubmit || isPending) return;

    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/planning/work-groups", {
          method: editingGroupId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, id: editingGroupId }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "No se pudo guardar el grupo de trabajo.");

        await loadData();
        closeDrawer();
        showNotice("success", payload.message || "Grupo de trabajo guardado correctamente.");
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  function deactivateGroup() {
    if (!groupToDeactivate || isPending) return;

    startTransition(async () => {
      try {
        const response = await fetch("/api/planner/planning/work-groups", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: groupToDeactivate.id }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "No se pudo desactivar el grupo de trabajo.");

        await loadData();
        setGroupToDeactivate(null);
        showNotice("success", payload.message || "Grupo de trabajo desactivado correctamente.");
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  return (
    <HydrationGate fallback={null}>
      {isLoading ? <CatalogPageLoader formVisible={false} /> : (
        <div className="catalog-page-shell">
          <FloatingNotice notice={notice} onClose={dismissNotice} />
          <div className={`catalog-page-body ${styles.fullWidthBody}`}>
            <div className="catalog-table-column">
              <section className="catalog-panel page-entrance page-entrance-delay-sm">
                <div className="catalog-toolbar">
                  <p className="catalog-count">{filteredGroups.length} grupo{filteredGroups.length === 1 ? "" : "s"}{query.trim() ? ` de ${groups.length}` : ""}</p>
                  <label className="catalog-search"><Search size={16} /><input className="catalog-search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar grupo o responsable" /></label>
                  {canManage ? <button type="button" className="catalog-button-primary" onClick={openCreate}><Plus size={16} /> Crear</button> : null}
                </div>

                {filteredGroups.length ? (
                  <div className="catalog-table-shell"><div className="catalog-table-scroll"><table className="catalog-table">
                    <thead><tr><th>Grupo</th><th>Responsable</th><th>Integrantes</th><th>Estado</th>{canManage ? <th>Acciones</th> : null}</tr></thead>
                    <tbody>{filteredGroups.map((group) => <tr key={group.id}>
                      <td><div className={styles.groupIdentity}><UsersRound size={16} /><div><strong>{group.name}</strong><small>{group.branchName || "Sin sucursal"}</small></div></div></td>
                      <td><strong>{group.ownerEmployeeName || "Sin responsable"}</strong></td>
                      <td><span className={styles.memberCount}>{group.memberCount} integrante{group.memberCount === 1 ? "" : "s"}</span></td>
                      <td><span className={`catalog-status-badge ${group.isActive ? "is-active" : "is-inactive"}`}>{group.isActive ? "Activo" : "Inactivo"}</span></td>
                      {canManage ? <td><div className="catalog-row-actions">
                        <button type="button" className="catalog-icon-button" onClick={() => openEdit(group)} aria-label={`Editar ${group.name}`} title="Editar grupo"><Edit3 size={16} /></button>
                        {group.isActive ? <button type="button" className="catalog-icon-button danger" onClick={() => setGroupToDeactivate(group)} aria-label={`Desactivar ${group.name}`} title="Desactivar grupo"><Trash2 size={16} /></button> : null}
                      </div></td> : null}
                    </tr>)}</tbody>
                  </table></div></div>
                ) : <div className="catalog-empty-state">No hay grupos de trabajo con ese criterio.</div>}
              </section>
            </div>
          </div>

          <CatalogDrawer isOpen={isDrawerOpen} eyebrow={editingGroupId ? "Modo edicion" : "Nuevo registro"} title={editingGroupId ? "Editar grupo" : "Crear grupo de trabajo"} onClose={closeDrawer}>
            <form className="catalog-form-grid" onSubmit={saveGroup}>
              <label className="catalog-field"><span className="catalog-label">Nombre</span><input className="catalog-input" value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Ej. Matriz · Comercial" required /></label>
              <AutocompleteSelect label="Responsable" value={form.ownerEmployeeId} options={ownerOptions} onChange={(value) => updateField("ownerEmployeeId", value)} placeholder="Seleccionar responsable" searchPlaceholder="Buscar empleado" emptyText="No hay empleados disponibles" />
              <div className="catalog-field">
                <span className="catalog-label">Integrantes ({form.memberIds.length})</span>
                <label className={styles.memberSearch}><Search size={15} /><input type="search" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Buscar integrante" /></label>
                <div className={styles.memberList}>
                  {filteredMembers.map((employee) => {
                    const isOwner = employee.id === form.ownerEmployeeId;
                    const isChecked = form.memberIds.includes(employee.id);
                    return <label key={employee.id} className={`${styles.memberOption} ${isChecked ? styles.memberOptionSelected : ""}`}>
                      <input type="checkbox" checked={isChecked} disabled={isOwner} onChange={() => toggleMember(employee.id)} />
                      <span><strong>{employee.fullName}</strong><small>{[employee.areaName, employee.roleName].filter(Boolean).join(" · ") || "Sin cargo"}{isOwner ? " · Responsable" : ""}</small></span>
                    </label>;
                  })}
                  {!filteredMembers.length ? <div className={styles.memberEmpty}>Selecciona un responsable o cambia la busqueda.</div> : null}
                </div>
              </div>
              <label className="catalog-field"><span className="catalog-label">Notas</span><textarea className="catalog-input" rows={3} value={form.notes} onChange={(event) => updateField("notes", event.target.value)} placeholder="Detalle operativo opcional" /></label>
              <label className="catalog-field"><span className="catalog-label">Estado</span><button type="button" className={`catalog-switch ${form.isActive ? "is-active" : ""}`} onClick={() => updateField("isActive", !form.isActive)} aria-pressed={form.isActive}><span className="catalog-switchKnob" /><span>{form.isActive ? "Activo" : "Inactivo"}</span></button></label>
              <div className="catalog-actions catalog-actions-end"><button type="button" className="catalog-button-ghost" onClick={closeDrawer} disabled={isPending}>Cancelar</button><button type="submit" className="catalog-button-primary" disabled={!canSubmit || isPending}><Plus size={16} />{isPending ? "Guardando..." : editingGroupId ? "Actualizar" : "Crear"}</button></div>
            </form>
          </CatalogDrawer>
          <ConfirmDialog isOpen={Boolean(groupToDeactivate)} title="Desactivar grupo" message={`El grupo "${groupToDeactivate?.name || ""}" dejará de aparecer en nuevas planificaciones. Su historial se conservará.`} confirmLabel="Desactivar" isPending={isPending} onCancel={() => setGroupToDeactivate(null)} onConfirm={deactivateGroup} />
        </div>
      )}
    </HydrationGate>
  );
}
