import { NextResponse } from "next/server";

import { getAuthenticatedUser, isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  buildEmployeeSerializationContext,
  normalizeEmployeePayload,
  serializeEmployee,
} from "@/modules/company/submodules/people/lib/employees";
import { assertEmployeeBiometricCodesAvailable } from "@/modules/company/submodules/people/lib/employeeBiometrics";
import {
  filterEmployeesByPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import { Employee, Role } from "@/modules/company/models";
import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";

export async function GET(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  await connectToDatabase();
  const { searchParams } = new URL(request.url);
  const view = String(searchParams.get("view") || "").trim().toLowerCase();

  if (view === "attendance-comparison") {
    const [employees, roles] = await Promise.all([
      Employee.find({})
        .select({
          fullName: 1,
          dni: 1,
          branchCode: 1,
          branchName: 1,
          areaCode: 1,
          areaName: 1,
          roleCode: 1,
          roleName: 1,
          employmentStartDate: 1,
          terminationDate: 1,
          isActive: 1,
        })
        .sort({ fullName: 1 })
        .lean(),
      Role.find({}).select({ code: 1, punchesAffectHours: 1 }).lean(),
    ]);
    const rolesByCode = new Map(
      roles.map((role) => [String(role.code || "").trim().toUpperCase(), role]),
    );

    return NextResponse.json({
      employees: employees.map((employee) => ({
        id: employee._id.toString(),
        dni: employee.dni || "",
        fullName: employee.fullName || "",
        branchCode: employee.branchCode || "",
        branchName: employee.branchName || employee.branchCode || "",
        areaCode: employee.areaCode || "",
        areaName: employee.areaName || "",
        roleCode: employee.roleCode || "",
        roleName: employee.roleName || "",
        punchesAffectHours:
          rolesByCode.get(String(employee.roleCode || "").trim().toUpperCase())?.punchesAffectHours !== false,
        employmentStartDate: employee.employmentStartDate
          ? employee.employmentStartDate.toISOString().slice(0, 10)
          : "",
        terminationDate: employee.terminationDate
          ? employee.terminationDate.toISOString().slice(0, 10)
          : "",
        isActive: employee.isActive !== false,
      })),
      scope: null,
    });
  }

  const [employees, roles] = await Promise.all([
    Employee.find({})
      .sort({ fullName: 1 })
      .lean(),
    Role.find({}).lean(),
  ]);
  const serializationContext = buildEmployeeSerializationContext({ employees, roles });
  const scopeType = String(searchParams.get("scope") || "").trim().toLowerCase();
  const plannerScope = scopeType === "planning"
    ? await resolvePlannerEmployeeScope({ employees, roles })
    : null;
  const user = plannerScope?.user || await getAuthenticatedUser();

  if (
    plannerScope
    && !hasAccessPermission(user, "planner.schedules.weekly.view")
    && !hasAccessPermission(user, "planner.schedules.view")
    && !hasAccessPermission(user, "planner.timeOff.view")
  ) {
    return NextResponse.json({ error: "No tienes permiso para consultar empleados de planificación." }, { status: 403 });
  }

  const scopedEmployees = plannerScope
    ? filterEmployeesByPlannerScope(employees, plannerScope)
    : employees;
  const canViewPlanningFinancials = hasAccessPermission(user, "planner.schedules.financial.view");

  return NextResponse.json({
    employees: scopedEmployees.map((employee) => {
      const serialized = serializeEmployee(employee, serializationContext);

      if (plannerScope && !canViewPlanningFinancials) {
        delete serialized.salary;
      }

      return serialized;
    }),
    scope: plannerScope
      ? {
          isCompanyWide: plannerScope.isCompanyWide,
          employeeIds: plannerScope.employeeIds,
        }
      : null,
  });
}

export async function POST(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const body = await request.json();
    const roleCode = String(body?.roleCode || "").trim();
    const role = roleCode ? await Role.findOne({ code: roleCode }).lean() : null;

    if (roleCode && !role) {
      return NextResponse.json({ error: "El cargo seleccionado no existe." }, { status: 404 });
    }

    const payload = normalizeEmployeePayload(body, { role });

    await assertEmployeeBiometricCodesAvailable(payload);
    const employee = await Employee.create(payload);
    const [employees, roles] = await Promise.all([
      Employee.find({}).lean(),
      Role.find({}).lean(),
    ]);
    const serializationContext = buildEmployeeSerializationContext({ employees, roles });

    return NextResponse.json(
      {
        employee: serializeEmployee(employee.toObject(), serializationContext),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error?.code === "BIOMETRIC_CODE_CONFLICT") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    if (error?.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const message = field === "dni"
        ? "Ya existe un empleado con ese DNI."
        : "El código biométrico ya está asignado a otro empleado.";

      return NextResponse.json({ error: message }, { status: 409 });
    }

    return NextResponse.json(
      { error: error.message || "No se pudo crear el empleado." },
      { status: 400 },
    );
  }
}
