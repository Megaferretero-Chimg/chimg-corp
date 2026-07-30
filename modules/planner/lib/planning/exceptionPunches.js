import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { buildPunchMinuteRange } from "@/modules/planner/lib/attendance/punchIdentity";
import { parsePunchDateTime } from "@/modules/planner/lib/attendance/punches";
import { formatEcuadorDateTime } from "@/lib/datetime/ecuador";
import { AttendancePunch } from "@/modules/planner/models";
import { OperationalException } from "@/modules/planner/models";

function buildManualPunchReason(exception) {
  const detail = exception.notes ? ` Motivo: ${exception.notes}` : "";

  return `Picada manual por excepcion de ejecucion.${detail}`.trim();
}

function resolveManualPunchTimes(exception) {
  if (Array.isArray(exception.manualPunchTimes) && exception.manualPunchTimes.length) {
    return exception.manualPunchTimes.map((time) => String(time || "").trim()).filter(Boolean);
  }

  return exception.manualPunchTime ? [String(exception.manualPunchTime).trim()] : [];
}

function resolveManualPunchIds(exception) {
  if (Array.isArray(exception.manualPunches) && exception.manualPunches.length) {
    return exception.manualPunches.map((punch) => punch?.toString?.() || String(punch || "")).filter(Boolean);
  }

  const legacyPunchId = exception.manualPunch?.toString?.() || String(exception.manualPunch || "");

  return legacyPunchId ? [legacyPunchId] : [];
}

function buildManualPunchDateTimes(exception) {
  if (exception.effect !== "manual_punch" && exception.attendanceMode !== "add_manual_punch") {
    return [];
  }

  if (exception.resolution !== "approved_work_time") {
    return [];
  }

  const manualPunchTimes = resolveManualPunchTimes(exception);

  if (!exception.dateKey || !manualPunchTimes.length) {
    throw new Error("La excepcion requiere fecha y al menos una hora de picada manual.");
  }

  return manualPunchTimes.map((manualPunchTime) => {
    const punchedAt = parsePunchDateTime(`${exception.dateKey}T${manualPunchTime}`);

    if (!punchedAt) {
      throw new Error(`La fecha y hora de la picada ${manualPunchTime} no es valida.`);
    }

    return { manualPunchTime, punchedAt };
  });
}

async function assertNoDuplicatePunch({ employeeId, punchedAt, allowedPunchIds = [] }) {
  const minuteRange = buildPunchMinuteRange(punchedAt);

  if (!minuteRange) {
    return;
  }

  const existingPunch = await AttendancePunch.findOne({
    employee: employeeId,
    ...(allowedPunchIds.length ? { _id: { $nin: allowedPunchIds } } : {}),
    punchedAt: {
      $gte: minuteRange.start,
      $lt: minuteRange.end,
    },
  }).lean();

  if (existingPunch) {
    throw new Error("Ya existe una picada para ese empleado en esa fecha, hora y minuto.");
  }
}

export async function syncExceptionManualPunch(exception) {
  const punchDateTimes = buildManualPunchDateTimes(exception);
  const existingPunchIds = resolveManualPunchIds(exception);

  if (!punchDateTimes.length) {
    if (existingPunchIds.length) {
      await AttendancePunch.deleteMany({ _id: { $in: existingPunchIds } });
      await OperationalException.findByIdAndUpdate(exception._id, {
        $set: {
          manualPunch: null,
          manualPunches: [],
          ...(exception.effect !== "manual_punch"
            ? { manualPunchTime: "", manualPunchTimes: [] }
            : {}),
        },
      });
    }

    return [];
  }

  await Promise.all(punchDateTimes.map(({ punchedAt }) =>
    assertNoDuplicatePunch({
      employeeId: exception.employee,
      punchedAt,
      allowedPunchIds: existingPunchIds,
    })));

  const reason = buildManualPunchReason(exception);
  const punches = [];

  for (const [index, { punchedAt }] of punchDateTimes.entries()) {
    const existingPunchId = existingPunchIds[index] || "";
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
      throw new Error("No se pudo sincronizar una de las picadas manuales de la excepcion.");
    }

    punches.push(punch);
  }

  const obsoletePunchIds = existingPunchIds.slice(punches.length);

  if (obsoletePunchIds.length) {
    await AttendancePunch.deleteMany({ _id: { $in: obsoletePunchIds } });
  }

  const manualPunchTimes = punchDateTimes.map(({ manualPunchTime }) => manualPunchTime);

  await OperationalException.findByIdAndUpdate(exception._id, {
    $set: {
      manualPunch: punches[0]?._id || null,
      manualPunches: punches.map((punch) => punch._id),
      manualPunchTime: manualPunchTimes[0] || "",
      manualPunchTimes,
    },
  });

  const actor = await resolveAuditActor();

  await Promise.all(punches.map((punch, index) =>
    createAuditLog({
      actor,
      action: existingPunchIds[index] ? "attendancePunch.update" : "attendancePunch.create",
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
          punchedAt: punch.punchedAt,
          source: "manual",
        },
      },
    })));

  return punches;
}

export async function deleteExceptionManualPunch(exception) {
  const punchIds = resolveManualPunchIds(exception || {});

  if (!punchIds.length) {
    return;
  }

  await AttendancePunch.deleteMany({ _id: { $in: punchIds } });
}
