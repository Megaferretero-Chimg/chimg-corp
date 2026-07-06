import { NextResponse } from "next/server";
import {
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parse,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { serializeEmployee } from "@/modules/company/submodules/people/lib/employees";
import comparePayrollPunches from "@/modules/planner/lib/payroll/comparePayrollPunches";
import { AttendancePunch } from "@/modules/planner/models";
import { Employee } from "@/modules/company/models";
import { PayrollIncompleteDayDecision } from "@/modules/planner/models";
import { PayrollLateDecision } from "@/modules/planner/models";
import { PayrollSupplementaryDecision } from "@/modules/planner/models";
import { WorkSchedule } from "@/modules/planner/models";

function parseDateParam(value) {
  if (!value) {
    return null;
  }

  const parsed = parseISO(String(value));
  return isValid(parsed) ? parsed : null;
}

function parseMonthParam(value) {
  if (!value) {
    return null;
  }

  const parsed = parse(String(value), "yyyy-MM", new Date());
  return isValid(parsed) ? parsed : null;
}

function parseWeekParam(value) {
  if (!value) {
    return null;
  }

  const parsed = parse(String(value), "RRRR-'W'II", new Date());
  return isValid(parsed) ? parsed : null;
}

function resolveRange(searchParams) {
  const mode = String(searchParams.get("mode") || "month").trim();
  const dayDate = parseDateParam(searchParams.get("date"));
  const weekDate = parseWeekParam(searchParams.get("week"));
  const monthDate = parseMonthParam(searchParams.get("month"));
  const from = parseDateParam(searchParams.get("from"));
  const to = parseDateParam(searchParams.get("to"));

  if (mode === "day") {
    const baseDate = dayDate || new Date();

    return {
      mode,
      start: startOfDay(baseDate),
      end: endOfDay(baseDate),
    };
  }

  if (mode === "week") {
    const baseDate = weekDate || dayDate || new Date();

    return {
      mode,
      start: startOfWeek(baseDate, { weekStartsOn: 1 }),
      end: endOfWeek(baseDate, { weekStartsOn: 1 }),
    };
  }

  if (mode === "custom") {
    if (!from || !to) {
      throw new Error("Debes indicar fecha inicial y final para el rango personalizado.");
    }

    return {
      mode,
      start: startOfDay(from),
      end: endOfDay(to),
    };
  }

  if (mode === "month") {
    const baseDate = monthDate || dayDate || new Date();

    return {
      mode,
      start: startOfMonth(baseDate),
      end: endOfMonth(baseDate),
    };
  }

  return {
    mode: "month",
    start: startOfMonth(new Date()),
    end: endOfMonth(new Date()),
  };
}

export async function GET(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    const employeeId = String(request.nextUrl.searchParams.get("employeeId") || "").trim();

    if (!employeeId) {
      throw new Error("Debes seleccionar un empleado.");
    }

    const range = resolveRange(request.nextUrl.searchParams);

    await connectToDatabase();

    const employee = await Employee.findById(employeeId).lean();

    if (!employee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    const punches = await AttendancePunch.find({
      employee: employeeId,
      punchedAt: {
        $gte: range.start,
        $lte: range.end,
      },
    })
      .sort({ punchedAt: 1 })
      .lean();

    const weekKeys = [
      ...new Set(
        eachDayOfInterval({
          start: startOfDay(range.start),
          end: startOfDay(range.end),
        }).map((date) => format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd")),
      ),
    ];

    const schedules = await WorkSchedule.find({
      employee: employeeId,
      weekKey: { $in: weekKeys },
    }).lean();

    const comparison = comparePayrollPunches({
      start: range.start,
      end: range.end,
      punches,
      schedules,
    });

    const [supplementaryDecisions, lateDecisions, incompleteDayDecisions] = await Promise.all([
      PayrollSupplementaryDecision.find({
        employee: employeeId,
        date: {
          $gte: startOfDay(range.start),
          $lte: startOfDay(range.end),
        },
      }).lean(),
      PayrollLateDecision.find({
        employee: employeeId,
        date: {
          $gte: startOfDay(range.start),
          $lte: startOfDay(range.end),
        },
      }).lean(),
      PayrollIncompleteDayDecision.find({
        employee: employeeId,
        date: {
          $gte: startOfDay(range.start),
          $lte: startOfDay(range.end),
        },
      }).lean(),
    ]);

    const supplementaryByDate = new Map(
      supplementaryDecisions.map((item) => [
        format(item.date, "yyyy-MM-dd"),
        {
          decision: item.decision,
          candidateMinutes: item.candidateMinutes || 0,
          candidateHours: item.candidateHours || 0,
        },
      ]),
    );

    const lateByDate = new Map(
      lateDecisions.map((item) => [
        format(item.date, "yyyy-MM-dd"),
        {
          confirmed: Boolean(item.confirmed),
          lateMinutes: item.lateMinutes || 0,
        },
      ]),
    );

    const incompleteDayByDate = new Map(
      incompleteDayDecisions.map((item) => [
        format(item.date, "yyyy-MM-dd"),
        {
          decision: item.decision,
          punchCount: item.punchCount || 0,
        },
      ]),
    );

    return NextResponse.json({
      employee: serializeEmployee(employee),
      range: {
        mode: range.mode,
        start: range.start,
        end: range.end,
      },
      summary: {
        totalPunches: punches.length,
      },
      scheduleCoverage: {
        isComplete: comparison.isComplete,
        missingScheduleDates: comparison.missingScheduleDates,
      },
      dailyComparisons: comparison.comparisons.map((day) => {
        const savedDecision = supplementaryByDate.get(day.dateKey);
        const savedLate = lateByDate.get(day.dateKey);
        const savedIncompleteDay = incompleteDayByDate.get(day.dateKey);

        return {
          ...day,
          savedSupplementaryDecision: savedDecision?.decision || "",
          savedSupplementaryHours: savedDecision?.candidateHours || 0,
          savedLateConfirmation: savedLate?.confirmed || false,
          savedLateMinutes: savedLate?.lateMinutes || 0,
          savedIncompleteDayDecision: savedIncompleteDay?.decision || "",
        };
      }),
      punches: punches.map((punch) => ({
        id: punch._id.toString(),
        punchedAt: punch.punchedAt,
        rawValue: punch.rawValue,
        uploadId: punch.upload?.toString?.() || "",
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron consultar las picadas." },
      { status: 400 },
    );
  }
}
