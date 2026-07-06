import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { buildPunchMinuteRange } from "@/modules/planner/lib/attendance/punchIdentity";
import { parsePunchDateTime } from "@/modules/planner/lib/attendance/punches";
import { formatEcuadorDateTime } from "@/lib/datetime/ecuador";
import { AttendancePunch } from "@/modules/planner/models";
import { OperationalException } from "@/modules/planner/models";

export const OUTSIDE_WORK_PUNCH_TYPE = "outside_work_punch";

function buildManualPunchReason(exception) {
  const detail = exception.notes ? ` Motivo: ${exception.notes}` : "";

  return `Picada manual por excepcion de trabajo externo.${detail}`.trim();
}

function buildManualPunchDateTime(exception) {
  if (exception.type !== OUTSIDE_WORK_PUNCH_TYPE) {
    return null;
  }

  if (exception.resolution !== "approved_work_time") {
    return null;
  }

  if (!exception.dateKey || !exception.manualPunchTime) {
    throw new Error("La excepcion requiere fecha y hora de picada manual.");
  }

  const punchedAt = parsePunchDateTime(`${exception.dateKey}T${exception.manualPunchTime}`);

  if (!punchedAt) {
    throw new Error("La fecha y hora de picada manual no es valida.");
  }

  return punchedAt;
}

async function assertNoDuplicatePunch({ employeeId, punchedAt, allowedPunchId = "" }) {
  const minuteRange = buildPunchMinuteRange(punchedAt);

  if (!minuteRange) {
    return;
  }

  const existingPunch = await AttendancePunch.findOne({
    employee: employeeId,
    punchedAt: {
      $gte: minuteRange.start,
      $lt: minuteRange.end,
    },
  }).lean();

  if (existingPunch && existingPunch._id.toString() !== String(allowedPunchId || "")) {
    throw new Error("Ya existe una picada para ese empleado en esa fecha, hora y minuto.");
  }
}

export async function syncExceptionManualPunch(exception) {
  const punchedAt = buildManualPunchDateTime(exception);
  const existingPunchId = exception.manualPunch?.toString?.() || String(exception.manualPunch || "");

  if (!punchedAt) {
    if (existingPunchId) {
      await AttendancePunch.findByIdAndDelete(existingPunchId);
      await OperationalException.findByIdAndUpdate(exception._id, {
        $set: {
          manualPunch: null,
          ...(exception.type !== OUTSIDE_WORK_PUNCH_TYPE ? { manualPunchTime: "" } : {}),
        },
      });
    }

    return null;
  }

  await assertNoDuplicatePunch({
    employeeId: exception.employee,
    punchedAt,
    allowedPunchId: existingPunchId,
  });

  const reason = buildManualPunchReason(exception);
  const payload = {
    employee: exception.employee,
    upload: null,
    punchedAt,
    rawValue: formatEcuadorDateTime(punchedAt),
    source: "manual",
    note: reason,
  };

  const punch = existingPunchId
    ? await AttendancePunch.findByIdAndUpdate(existingPunchId, payload, { new: true })
    : await AttendancePunch.create(payload);

  if (!punch) {
    throw new Error("No se pudo sincronizar la picada manual de la excepcion.");
  }

  await OperationalException.findByIdAndUpdate(exception._id, {
    $set: {
      manualPunch: punch._id,
      manualPunchTime: exception.manualPunchTime,
    },
  });

  const actor = await resolveAuditActor();

  await createAuditLog({
    actor,
    action: existingPunchId ? "attendancePunch.update" : "attendancePunch.create",
    entityType: "attendancePunch",
    entityId: punch._id.toString(),
    entityLabel: exception.employeeName,
    route: "/api/planner/planning/exceptions",
    details: {
      reason,
      source: "operationalException",
      exceptionId: exception._id.toString(),
      after: {
        employeeId: exception.employee?.toString?.() || String(exception.employee || ""),
        employeeName: exception.employeeName,
        punchedAt,
        source: "manual",
      },
    },
  });

  return punch;
}

export async function deleteExceptionManualPunch(exception) {
  const punchId = exception?.manualPunch?.toString?.() || String(exception?.manualPunch || "");

  if (!punchId) {
    return;
  }

  await AttendancePunch.findByIdAndDelete(punchId);
}
