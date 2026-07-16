import { getAuthenticatedUser } from "@/lib/auth";
import { Employee, Role } from "@/modules/company/models";
import { PlanningWorkGroup } from "@/modules/planner/models";
import { isAdminAccessUser } from "@/modules/company/submodules/access/lib/permissions";
import {
  buildEmployeeSerializationContext,
  serializeEmployee,
} from "@/modules/company/submodules/people/lib/employees";

function normalizeId(value) {
  return String(value || "").trim();
}

function isCompanyWidePlannerUser(user) {
  return isAdminAccessUser(user)
    || user?.scopeType === "company";
}

function roleEntriesForEmployee(employee = {}) {
  return [
    {
      code: employee.roleCode,
      areaCode: employee.areaCode,
    },
    ...(employee.roleAssignments || []).map((assignment) => ({
      code: assignment.code,
      areaCode: assignment.areaCode,
    })),
  ].map((entry) => ({
    code: String(entry.code || "").trim().toUpperCase(),
    areaCode: String(entry.areaCode || "").trim().toUpperCase(),
  })).filter((entry) => entry.code || entry.areaCode);
}

function buildRoleDepths(roles = []) {
  const rolesByCode = new Map(
    roles.map((role) => [String(role.code || "").trim().toUpperCase(), role]),
  );
  const depthByCode = new Map();

  function depthForRole(code, visited = new Set()) {
    const normalizedCode = String(code || "").trim().toUpperCase();

    if (!normalizedCode) return 0;
    if (depthByCode.has(normalizedCode)) return depthByCode.get(normalizedCode);
    if (visited.has(normalizedCode)) return 1;

    const role = rolesByCode.get(normalizedCode);
    const supervisorRoleCode = String(role?.supervisorRoleCode || "").trim().toUpperCase();
    const depth = supervisorRoleCode
      ? depthForRole(supervisorRoleCode, new Set([...visited, normalizedCode])) + 1
      : 1;

    depthByCode.set(normalizedCode, depth);
    return depth;
  }

  rolesByCode.forEach((_role, code) => depthForRole(code));
  return depthByCode;
}

function collectSupervisedEmployeeIds(employees = [], currentEmployeeId = "", roles = []) {
  const allowedIds = new Set();
  const pendingIds = [currentEmployeeId].filter(Boolean);
  const currentEmployee = employees.find((employee) => normalizeId(employee.id) === currentEmployeeId);
  const currentRoleEntries = roleEntriesForEmployee(currentEmployee);
  const currentRoleCodes = new Set(currentRoleEntries.map((entry) => entry.code).filter(Boolean));
  const currentBranchCode = String(currentEmployee?.branchCode || "").trim().toUpperCase();
  const roleDepths = buildRoleDepths(roles);
  const branchPlanningAreaCodes = new Set(["COM", "OPER"]);
  const currentDepth = Math.max(...currentRoleEntries.map((entry) => roleDepths.get(entry.code) || 0), 0);

  if (currentRoleCodes.has("JEFSUC") && currentBranchCode) {
    employees.forEach((employee) => {
      const employeeId = normalizeId(employee.id);
      const employeeRoleEntries = roleEntriesForEmployee(employee);
      const isSameBranch = String(employee.branchCode || "").trim().toUpperCase() === currentBranchCode;
      const hasBranchPlanningArea = employeeRoleEntries.some((entry) => branchPlanningAreaCodes.has(entry.areaCode));
      const hasLocalBranchArea = employeeRoleEntries.some((entry) => entry.areaCode === "OPER" && entry.code === "CHOFER");
      const isLowerOrUnmappedRole = employeeRoleEntries.some((entry) => {
        const depth = roleDepths.get(entry.code) || 0;

        return depth === 0 || depth > currentDepth;
      });

      if (
        employeeId &&
        isSameBranch &&
        (employeeId === currentEmployeeId || (hasBranchPlanningArea && (isLowerOrUnmappedRole || hasLocalBranchArea)))
      ) {
        pendingIds.push(normalizeId(employee.id));
      }
    });
  }

  while (pendingIds.length) {
    const supervisorId = pendingIds.shift();

    if (!supervisorId || allowedIds.has(supervisorId)) {
      continue;
    }

    allowedIds.add(supervisorId);

    employees.forEach((employee) => {
      const employeeId = normalizeId(employee.id);
      const directSupervisorId = normalizeId(employee.directSupervisor?.employeeId);

      if (employeeId && directSupervisorId === supervisorId && !allowedIds.has(employeeId)) {
        pendingIds.push(employeeId);
      }
    });
  }

  return allowedIds;
}

export async function resolvePlannerEmployeeScope({ employees = null, roles = null } = {}) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return {
      isAuthenticated: false,
      isCompanyWide: false,
      employeeIds: [],
      employeeIdSet: new Set(),
      user: null,
    };
  }

  if (isCompanyWidePlannerUser(user)) {
    return {
      isAuthenticated: true,
      isCompanyWide: true,
      employeeIds: [],
      employeeIdSet: new Set(),
      user,
    };
  }

  const currentEmployeeId = normalizeId(user.employeeId);

  if (!currentEmployeeId) {
    return {
      isAuthenticated: true,
      isCompanyWide: false,
      employeeIds: [],
      employeeIdSet: new Set(),
      user,
    };
  }


  if (user.scopeType === "team") {
    const workGroups = await PlanningWorkGroup.find({
      ownerEmployee: currentEmployeeId,
      isActive: { $ne: false },
    }).lean();
    const employeeIdSet = new Set([currentEmployeeId]);

    workGroups.forEach((group) => {
      (group.members || []).forEach((member) => {
        const employeeId = normalizeId(member.employee?.toString?.() || member.employeeId);
        if (employeeId) employeeIdSet.add(employeeId);
      });
    });

    return {
      isAuthenticated: true,
      isCompanyWide: false,
      employeeIds: [...employeeIdSet],
      employeeIdSet,
      workGroupIds: workGroups.map((group) => group._id.toString()),
      isWorkGroupLocked: true,
      user,
    };
  }

  const [scopeEmployees, scopeRoles] = await Promise.all([
    employees || Employee.find({}).lean(),
    roles || Role.find({}).lean(),
  ]);
  const serializationContext = buildEmployeeSerializationContext({
    employees: scopeEmployees,
    roles: scopeRoles,
  });
  const serializedEmployees = scopeEmployees.map((employee) => serializeEmployee(employee, serializationContext));
  const employeeIdSet = collectSupervisedEmployeeIds(serializedEmployees, currentEmployeeId, scopeRoles);

  return {
    isAuthenticated: true,
    isCompanyWide: false,
    employeeIds: [...employeeIdSet],
    employeeIdSet,
    user,
  };
}

export function applyPlannerScopeToEmployeeQuery(query, scope) {
  if (!scope?.isAuthenticated || scope.isCompanyWide) {
    return query;
  }

  query._id = { $in: scope.employeeIds || [] };
  return query;
}

export function applyPlannerScopeToAssignmentQuery(query, scope) {
  return applyPlannerScopeToEmployeeReferenceQuery(query, scope);
}

export function applyPlannerScopeToEmployeeReferenceQuery(query, scope) {
  if (!scope?.isAuthenticated || scope.isCompanyWide) {
    return query;
  }

  query.employee = { $in: scope.employeeIds || [] };
  return query;
}

export function filterEmployeesByPlannerScope(employees = [], scope) {
  if (!scope?.isAuthenticated || scope.isCompanyWide) {
    return employees;
  }

  return employees.filter((employee) =>
    scope.employeeIdSet?.has(normalizeId(employee._id?.toString?.() || employee.id)),
  );
}

export function assertEmployeesInPlannerScope(employeeIds = [], scope) {
  if (!scope?.isAuthenticated) {
    throw new Error("Sesion invalida o expirada.");
  }

  if (scope.isCompanyWide) {
    return;
  }

  const outOfScopeIds = employeeIds
    .map(normalizeId)
    .filter((employeeId) => employeeId && !scope.employeeIdSet.has(employeeId));

  if (outOfScopeIds.length) {
    throw new Error("No tienes permiso para modificar horarios fuera de tu equipo.");
  }
}

export function assertWorkGroupInPlannerScope(workGroupId, scope) {
  if (!scope?.isAuthenticated) {
    throw new Error("Sesion invalida o expirada.");
  }

  if (scope.isCompanyWide) return;

  if (!new Set(scope.workGroupIds || []).has(normalizeId(workGroupId))) {
    throw new Error("No tienes permiso para planificar este grupo de trabajo.");
  }
}
