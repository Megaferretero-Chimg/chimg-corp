"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Edit3, KeyRound, Mail, Plus, RotateCcw, Search, ShieldUser, Trash2, UserRound } from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import CatalogPageLoader from "@/components/catalog/CatalogPageLoader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import HydrationGate from "@/components/ui/HydrationGate";
import SelectInput from "@/components/ui/SelectInput";
import { formatEcuadorDateTimeLabel } from "@/lib/datetime/ecuador";
import { isReservedUsername } from "@/modules/company/submodules/access/lib/users";
import UserForm from "./UserForm";
import styles from "@/modules/company/submodules/access/styles/components/UserManagement.module.scss";

const INITIAL_FORM = {
  employeeId: "",
  username: "",
  email: "",
  password: "",
  accessRole: "viewer",
  isActive: true,
};

function mapUserToForm(user) {
  return {
    employeeId: user.employeeId || "",
    username: user.username || "",
    email: user.email || "",
    password: "",
    accessRole: user.accessRole || "viewer",
    isActive: user.isActive !== false,
  };
}

function formatLastLogin(value) {
  return formatEcuadorDateTimeLabel(value, { fallback: "Sin ingresos" });
}

function UserRow({ user, onEdit, onDelete, onReactivate }) {
  const isReserved = isReservedUsername(user.username);
  const isActive = user.isActive !== false;

  return (
    <tr>
      <td>
        <div className={styles.userIdentity}>
          <div className={styles.username}>
            <ShieldUser size={14} />
            {user.username}
          </div>
          {isReserved ? <span className={styles.masterBadge}>Usuario maestro</span> : null}
          <span className={styles.email}>
            <Mail size={14} style={{ marginRight: "0.35rem", verticalAlign: "text-bottom" }} />
            {user.email || "Sin email"}
          </span>
        </div>
      </td>
      <td>
        <div className={styles.employeeStack}>
          <strong className={styles.employeeName}>
            {user.employeeName || "Usuario independiente"}
          </strong>
          <span className={styles.employeeDni}>
            <UserRound size={14} style={{ marginRight: "0.35rem", verticalAlign: "text-bottom" }} />
            {user.employeeDni || "Sin empleado vinculado"}
          </span>
        </div>
      </td>
      <td>
        <span className={styles.roleBadge}>
          <KeyRound size={14} />
          {user.accessRoleLabel}
        </span>
      </td>
      <td>
        <span className={`catalog-status-badge ${user.isActive ? "is-active" : "is-inactive"}`}>
          {user.isActive ? "Activo" : "Inactivo"}
        </span>
      </td>
      <td>
        <span className={styles.lastLogin}>{formatLastLogin(user.lastLoginAt)}</span>
      </td>
      <td>
        <div className="catalog-row-actions">
          {isActive ? (
            <>
              <button
                type="button"
                onClick={() => onEdit(user)}
                className="catalog-icon-button"
                title={isReserved ? "El usuario maestro no se puede editar" : "Editar usuario"}
                aria-label={`Editar ${user.username}`}
                disabled={isReserved}
              >
                <Edit3 size={16} />
              </button>
              <button
                type="button"
                onClick={() => onDelete(user)}
                className="catalog-icon-button danger"
                title={isReserved ? "El usuario maestro no se puede desactivar" : "Desactivar usuario"}
                aria-label={`Desactivar ${user.username}`}
                disabled={isReserved}
              >
                <Trash2 size={16} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onReactivate(user)}
              className="catalog-icon-button"
              title="Activar usuario nuevamente"
              aria-label={`Activar nuevamente ${user.username}`}
            >
              <RotateCcw size={16} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [userTypes, setUserTypes] = useState([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [search, setSearch] = useState("");
  const [editingUserId, setEditingUserId] = useState("");
  const [userToDelete, setUserToDelete] = useState(null);
  const [userToReactivate, setUserToReactivate] = useState(null);
  const [reactivationRole, setReactivationRole] = useState("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [notice, setNotice] = useState(null);
  const [isSaving, startSavingTransition] = useTransition();
  const [, startLoadingTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);

  function clearNoticeTimers() {
    if (noticeExitTimeoutRef.current) {
      window.clearTimeout(noticeExitTimeoutRef.current);
      noticeExitTimeoutRef.current = null;
    }

    if (noticeRemoveTimeoutRef.current) {
      window.clearTimeout(noticeRemoveTimeoutRef.current);
      noticeRemoveTimeoutRef.current = null;
    }
  }

  function dismissNotice() {
    clearNoticeTimers();

    setNotice((current) => {
      if (!current) {
        return null;
      }

      return {
        ...current,
        isLeaving: true,
      };
    });

    noticeRemoveTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeRemoveTimeoutRef.current = null;
    }, 240);
  }

  function showNotice(type, message) {
    clearNoticeTimers();

    setNotice({ type, message, isLeaving: false });
    noticeExitTimeoutRef.current = window.setTimeout(() => {
      dismissNotice();
    }, 4000);
  }

  useEffect(() => {
    return () => {
      clearNoticeTimers();
    };
  }, []);

  useEffect(() => {
    startLoadingTransition(async () => {
      try {
        const [usersResponse, employeesResponse, userTypesResponse] = await Promise.all([
          fetch("/api/company/users"),
          fetch("/api/company/employees"),
          fetch("/api/company/user-types"),
        ]);
        const [usersPayload, employeesPayload, userTypesPayload] = await Promise.all([
          usersResponse.json(),
          employeesResponse.json(),
          userTypesResponse.json(),
        ]);

        if (!usersResponse.ok) {
          throw new Error(usersPayload.error || "No se pudo cargar la lista de usuarios.");
        }

        if (!employeesResponse.ok) {
          throw new Error(employeesPayload.error || "No se pudo cargar la lista de empleados.");
        }

        if (!userTypesResponse.ok) {
          throw new Error(userTypesPayload.error || "No se pudo cargar la lista de tipos de usuario.");
        }

        setUsers(usersPayload.users || []);
        setEmployees(employeesPayload.employees || []);
        setUserTypes((userTypesPayload.userTypes || []).filter((type) => type.isActive));
      } catch (requestError) {
        setNotice({ type: "error", message: requestError.message, isLeaving: false });
      } finally {
        setIsLoadingUsers(false);
      }
    });
  }, []);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return users;
    }

    return users.filter((user) =>
      [user.employeeName, user.employeeDni, user.username, user.email, user.accessRoleLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [search, users]);

  const assignedEmployeeIds = useMemo(() => {
    return new Set(users.map((user) => user.employeeId).filter(Boolean));
  }, [users]);

  const canSubmit = useMemo(() => {
    return Boolean(
      form.username.trim() &&
        form.accessRole &&
        (editingUserId || form.password.length >= 6),
    );
  }, [editingUserId, form.accessRole, form.password, form.username]);

  async function refreshData() {
    setIsLoadingUsers(true);
    const [usersResponse, employeesResponse, userTypesResponse] = await Promise.all([
      fetch("/api/company/users"),
      fetch("/api/company/employees"),
      fetch("/api/company/user-types"),
    ]);
    const [usersPayload, employeesPayload, userTypesPayload] = await Promise.all([
      usersResponse.json(),
      employeesResponse.json(),
      userTypesResponse.json(),
    ]);

    if (!usersResponse.ok) {
      setIsLoadingUsers(false);
      throw new Error(usersPayload.error || "No se pudo recargar la lista de usuarios.");
    }

    if (!employeesResponse.ok) {
      setIsLoadingUsers(false);
      throw new Error(employeesPayload.error || "No se pudo recargar la lista de empleados.");
    }

    if (!userTypesResponse.ok) {
      setIsLoadingUsers(false);
      throw new Error(userTypesPayload.error || "No se pudo recargar la lista de tipos de usuario.");
    }

    setUsers(usersPayload.users || []);
    setEmployees(employeesPayload.employees || []);
    setUserTypes((userTypesPayload.userTypes || []).filter((type) => type.isActive));
    setIsLoadingUsers(false);
  }

  function updateField(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function resetForm() {
    setEditingUserId("");
    setForm(INITIAL_FORM);
  }

  function openCreateDrawer() {
    setEditingUserId("");
    setForm({
      ...INITIAL_FORM,
      accessRole: userTypes[0]?.code || "viewer",
    });
    setIsDrawerOpen(true);
  }

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setEditingUserId("");
    setForm(INITIAL_FORM);
  }, []);

  function handleSubmit(event) {
    event.preventDefault();

    startSavingTransition(async () => {
      try {
        const method = editingUserId ? "PATCH" : "POST";
        const endpoint = editingUserId ? `/api/company/users/${editingUserId}` : "/api/company/users";
        const response = await fetch(endpoint, {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(form),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar el usuario.");
        }

        await refreshData();
        showNotice(
          "success",
          editingUserId
            ? "Usuario actualizado correctamente."
            : "Usuario creado correctamente.",
        );
        closeDrawer();
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  function handleEdit(user) {
    setEditingUserId(user.id);
    setForm(mapUserToForm(user));
    setIsDrawerOpen(true);
  }

  function requestDelete(user) {
    setUserToDelete(user);
  }

  function requestReactivate(user) {
    const hasCurrentRole = userTypes.some((type) => type.code === user.accessRole);

    setUserToReactivate(user);
    setReactivationRole(hasCurrentRole ? user.accessRole : "");
  }

  function confirmReactivate() {
    if (!userToReactivate || !reactivationRole) return;

    startSavingTransition(async () => {
      try {
        const response = await fetch(`/api/company/users/${userToReactivate.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reactivate", accessRole: reactivationRole }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo activar el usuario.");
        }

        await refreshData();
        showNotice("success", payload.message || "Acceso de usuario activado nuevamente.");
        setUserToReactivate(null);
        setReactivationRole("");
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  function confirmDelete() {
    if (!userToDelete) {
      return;
    }

    startSavingTransition(async () => {
      try {
        const response = await fetch(`/api/company/users/${userToDelete.id}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo eliminar el usuario.");
        }

        await refreshData();
        showNotice("success", payload.message || "Acceso de usuario desactivado correctamente.");

        if (editingUserId === userToDelete.id) {
          closeDrawer();
        }

        setUserToDelete(null);
      } catch (requestError) {
        showNotice("error", requestError.message);
      }
    });
  }

  return (
    <HydrationGate fallback={null}>
      {isLoadingUsers ? (
        <CatalogPageLoader formVisible={false} />
      ) : (
        <div className="catalog-page-shell">
          <FloatingNotice notice={notice} onClose={dismissNotice} />

          <div className={`catalog-page-body ${styles.fullWidthBody}`}>
            <div className="catalog-table-column">
              <section className={`catalog-panel page-entrance page-entrance-delay-sm ${styles.tablePanel}`}>
                <div className="catalog-toolbar">
                  <div>
                    <p className="catalog-count">
                      {filteredUsers.length} usuario{filteredUsers.length === 1 ? "" : "s"}
                      {search.trim() ? ` de ${users.length}` : ""}
                    </p>
                  </div>

                  <label className="catalog-search">
                    <Search size={16} />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar usuario"
                      className="catalog-search-input"
                      disabled={isLoadingUsers || isSaving}
                    />
                  </label>

                  <button
                    type="button"
                    className="catalog-button-primary"
                    onClick={openCreateDrawer}
                    aria-haspopup="dialog"
                    aria-expanded={isDrawerOpen}
                    aria-label="Crear usuario"
                    title="Crear usuario"
                  >
                    <Plus size={16} />
                    Crear
                  </button>
                </div>

                {filteredUsers.length ? (
                  <div className={`catalog-table-shell ${styles.tableShell}`}>
                    <div className="catalog-table-scroll">
                      <table className={`catalog-table ${styles.table}`}>
                        <colgroup>
                          <col className={styles.userColumn} />
                          <col className={styles.employeeColumn} />
                          <col className={styles.roleColumn} />
                          <col className={styles.statusColumn} />
                          <col className={styles.lastAccessColumn} />
                          <col className={styles.actionsColumn} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>Usuario</th>
                            <th>Empleado</th>
                            <th>Rol de acceso</th>
                            <th>Estado</th>
                            <th>Último acceso</th>
                            <th>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredUsers.map((user) => (
                            <UserRow
                              key={user.id}
                              user={user}
                              onEdit={handleEdit}
                              onDelete={requestDelete}
                              onReactivate={requestReactivate}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="catalog-empty-state">
                    No encontramos usuarios con ese criterio. Puedes crear un acceso independiente o vincularlo a un empleado activo.
                  </div>
                )}
              </section>
            </div>
          </div>

          <CatalogDrawer
            isOpen={isDrawerOpen}
            eyebrow={editingUserId ? "Modo edición" : "Nuevo acceso"}
            title={editingUserId ? "Editar usuario" : "Formulario de usuario"}
            onClose={closeDrawer}
          >
            <UserForm
              form={form}
              employees={employees}
              userTypes={userTypes}
              assignedEmployeeIds={assignedEmployeeIds}
              isEditing={Boolean(editingUserId)}
              isSaving={isSaving}
              canSubmit={canSubmit}
              onFieldChange={updateField}
              onCancel={closeDrawer}
              onSubmit={handleSubmit}
            />
          </CatalogDrawer>

          <ConfirmDialog
            isOpen={Boolean(userToDelete)}
            title="Desactivar usuario"
            message={`¿Deseas desactivar el acceso de "${userToDelete?.employeeName || userToDelete?.username || ""}"? El empleado y el historial de auditoría se conservarán.`}
            confirmLabel={isSaving ? "Desactivando..." : "Desactivar acceso"}
            isPending={isSaving}
            onCancel={() => setUserToDelete(null)}
            onConfirm={confirmDelete}
          />

          <ConfirmDialog
            isOpen={Boolean(userToReactivate)}
            title="Activar usuario nuevamente"
            message={`Selecciona el perfil que tendrá "${userToReactivate?.employeeName || userToReactivate?.username || ""}" al recuperar el acceso.`}
            confirmLabel={isSaving ? "Activando..." : "Activar acceso"}
            tone="default"
            isPending={isSaving}
            confirmDisabled={!reactivationRole}
            onCancel={() => {
              if (!isSaving) {
                setUserToReactivate(null);
                setReactivationRole("");
              }
            }}
            onConfirm={confirmReactivate}
          >
            <SelectInput
              label="Perfil de acceso"
              value={reactivationRole}
              onChange={(event) => setReactivationRole(event.target.value)}
            >
              <option value="">Seleccionar perfil</option>
              {userTypes.map((type) => (
                <option key={type.code} value={type.code}>{type.name}</option>
              ))}
            </SelectInput>
          </ConfirmDialog>
        </div>
      )}
    </HydrationGate>
  );
}
