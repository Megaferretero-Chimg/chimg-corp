import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { buildPunchMinuteRange } from "@/modules/planner/lib/attendance/punchIdentity";
import { parsePunchDateTime } from "@/modules/planner/lib/attendance/punches";
import { formatEcuadorDateKey, formatEcuadorDateTime, formatEcuadorTime } from "@/lib/datetime/ecuador";
import { AttendancePunch } from "@/modules/planner/models";
import { OperationalException } from "@/modules/planner/models";

const MANUAL_PUNCH_NEARBY_MINUTES = 5;

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

export async function resolvePermissionPunchSelection(body = {}, employeeId, excludedExceptionId = "") {
  const type = String(body?.type || "").trim();
  const scope = String(body?.scope || "").trim();

  if (type !== "permission" || scope !== "exit_return") {
    return body;
  }

  const permissionPunchIds = [...new Set(
    (Array.isArray(body?.permissionPunchIds) ? body.permissionPunchIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  )];

  if (permissionPunchIds.length !== 2) {
    throw new Error("Selecciona exactamente dos picadas para registrar la salida y el retorno del permiso.");
  }

  const punches = await AttendancePunch.find({
    _id: { $in: permissionPunchIds },
    employee: employeeId,
  }).sort({ punchedAt: 1 }).lean();

  if (punches.length !== 2) {
    throw new Error("Una de las picadas seleccionadas no pertenece al empleado.");
  }

  const existingPermission = await OperationalException.findOne({
    employee: employeeId,
    status: { $ne: "void" },
    permissionPunches: { $in: permissionPunchIds },
    ...(excludedExceptionId ? { _id: { $ne: excludedExceptionId } } : {}),
  }).lean();

  if (existingPermission) {
    throw new Error("Una de las picadas seleccionadas ya pertenece a otro permiso activo.");
  }

  const dateKey = String(body?.dateKey || "").trim();

  if (punches.some((punch) => formatEcuadorDateKey(punch.punchedAt) !== dateKey)) {
    throw new Error("Las picadas seleccionadas deben pertenecer al dia del permiso.");
  }

  const permissionPunchTimes = punches.map((punch) => formatEcuadorTime(punch.punchedAt));
  const startTime = permissionPunchTimes[0];
  const endTime = permissionPunchTimes[1];
  const [startHours, startMinutes] = startTime.split(":").map(Number);
  const [endHours, endMinutes] = endTime.split(":").map(Number);
  const intervalMinutes = Math.max(0, ((endHours * 60) + endMinutes) - ((startHours * 60) + startMinutes));

  if (!intervalMinutes) {
    throw new Error("La picada de retorno debe ser posterior a la picada de salida.");
  }

  return {
    ...body,
    permissionPunchIds: punches.map((punch) => punch._id.toString()),
    permissionPunchTimes,
    startTime,
    endTime,
    discountMinutes: body?.payMode === "discount"
      ? Math.max(1, Math.round(Number(body?.discountMinutes) || intervalMinutes))
      : 0,
  };
}

function buildRequestedManualPunchDateTimes(exception) {
  if (exception.effect !== "manual_punch" && exception.attendanceMode !== "add_manual_punch") {
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

function buildManualPunchDateTimes(exception) {
  if (exception.resolution !== "approved_work_time") {
    return [];
  }

  return buildRequestedManualPunchDateTimes(exception);
}

function serializeConflictPunch(punch) {
  return {
    id: punch._id.toString(),
    time: formatEcuadorTime(punch.punchedAt),
    source: punch.source || "upload",
    isIgnored: Boolean(punch.isIgnored),
  };
}

export async function inspectExceptionManualPunchConflicts(exception) {
  const requestedPunches = buildRequestedManualPunchDateTimes(exception);

  if (!requestedPunches.length) {
    return { requested: [], exactMatches: [], nearbyConflicts: [], requiresDecision: false };
  }

  const existingPunchIds = resolveManualPunchIds(exception);
  const firstDate = new Date(`${exception.dateKey}T00:00:00.000-05:00`);
  const nextDate = new Date(firstDate);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const existingPunches = await AttendancePunch.find({
    employee: exception.employee,
    isIgnored: { $ne: true },
    ...(existingPunchIds.length ? { _id: { $nin: existingPunchIds } } : {}),
    punchedAt: { $gte: firstDate, $lt: nextDate },
  }).sort({ punchedAt: 1 }).lean();
  const exactMatches = [];
  const nearbyConflicts = [];

  requestedPunches.forEach(({ manualPunchTime, punchedAt }) => {
    const requestedTimestamp = punchedAt.getTime();
    const matches = existingPunches
      .map((punch) => ({
        punch,
        differenceMinutes: Math.abs(Math.round((punch.punchedAt.getTime() - requestedTimestamp) / 60000)),
        isSameMinute: formatEcuadorTime(punch.punchedAt) === manualPunchTime,
      }))
      .filter(({ differenceMinutes }) => differenceMinutes <= MANUAL_PUNCH_NEARBY_MINUTES)
      .sort((left, right) => left.differenceMinutes - right.differenceMinutes);
    const exactMatch = matches.find(({ isSameMinute }) => isSameMinute);

    if (exactMatch) {
      exactMatches.push({
        requestedTime: manualPunchTime,
        existingPunch: serializeConflictPunch(exactMatch.punch),
      });
      return;
    }

    if (matches.length) {
      nearbyConflicts.push({
        requestedTime: manualPunchTime,
        nearbyPunches: matches.map(({ punch, differenceMinutes }) => ({
          ...serializeConflictPunch(punch),
          differenceMinutes,
        })),
      });
    }
  });

  return {
    requested: requestedPunches.map(({ manualPunchTime }) => manualPunchTime),
    exactMatches,
    nearbyConflicts,
    requiresDecision: nearbyConflicts.length > 0,
  };
}

async function assertNoDuplicatePunch({ employeeId, punchedAt, allowedPunchIds = [] }) {
  const minuteRange = buildPunchMinuteRange(punchedAt);

  if (!minuteRange) {
    return;
  }

  const existingPunch = await AttendancePunch.findOne({
    employee: employeeId,
    isIgnored: { $ne: true },
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

export async function syncExceptionManualPunch(exception, options = {}) {
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

  const conflictReview = await inspectExceptionManualPunchConflicts(exception);
  const exactRequestedTimes = new Set(conflictReview.exactMatches.map((match) => match.requestedTime));
  const choices = new Map(
    (Array.isArray(options.manualPunchConflictChoices) ? options.manualPunchConflictChoices : [])
      .map((choice) => [String(choice?.requestedTime || "").trim(), choice]),
  );
  const requestedPunchesToCreate = [];

  conflictReview.nearbyConflicts.forEach((conflict) => {
    const action = String(choices.get(conflict.requestedTime)?.action || "").trim();

    if (!["existing", "requested", "both"].includes(action)) {
      const error = new Error(`Debes decidir qué hacer con la picada solicitada a las ${conflict.requestedTime}.`);
      error.code = "MANUAL_PUNCH_CONFLICT";
      error.conflictReview = conflictReview;
      throw error;
    }
  });

  for (const requestedPunch of punchDateTimes) {
    if (exactRequestedTimes.has(requestedPunch.manualPunchTime)) continue;

    const nearbyConflict = conflictReview.nearbyConflicts.find(
      (conflict) => conflict.requestedTime === requestedPunch.manualPunchTime,
    );

    if (!nearbyConflict) {
      requestedPunchesToCreate.push(requestedPunch);
      continue;
    }

    const choice = choices.get(requestedPunch.manualPunchTime);
    const action = String(choice?.action || "").trim();

    if (action === "existing") continue;

    if (action === "requested") {
      const selectedExistingId = String(choice?.existingPunchId || "").trim();
      const selectedExisting = nearbyConflict.nearbyPunches.find((punch) => punch.id === selectedExistingId)
        || nearbyConflict.nearbyPunches[0];
      const existingPunch = selectedExisting
        ? await AttendancePunch.findOne({
            _id: selectedExisting.id,
            employee: exception.employee,
            isIgnored: { $ne: true },
          })
        : null;

      if (existingPunch) {
        const actor = await resolveAuditActor();
        const before = serializeConflictPunch(existingPunch);
        existingPunch.isIgnored = true;
        existingPunch.ignoredAt = new Date();
        existingPunch.ignoredBy = actor;
        existingPunch.ignoredReason = `Reemplazada al aprobar la picada omitida ${requestedPunch.manualPunchTime}.`;
        existingPunch.note = existingPunch.note
          ? `${existingPunch.note} | ${existingPunch.ignoredReason}`
          : existingPunch.ignoredReason;
        await existingPunch.save();
        await createAuditLog({
          actor,
          action: "attendancePunch.disable",
          entityType: "attendancePunch",
          entityId: existingPunch._id.toString(),
          entityLabel: exception.employeeName,
          route: "/api/planner/planning/exceptions",
          details: {
            reason: existingPunch.ignoredReason,
            source: "operationalException",
            exceptionId: exception._id.toString(),
            before,
          },
        });
      }
    }

    requestedPunchesToCreate.push(requestedPunch);
  }

  await Promise.all(requestedPunchesToCreate.map(({ punchedAt }) =>
    assertNoDuplicatePunch({
      employeeId: exception.employee,
      punchedAt,
      allowedPunchIds: existingPunchIds,
    })));

  const reason = buildManualPunchReason(exception);
  const punches = [];

  for (const [index, { punchedAt }] of requestedPunchesToCreate.entries()) {
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

  const manualPunchTimes = requestedPunchesToCreate.map(({ manualPunchTime }) => manualPunchTime);

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
