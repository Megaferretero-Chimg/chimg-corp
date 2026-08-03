import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import parseAttendanceFile from "@/modules/planner/lib/attendance/parseAttendanceFile";
import {
  buildPublishMessage,
  publishAttendancePunches,
} from "@/modules/planner/lib/attendance/publishAttendancePunches";
import { buildPunchMinuteKey } from "@/modules/planner/lib/attendance/punchIdentity";
import { applyAttendancePunchTimeAdjustments } from "@/modules/planner/lib/attendance/punchTimeAdjustments";
import connectToDatabase from "@/lib/db/mongodb";
import { formatEcuadorDateKey } from "@/lib/datetime/ecuador";
import { isEmployeeActiveOnDate } from "@/modules/company/submodules/people/lib/employees";
import { AttendanceUpload } from "@/modules/planner/models";
import { Employee } from "@/modules/company/models";

function normalizeStoredFileToBuffer(value) {
  if (!value) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value.buffer) {
    return Buffer.from(value.buffer);
  }

  return Buffer.from(value);
}

function toPlainObject(value) {
  return typeof value?.toObject === "function" ? value.toObject() : value;
}

function buildReconciliationSummary(employees = []) {
  return employees.reduce(
    (summary, employee) => {
      if (employee.matchStatus === "matched") {
        summary.matchedEmployees += 1;
      } else if (employee.matchStatus === "inactive") {
        summary.inactiveEmployees += 1;
      } else {
        summary.unmatchedEmployees += 1;
      }

      summary.duplicateMinutePunches += employee.duplicateMinuteCount || 0;
      summary.irregularDays += employee.irregularDayCount || 0;

      return summary;
    },
    {
      matchedEmployees: 0,
      inactiveEmployees: 0,
      unmatchedEmployees: 0,
      duplicateMinutePunches: 0,
      irregularDays: 0,
    },
  );
}

function getPunchDiagnostics(punches = []) {
  const uniquePunchesByMinute = new Map();

  for (const punch of punches) {
    const minuteKey = buildPunchMinuteKey(punch.punchedAt);

    if (!minuteKey || uniquePunchesByMinute.has(minuteKey)) {
      continue;
    }

    uniquePunchesByMinute.set(minuteKey, punch);
  }

  const punchesByDay = new Map();

  for (const punch of punches) {
    const dayKey = formatEcuadorDateKey(punch.punchedAt);

    if (!dayKey) {
      continue;
    }

    if (!punchesByDay.has(dayKey)) {
      punchesByDay.set(dayKey, []);
    }

    punchesByDay.get(dayKey).push(punch);
  }

  const irregularDays = [...punchesByDay.entries()]
    .map(([date, dayPunches]) => {
      const sortedPunches = [...dayPunches].sort(
        (left, right) => new Date(left.punchedAt).getTime() - new Date(right.punchedAt).getTime(),
      );
      const punchCount = sortedPunches.length;
      const firstPunchTime = new Date(sortedPunches[0]?.punchedAt).getTime();
      const lastPunchTime = new Date(sortedPunches[punchCount - 1]?.punchedAt).getTime();
      const spanMinutes =
        Number.isFinite(firstPunchTime) && Number.isFinite(lastPunchTime)
          ? Math.round((lastPunchTime - firstPunchTime) / 60000)
          : 0;
      const isIrregular =
        punchCount === 1 ||
        punchCount === 3 ||
        punchCount > 4 ||
        (punchCount === 2 && spanMinutes < 60);

      return isIrregular ? { date, punchCount } : null;
    })
    .filter(Boolean);

  return {
    duplicateMinuteCount: Math.max(0, punches.length - uniquePunchesByMinute.size),
    irregularDays,
  };
}

function enrichNormalizedSnapshotDiagnostics(normalizedSnapshot = {}) {
  const plainSnapshot = toPlainObject(normalizedSnapshot) || {};
  const employees = (plainSnapshot.employees || []).map((employee) => {
    const plainEmployee = toPlainObject(employee) || {};
    const punches = Array.isArray(plainEmployee.punches) ? plainEmployee.punches : [];
    const diagnostics = getPunchDiagnostics(punches);

    return {
      ...plainEmployee,
      punches,
      duplicateMinuteCount: diagnostics.duplicateMinuteCount,
      irregularDayCount: diagnostics.irregularDays.length,
      irregularDays: diagnostics.irregularDays.slice(0, 12),
      punchCount: punches.length || plainEmployee.punchCount || 0,
    };
  });
  const reconciliationSummary = buildReconciliationSummary(employees);

  return {
    ...plainSnapshot,
    employees,
    summary: {
      ...(plainSnapshot.summary || {}),
      totalEmployees: plainSnapshot.summary?.totalEmployees ?? employees.length,
      totalPunches:
        plainSnapshot.summary?.totalPunches ??
        employees.reduce((total, employee) => total + (employee.punchCount || 0), 0),
      ...reconciliationSummary,
    },
  };
}

function buildNormalizedPayload(upload, normalizedSnapshot, source) {
  const adjustedSnapshot = applyAttendancePunchTimeAdjustments(normalizedSnapshot, upload);
  const enrichedSnapshot = enrichNormalizedSnapshotDiagnostics(adjustedSnapshot);
  const publishSummary = upload.punchesPublishedAt
    ? {
        publishedAt: upload.punchesPublishedAt,
        publishedEmployees: upload.publishedEmployees || 0,
        publishedPunches: upload.publishedPunches || 0,
        skippedDuplicatePunches: upload.skippedDuplicatePunches || 0,
        skippedUnmatchedEmployees: upload.skippedUnmatchedEmployees || 0,
        skippedUnmatchedPunches: upload.skippedUnmatchedPunches || 0,
      }
    : null;

  return {
    upload: {
      id: upload._id.toString(),
      fileName: upload.fileName,
      branchCode: upload.branchCode || "",
      branchName: upload.branchName || "",
      month: upload.month || null,
      year: upload.year || null,
      createdAt: upload.createdAt,
      uploadedBy: upload.uploadedBy || "",
      uploadedByUser: upload.uploadedByUser || "",
      uploadedAt: upload.uploadedAt || upload.createdAt,
      status: upload.status,
      normalizedAt: upload.normalizedAt,
      punchesPublishedAt: upload.punchesPublishedAt || null,
    },
    summary: {
      totalEmployees: enrichedSnapshot.summary.totalEmployees,
      totalPunches: enrichedSnapshot.summary.totalPunches,
      month: enrichedSnapshot.summary.month,
      year: enrichedSnapshot.summary.year,
      matchedEmployees: enrichedSnapshot.summary.matchedEmployees,
      inactiveEmployees: enrichedSnapshot.summary.inactiveEmployees,
      unmatchedEmployees: enrichedSnapshot.summary.unmatchedEmployees,
      duplicateMinutePunches: enrichedSnapshot.summary.duplicateMinutePunches,
      irregularDays: enrichedSnapshot.summary.irregularDays,
    },
    employees: enrichedSnapshot.employees,
    parserLogs: enrichedSnapshot.parserLogs,
    publishSummary,
    source,
  };
}

async function buildNormalizedSnapshot(parsedFile) {
  const branchCode = String(parsedFile.branchCode || "").trim().toUpperCase();
  const biometricCodes = [
    ...new Set(parsedFile.employees.map((employee) => String(employee.biometricCode || "").trim())),
  ].filter(Boolean);
  const employeesByBiometric = new Map();

  if (branchCode && biometricCodes.length) {
    const employees = await Employee.find({
      $or: [
        {
          branchCode,
          biometricCode: { $in: biometricCodes },
        },
        {
          biometricAliases: {
            $elemMatch: {
              branchCode,
              biometricCode: { $in: biometricCodes },
            },
          },
        },
      ],
    })
      .select({
        _id: 1,
        fullName: 1,
        biometricCode: 1,
        biometricAliases: 1,
        branchCode: 1,
        branchName: 1,
        areaName: 1,
        roleName: 1,
        isActive: 1,
        terminationDate: 1,
      })
      .lean();

    for (const employee of employees) {
      const codes = [
        employee.branchCode === branchCode ? String(employee.biometricCode || "").trim() : "",
        ...(employee.biometricAliases || [])
          .filter((alias) => String(alias.branchCode || "").trim().toUpperCase() === branchCode)
          .map((alias) => String(alias.biometricCode || "").trim()),
      ].filter(Boolean);

      codes.forEach((code) => {
        const current = employeesByBiometric.get(code);

        if (!current || current.isActive === false) {
          employeesByBiometric.set(code, employee);
        }
      });
    }
  }

  const normalizedEmployees = parsedFile.employees.map((employee) => {
    const biometricCode = String(employee.biometricCode || "").trim();
    const matchedEmployee = employeesByBiometric.get(biometricCode);
    const diagnostics = getPunchDiagnostics(employee.punches || []);
    const hasActivePunchDate = matchedEmployee
      ? (employee.punches || []).some((punch) => isEmployeeActiveOnDate(matchedEmployee, formatEcuadorDateKey(punch.punchedAt)))
      : false;
    const matchStatus = matchedEmployee
      ? !hasActivePunchDate
        ? "inactive"
        : "matched"
      : "unmatched";
    const matchedEmployeeName = matchedEmployee?.fullName || "";

    return {
      biometricCode,
      fullName: matchedEmployeeName || employee.name,
      branchCode: parsedFile.branchCode || "",
      branchName: parsedFile.branchName || "",
      department:
        [matchedEmployee?.areaName, matchedEmployee?.roleName].filter(Boolean).join(" · ") ||
        employee.department,
      matchedEmployeeId: matchedEmployee?._id?.toString?.() || "",
      matchedEmployeeName,
      matchedEmployeeIsActive: Boolean(matchedEmployee && hasActivePunchDate),
      matchStatus,
      duplicateMinuteCount: diagnostics.duplicateMinuteCount,
      irregularDayCount: diagnostics.irregularDays.length,
      irregularDays: diagnostics.irregularDays.slice(0, 12),
      punchCount: employee.punches.length,
      punches: employee.punches.map((punch) => ({
        punchedAt: punch.punchedAt,
        rawValue: punch.rawValue,
      })),
    };
  });
  const reconciliationSummary = buildReconciliationSummary(normalizedEmployees);

  const snapshot = {
    summary: {
      totalEmployees: parsedFile.employees.length,
      totalPunches: parsedFile.totalPunches,
      month: parsedFile.month,
      year: parsedFile.year,
      ...reconciliationSummary,
    },
    employees: normalizedEmployees,
    parserLogs: parsedFile.logs,
  };

  return applyAttendancePunchTimeAdjustments(snapshot, {
    branchCode: parsedFile.branchCode,
    branchName: parsedFile.branchName,
  });
}

export async function GET(_request, context) {
  try {
    const authenticated = await isAuthenticated();

    if (!authenticated) {
      return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
    }

    const params = await context.params;
    const uploadId = String(params?.id || "").trim();

    if (!uploadId) {
      return NextResponse.json({ error: "Debes indicar una carga válida." }, { status: 400 });
    }

    await connectToDatabase();

    const upload = await AttendanceUpload.findById(uploadId).lean();

    if (!upload) {
      return NextResponse.json({ error: "Archivo cargado no encontrado." }, { status: 404 });
    }

    if (upload.normalizedSnapshot?.employees?.length) {
      return NextResponse.json(
        buildNormalizedPayload(upload, upload.normalizedSnapshot, "saved"),
      );
    }

    const originalFileBuffer = normalizeStoredFileToBuffer(upload.originalFile);

    if (!originalFileBuffer.length) {
      return NextResponse.json(
        { error: "El archivo guardado no tiene contenido legible." },
        { status: 400 },
      );
    }

    const parsedFile = parseAttendanceFile({
      buffer: originalFileBuffer,
      fileName: upload.fileName,
      branchCode: upload.branchCode || "",
      branchName: upload.branchName || "",
      month: upload.month || null,
      year: upload.year || null,
    });

    const normalizedSnapshot = await buildNormalizedSnapshot(parsedFile);

    return NextResponse.json(buildNormalizedPayload(upload, normalizedSnapshot, "live"));
  } catch (error) {
    console.error("attendance-normalize-error", error);

    return NextResponse.json(
      { error: error.message || "No se pudo normalizar el archivo seleccionado." },
      { status: 500 },
    );
  }
}

export async function PATCH(request, context) {
  try {
    const authenticated = await isAuthenticated();

    if (!authenticated) {
      return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
    }

    const params = await context.params;
    const uploadId = String(params?.id || "").trim();
    const body = await request.json();
    const biometricCode = String(body?.biometricCode || "").trim();
    const employeeId = String(body?.employeeId || "").trim();

    if (!uploadId || !biometricCode || !employeeId) {
      return NextResponse.json(
        { error: "Debes indicar la carga, el código biométrico y el empleado." },
        { status: 400 },
      );
    }

    await connectToDatabase();

    const [upload, employee] = await Promise.all([
      AttendanceUpload.findById(uploadId),
      Employee.findById(employeeId).lean(),
    ]);

    if (!upload) {
      return NextResponse.json({ error: "Archivo cargado no encontrado." }, { status: 404 });
    }

    if (!employee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    if (!upload.normalizedSnapshot?.employees?.length) {
      const originalFileBuffer = normalizeStoredFileToBuffer(upload.originalFile);

      if (!originalFileBuffer.length) {
        return NextResponse.json(
          { error: "El archivo guardado no tiene contenido legible." },
          { status: 400 },
        );
      }

      const parsedFile = parseAttendanceFile({
        buffer: originalFileBuffer,
        fileName: upload.fileName,
        branchCode: upload.branchCode || "",
        branchName: upload.branchName || "",
        month: upload.month || null,
        year: upload.year || null,
      });

      upload.normalizedSnapshot = await buildNormalizedSnapshot(parsedFile);
    }

    const snapshot = toPlainObject(upload.normalizedSnapshot);
    const normalizedEmployee = (snapshot.employees || []).find(
      (entry) => String(entry.biometricCode || "").trim() === biometricCode,
    );

    if (!normalizedEmployee) {
      return NextResponse.json(
        { error: "No se encontraron picadas para ese código biométrico." },
        { status: 404 },
      );
    }

    const hasActivePunchDate = (normalizedEmployee.punches || []).some((punch) =>
      isEmployeeActiveOnDate(employee, formatEcuadorDateKey(punch.punchedAt)),
    );

    if (!hasActivePunchDate) {
      return NextResponse.json(
        { error: "El empleado seleccionado no estaba activo en las fechas de esas picadas." },
        { status: 409 },
      );
    }

    normalizedEmployee.fullName = employee.fullName || normalizedEmployee.fullName;
    normalizedEmployee.department = [employee.areaName, employee.roleName].filter(Boolean).join(" · ");
    normalizedEmployee.matchedEmployeeId = employee._id.toString();
    normalizedEmployee.matchedEmployeeName = employee.fullName || "";
    normalizedEmployee.matchedEmployeeIsActive = true;
    normalizedEmployee.matchStatus = "matched";

    upload.normalizedSnapshot = enrichNormalizedSnapshotDiagnostics(snapshot);
    upload.normalizedAt = upload.normalizedAt || new Date();
    upload.markModified("normalizedSnapshot");

    const wasPublished = Boolean(upload.punchesPublishedAt);
    let publishResult = null;

    if (wasPublished) {
      publishResult = await publishAttendancePunches(upload);
    } else {
      await upload.save();
    }

    return NextResponse.json({
      ...buildNormalizedPayload(upload, upload.normalizedSnapshot, "saved"),
      message: wasPublished
        ? `Empleado asignado. ${buildPublishMessage(publishResult)}`
        : "Empleado asignado correctamente. Las picadas están listas para publicar.",
      publishSummary: publishResult,
    });
  } catch (error) {
    console.error("attendance-normalize-manual-match-error", error);

    return NextResponse.json(
      { error: error.message || "No se pudo asignar el empleado a las picadas." },
      { status: 500 },
    );
  }
}

export async function POST(_request, context) {
  try {
    const authenticated = await isAuthenticated();

    if (!authenticated) {
      return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
    }

    const params = await context.params;
    const uploadId = String(params?.id || "").trim();

    if (!uploadId) {
      return NextResponse.json({ error: "Debes indicar una carga válida." }, { status: 400 });
    }

    await connectToDatabase();

    const upload = await AttendanceUpload.findById(uploadId);

    if (!upload) {
      return NextResponse.json({ error: "Archivo cargado no encontrado." }, { status: 404 });
    }

    const originalFileBuffer = normalizeStoredFileToBuffer(upload.originalFile);

    if (!originalFileBuffer.length) {
      return NextResponse.json(
        { error: "El archivo guardado no tiene contenido legible." },
        { status: 400 },
      );
    }

    const parsedFile = parseAttendanceFile({
      buffer: originalFileBuffer,
      fileName: upload.fileName,
      branchCode: upload.branchCode || "",
      branchName: upload.branchName || "",
      month: upload.month || null,
      year: upload.year || null,
    });

    upload.normalizedSnapshot = await buildNormalizedSnapshot(parsedFile);
    upload.normalizedAt = new Date();
    upload.punchesPublishedAt = null;
    upload.publishedEmployees = 0;
    upload.publishedPunches = 0;
    upload.skippedDuplicatePunches = 0;
    upload.skippedUnmatchedEmployees = 0;
    upload.skippedUnmatchedPunches = 0;
    await upload.save();

    const publishResult = await publishAttendancePunches(upload);

    return NextResponse.json({
      ...buildNormalizedPayload(upload, upload.normalizedSnapshot, "saved"),
      message: `Normalización guardada. ${buildPublishMessage(publishResult)}`,
      publishSummary: publishResult,
    });
  } catch (error) {
    console.error("attendance-normalize-save-error", error);

    return NextResponse.json(
      { error: error.message || "No se pudo guardar la normalización." },
      { status: error?.code === "ATTENDANCE_BRANCH_MISMATCH" ? 409 : 500 },
    );
  }
}
