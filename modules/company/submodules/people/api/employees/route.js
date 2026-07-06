import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  buildEmployeeSerializationContext,
  normalizeEmployeePayload,
  serializeEmployee,
} from "@/modules/company/submodules/people/lib/employees";
import {
  filterEmployeesByPlannerScope,
  resolvePlannerEmployeeScope,
} from "@/modules/planner/lib/planning/accessScope";
import { Employee, Role } from "@/modules/company/models";

export async function GET(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  await connectToDatabase();

  const [employees, roles] = await Promise.all([
    Employee.find({})
      .sort({ fullName: 1 })
      .lean(),
    Role.find({}).lean(),
  ]);
  const serializationContext = buildEmployeeSerializationContext({ employees, roles });
  const { searchParams } = new URL(request.url);
  const scopeType = String(searchParams.get("scope") || "").trim().toLowerCase();
  const plannerScope = scopeType === "planning"
    ? await resolvePlannerEmployeeScope({ employees, roles })
    : null;
  const scopedEmployees = plannerScope
    ? filterEmployeesByPlannerScope(employees, plannerScope)
    : employees;

  return NextResponse.json({
    employees: scopedEmployees.map((employee) => serializeEmployee(employee, serializationContext)),
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
