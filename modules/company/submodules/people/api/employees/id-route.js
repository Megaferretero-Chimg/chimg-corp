import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  buildEmployeeSerializationContext,
  normalizeEmployeePayload,
  serializeEmployee,
} from "@/modules/company/submodules/people/lib/employees";
import { Employee, Role, User } from "@/modules/company/models";

async function employeeSerializationContext() {
  const [employees, roles] = await Promise.all([
    Employee.find({}).lean(),
    Role.find({}).lean(),
  ]);

  return buildEmployeeSerializationContext({ employees, roles });
}

export async function GET(_request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  await connectToDatabase();
  const { id } = await context.params;
  const employee = await Employee.findById(id).lean();

  if (!employee) {
    return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
  }

  const serializationContext = await employeeSerializationContext();

  return NextResponse.json({
    employee: serializeEmployee(employee, serializationContext),
  });
}

export async function PATCH(request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const { id } = await context.params;
    const body = await request.json();
    const existingEmployee = await Employee.findById(id).lean();

    if (!existingEmployee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    const roleCode = String(body?.roleCode || "").trim();
    const role = roleCode ? await Role.findOne({ code: roleCode }).lean() : null;

    if (roleCode && !role) {
      return NextResponse.json({ error: "El cargo seleccionado no existe." }, { status: 404 });
    }

    const payload = normalizeEmployeePayload(body, { role, existingEmployee });

    const employee = await Employee.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });

    const serializationContext = await employeeSerializationContext();

    return NextResponse.json({
      employee: serializeEmployee(employee.toObject(), serializationContext),
    });
  } catch (error) {
    if (error?.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const message = field === "dni"
        ? "Ya existe un empleado con ese DNI."
        : "El código biométrico ya está asignado a otro empleado.";

      return NextResponse.json({ error: message }, { status: 409 });
    }

    return NextResponse.json(
      { error: error.message || "No se pudo actualizar el empleado." },
      { status: 400 },
    );
  }
}

function parseTerminationDate(value) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    throw new Error("La fecha de salida es obligatoria.");
  }

  const date = new Date(`${normalizedValue}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error("La fecha de salida no es valida.");
  }

  return date;
}

export async function DELETE(request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const terminationDate = parseTerminationDate(body?.terminationDate);
    const existingEmployee = await Employee.findById(id).lean();

    if (!existingEmployee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    if (existingEmployee.isActive === false) {
      return NextResponse.json({ error: "El empleado ya se encuentra inactivo." }, { status: 409 });
    }

    const activeLinkedUsers = await User.find({ employeeId: id, isActive: { $ne: false } })
      .select("_id")
      .lean();
    const actor = await resolveAuditActor();
    const employee = await Employee.findByIdAndUpdate(
      id,
      {
        $set: {
          isActive: false,
          terminationDate,
        },
      },
      { new: true },
    );

    await User.updateMany({ employeeId: id }, { $set: { isActive: false } });

    await createAuditLog({
      actor,
      action: "employee.terminate",
      entityType: "employee",
      entityId: employee._id.toString(),
      entityLabel: employee.fullName,
      route: `/api/company/employees/${id}`,
      details: {
        before: {
          isActive: existingEmployee.isActive !== false,
          terminationDate: existingEmployee.terminationDate || null,
        },
        after: {
          isActive: false,
          terminationDate,
        },
        disabledUserIds: activeLinkedUsers.map((user) => user._id.toString()),
      },
    });

    const serializationContext = await employeeSerializationContext();

    return NextResponse.json({
      success: true,
      employee: serializeEmployee(employee.toObject(), serializationContext),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo despedir el empleado." },
      { status: 400 },
    );
  }
}
