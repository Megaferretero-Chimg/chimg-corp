import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { isAuthenticated } from "@/lib/auth";
import { formatEcuadorDateKey, formatEcuadorDateTime } from "@/lib/datetime/ecuador";
import connectToDatabase from "@/lib/db/mongodb";
import { isEmployeeActiveOnDate, serializeEmployee } from "@/modules/company/submodules/people/lib/employees";
import { buildPunchMinuteRange } from "@/modules/planner/lib/attendance/punchIdentity";
import { parsePunchDateTime, resolvePunchRange } from "@/modules/planner/lib/attendance/punches";
import AuditLog from "@/models/AuditLog";
import { AttendancePunch } from "@/modules/planner/models";
import { Employee } from "@/modules/company/models";

function serializePunch(punch) {
  const employee = punch.employee || {};

  return {
    id: punch._id.toString(),
    employee: employee?._id ? serializeEmployee(employee) : null,
    employeeId: employee?._id?.toString?.() || String(punch.employee || ""),
    punchedAt: punch.punchedAt,
    punchedAtLabel: formatEcuadorDateTime(punch.punchedAt),
    rawValue: punch.rawValue || "",
    source: punch.source || "upload",
    note: punch.note || "",
    uploadId: punch.upload?.toString?.() || "",
    createdAt: punch.createdAt,
    updatedAt: punch.updatedAt,
  };
}

function serializeAudit(log) {
  return {
    id: log._id.toString(),
    actor: log.actor || "admin",
    action: log.action || "",
    entityId: log.entityId || "",
    entityLabel: log.entityLabel || "",
    details: log.details || {},
    happenedAt: log.happenedAt || log.createdAt,
  };
}

async function assertEmployeeActiveOnDate(employeeId, punchedAt) {
  const employee = await Employee.findById(employeeId);

  if (!employee || !isEmployeeActiveOnDate(employee, formatEcuadorDateKey(punchedAt))) {
    const error = new Error("Empleado vigente en la fecha no encontrado.");
    error.status = 404;
    throw error;
  }

  return employee;
}

function normalizeReason(value) {
  const reason = String(value || "").trim();

  if (reason.length < 4) {
    throw new Error("Ingresa un motivo claro para auditar el cambio.");
  }

  return reason;
}

function readPagination(searchParams) {
  const requestedPage = Number.parseInt(searchParams.get("page") || "1", 10);
  const requestedPageSize = Number.parseInt(searchParams.get("pageSize") || "50", 10);

  return {
    page: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize:
      Number.isFinite(requestedPageSize) && requestedPageSize >= 10
        ? Math.min(requestedPageSize, 100)
        : 50,
  };
}

export async function GET(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const searchParams = request.nextUrl.searchParams;
    const employeeId = String(searchParams.get("employeeId") || "").trim();
    const branchCode = String(searchParams.get("branchCode") || "").trim().toUpperCase();
    const range = resolvePunchRange(searchParams);
    const requestedPagination = readPagination(searchParams);

    const employeeQuery = {};

    if (employeeId) {
      employeeQuery._id = employeeId;
    }

    if (branchCode) {
      employeeQuery.branchCode = branchCode;
    }

    const shouldFilterEmployees = Boolean(employeeId || branchCode);
    const matchingEmployees = shouldFilterEmployees
      ? await Employee.find(employeeQuery)
          .select("_id")
          .lean()
      : [];
    const employeeIds = matchingEmployees.map((employee) => employee._id);

    const query = {
      punchedAt: {
        $gte: range.start,
        $lte: range.end,
      },
    };

    if (shouldFilterEmployees) {
      query.employee = { $in: employeeIds };
    }

    const total = await AttendancePunch.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / requestedPagination.pageSize));
    const page = Math.min(requestedPagination.page, totalPages);
    const skip = (page - 1) * requestedPagination.pageSize;

    const punches = await AttendancePunch.find(query)
      .populate("employee")
      .sort({ punchedAt: -1 })
      .skip(skip)
      .limit(requestedPagination.pageSize)
      .lean();

    const auditLogs = await Promise.all(
      punches.map((punch) =>
        AuditLog.find({
          entityType: "attendancePunch",
          entityId: punch._id.toString(),
        })
          .sort({ happenedAt: -1 })
          .limit(5)
          .lean(),
      ),
    );
    const auditsByPunch = new Map(
      punches.map((punch, index) => [
        punch._id.toString(),
        (auditLogs[index] || []).map(serializeAudit),
      ]),
    );

    return NextResponse.json({
      range: {
        start: range.start,
        end: range.end,
      },
      pagination: {
        page,
        pageSize: requestedPagination.pageSize,
        total,
        totalPages,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
      punches: punches.map((punch) => ({
        ...serializePunch(punch),
        audits: auditsByPunch.get(punch._id.toString()) || [],
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron cargar las picadas." },
      { status: error.status || 500 },
    );
  }
}

export async function POST(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const body = await request.json();
    const punchedAt = parsePunchDateTime(body?.punchedAt);
    const reason = normalizeReason(body?.reason);

    if (!punchedAt) {
      throw new Error("Ingresa una fecha y hora válida.");
    }

    const employee = await assertEmployeeActiveOnDate(String(body?.employeeId || "").trim(), punchedAt);

    const minuteRange = buildPunchMinuteRange(punchedAt);
    const existingPunch = minuteRange
      ? await AttendancePunch.findOne({
          employee: employee._id,
          punchedAt: {
            $gte: minuteRange.start,
            $lt: minuteRange.end,
          },
        }).lean()
      : null;

    if (existingPunch) {
      return NextResponse.json(
        { error: "Ya existe una picada para ese empleado en esa fecha, hora y minuto." },
        { status: 409 },
      );
    }

    const punch = await AttendancePunch.create({
      employee: employee._id,
      upload: null,
      punchedAt,
      rawValue: formatEcuadorDateTime(punchedAt),
      source: "manual",
      note: reason,
    });
    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "attendancePunch.create",
      entityType: "attendancePunch",
      entityId: punch._id.toString(),
      entityLabel: employee.fullName,
      route: "/api/planner/attendance/punches",
      details: {
        reason,
        after: {
          employeeId: employee._id.toString(),
          employeeName: employee.fullName,
          punchedAt,
          source: "manual",
        },
      },
    });

    const populatedPunch = await AttendancePunch.findById(punch._id).populate("employee").lean();

    return NextResponse.json(
      {
        punch: serializePunch(populatedPunch),
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo agregar la picada." },
      { status: error.status || 400 },
    );
  }
}
