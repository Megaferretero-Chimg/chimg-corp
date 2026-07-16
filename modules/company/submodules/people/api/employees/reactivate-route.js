import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import AuditLog from "@/models/AuditLog";
import {
  buildEmployeeSerializationContext,
  serializeEmployee,
} from "@/modules/company/submodules/people/lib/employees";
import { Employee, Role, User } from "@/modules/company/models";

function normalizeReason(value) {
  const reason = String(value || "").trim();

  if (reason.length < 5) {
    throw new Error("Escribe un motivo de al menos 5 caracteres para anular la baja.");
  }

  if (reason.length > 500) {
    throw new Error("El motivo no puede superar los 500 caracteres.");
  }

  return reason;
}

export async function POST(request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const reason = normalizeReason(body?.reason);
    const existingEmployee = await Employee.findById(id).lean();

    if (!existingEmployee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    if (existingEmployee.isActive !== false) {
      return NextResponse.json({ error: "El empleado ya se encuentra activo." }, { status: 409 });
    }

    const latestTermination = await AuditLog.findOne({
      action: "employee.terminate",
      entityType: "employee",
      entityId: id,
    })
      .sort({ happenedAt: -1 })
      .lean();
    const disabledUserIds = Array.isArray(latestTermination?.details?.disabledUserIds)
      ? latestTermination.details.disabledUserIds
      : [];
    const actor = await resolveAuditActor();

    const employee = await Employee.findByIdAndUpdate(
      id,
      {
        $set: { isActive: true },
        $unset: { terminationDate: 1 },
      },
      { new: true, runValidators: true },
    );

    const userFilter = disabledUserIds.length
      ? { _id: { $in: disabledUserIds }, employeeId: id }
      : { employeeId: id };
    const userUpdate = await User.updateMany(userFilter, { $set: { isActive: true } });

    await createAuditLog({
      actor,
      action: "employee.termination.cancel",
      entityType: "employee",
      entityId: employee._id.toString(),
      entityLabel: employee.fullName,
      route: `/api/company/employees/${id}/reactivate`,
      details: {
        reason,
        before: {
          isActive: false,
          terminationDate: existingEmployee.terminationDate || null,
        },
        after: {
          isActive: true,
          terminationDate: null,
        },
        reactivatedUserCount: userUpdate.modifiedCount || 0,
        cancelledAuditLogId: latestTermination?._id?.toString() || "",
      },
    });

    const [employees, roles] = await Promise.all([
      Employee.find({}).lean(),
      Role.find({}).lean(),
    ]);
    const serializationContext = buildEmployeeSerializationContext({ employees, roles });

    return NextResponse.json({
      success: true,
      employee: serializeEmployee(employee.toObject(), serializationContext),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo anular la baja del empleado." },
      { status: 400 },
    );
  }
}
