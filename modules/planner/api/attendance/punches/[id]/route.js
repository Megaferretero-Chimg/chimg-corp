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
    isIgnored: Boolean(punch.isIgnored),
    ignoredAt: punch.ignoredAt || null,
    ignoredBy: punch.ignoredBy || "",
    ignoredReason: punch.ignoredReason || "",
  };
}

export async function PATCH() {
  return NextResponse.json(
    { error: "No se permite modificar picadas. Anula la picada y conserva la evidencia con auditoría." },
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

    if (punch.isIgnored) {
      return NextResponse.json({ disabled: true });
    }

    punch.isIgnored = true;
    punch.ignoredAt = new Date();
    punch.ignoredBy = actor;
    punch.ignoredReason = reason;
    punch.note = punch.note ? `${punch.note} | Anulada: ${reason}` : `Anulada: ${reason}`;
    await punch.save();

    await createAuditLog({
      actor,
      action: "attendancePunch.disable",
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
      disabled: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo anular la picada." },
      { status: error.status || 400 },
    );
  }
}
