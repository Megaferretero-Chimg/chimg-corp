import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { AttendancePunch } from "@/modules/planner/models";

function normalizeReason(value) {
  const reason = String(value || "").trim();

  if (reason.length < 4) {
    throw new Error("Ingresa un motivo claro para auditar el cambio.");
  }

  return reason;
}

async function resolvePunch(id) {
  const punch = await AttendancePunch.findById(id).populate("employee");

  if (!punch) {
    const error = new Error("Picada no encontrada.");
    error.status = 404;
    throw error;
  }

  return punch;
}

function serializeBefore(punch) {
  const employee = punch.employee || {};

  return {
    employeeId: employee._id?.toString?.() || "",
    employeeName: employee.fullName || "",
    punchedAt: punch.punchedAt,
    source: punch.source || "upload",
    note: punch.note || "",
  };
}

export async function PATCH() {
  return NextResponse.json(
    { error: "No se permite modificar picadas. Elimina la picada y agrega una nueva con auditoría." },
    { status: 405 },
  );
}

export async function DELETE(request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    const params = await context.params;
    const id = String(params?.id || "").trim();
    const body = await request.json();
    const reason = normalizeReason(body?.reason);

    await connectToDatabase();

    const punch = await resolvePunch(id);
    const before = serializeBefore(punch);
    const actor = await resolveAuditActor();

    await punch.deleteOne();

    await createAuditLog({
      actor,
      action: "attendancePunch.delete",
      entityType: "attendancePunch",
      entityId: id,
      entityLabel: before.employeeName,
      route: `/api/planner/attendance/punches/${id}`,
      details: {
        reason,
        before,
      },
    });

    return NextResponse.json({
      deleted: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo eliminar la picada." },
      { status: error.status || 400 },
    );
  }
}
