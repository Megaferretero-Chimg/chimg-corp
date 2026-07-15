import { NextResponse } from "next/server";
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  isValid,
  parse,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { serializeEmployee } from "@/modules/company/submodules/people/lib/employees";
import calculatePayrollEstimate from "@/modules/planner/lib/payroll/calculatePayrollEstimate";
import {
  DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES,
  ECUADOR_DAILY_BASE_HOURS,
} from "@/modules/planner/lib/payroll/laborConstants";
import { resolveMonthlyBaseHours } from "@/modules/planner/lib/payroll/monthlyBaseHours";
import { AttendanceDayDecision, AttendancePunch } from "@/modules/planner/models";
import { Employee, Role } from "@/modules/company/models";
import { PayrollIncompleteDayDecision } from "@/modules/planner/models";
import { PayrollLateDecision } from "@/modules/planner/models";
import { PayrollSupplementaryDecision } from "@/modules/planner/models";
import { ScheduleRuleConfig } from "@/modules/planner/models";
import { ScheduleAssignment } from "@/modules/planner/models";
import { WorkSchedule } from "@/modules/planner/models";

function parseMonthParam(value) {
  if (!value) {
    return null;
  }

  const parsed = parse(String(value), "yyyy-MM", new Date());
  return isValid(parsed) ? parsed : null;
}

function schedulesFromAssignments(assignments = []) {
  return assignments.flatMap((assignment) => (assignment.generatedDays || []).map((day) => {
    const date = parseISO(day.dateKey);
    const dayType = day.dayType || "workday";

    return {
      ...day,
      weekKey: format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      dayOfWeek: Number.isInteger(day.dayOfWeek) ? day.dayOfWeek : date.getDay(),
      dayType,
      hasLunch: (Number(day.lunchDurationMinutes) || 0) > 0,
      isWorkingDay: ["workday", "weekend_overtime"].includes(dayType),
      isPaidDay: ["vacation", "holiday"].includes(dayType),
      authorizedExtraMinutes: Math.max(0, Number(day.authorizedExtraMinutes) || 0),
    };
  }));
}

function mergeSchedules(workSchedules = [], assignmentSchedules = []) {
  const schedulesByDay = new Map(
    workSchedules.map((schedule) => [`${schedule.weekKey}-${schedule.dayOfWeek}`, schedule]),
  );

  assignmentSchedules.forEach((schedule) => {
    schedulesByDay.set(`${schedule.weekKey}-${schedule.dayOfWeek}`, schedule);
  });

  return [...schedulesByDay.values()];
}

export async function GET(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    const employeeId = String(request.nextUrl.searchParams.get("employeeId") || "").trim();
    const month = parseMonthParam(request.nextUrl.searchParams.get("month"));

    if (!employeeId) {
      throw new Error("Debes indicar el empleado.");
    }

    if (!month) {
      throw new Error("Debes indicar el mes a estimar.");
    }

    await connectToDatabase();

    const employee = await Employee.findById(employeeId).lean();

    if (!employee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);

    const weekKeys = [
      ...new Set(
        eachDayOfInterval({ start: monthStart, end: monthEnd }).map((date) =>
          format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        ),
      ),
    ];

    const monthKey = format(month, "yyyy-MM");
    const [role, workSchedules, assignments, punches, scheduleRuleConfig, supplementaryDecisions, attendanceDecisions, lateDecisions, incompleteDayDecisions] =
      await Promise.all([
      Role.findOne({ code: employee.roleCode }).lean(),
      WorkSchedule.find({
        employee: employeeId,
        weekKey: { $in: weekKeys },
      }).lean(),
      ScheduleAssignment.find({
        employee: employeeId,
        monthKey,
      }).lean(),
      AttendancePunch.find({
        employee: employeeId,
        isIgnored: { $ne: true },
        punchedAt: {
          $gte: monthStart,
          $lte: monthEnd,
        },
      })
        .sort({ punchedAt: 1 })
        .lean(),
      ScheduleRuleConfig.findOne({ key: "default" }).lean(),
      PayrollSupplementaryDecision.find({
        employee: employeeId,
        date: {
          $gte: monthStart,
          $lte: monthEnd,
        },
      }).lean(),
      AttendanceDayDecision.find({
        employee: employeeId,
        date: {
          $gte: monthStart,
          $lte: monthEnd,
        },
      }).lean(),
      PayrollLateDecision.find({
        employee: employeeId,
        date: {
          $gte: monthStart,
          $lte: monthEnd,
        },
      }).lean(),
      PayrollIncompleteDayDecision.find({
        employee: employeeId,
        date: {
          $gte: monthStart,
          $lte: monthEnd,
        },
      }).lean(),
    ]);
    const payrollEmployee = {
      ...employee,
      punchesAffectHours: role?.punchesAffectHours !== false,
    };
    const schedules = mergeSchedules(workSchedules, schedulesFromAssignments(assignments));

    if (!schedules.length) {
      return NextResponse.json({
        employee: serializeEmployee(payrollEmployee, { rolesByCode: new Map([[String(role?.code || "").trim().toUpperCase(), role]]) }),
        month: {
          value: format(month, "yyyy-MM"),
        },
        summary: null,
        rows: [],
        message: "No hay horarios configurados para este empleado en ese mes.",
      });
    }

    const supplementaryByDate = new Map(
      supplementaryDecisions.map((item) => [
        format(item.date, "yyyy-MM-dd"),
        {
          decision: item.decision,
          candidateHours: item.candidateHours || 0,
          candidateMinutes: item.candidateMinutes || 0,
        },
      ]),
    );

    const attendanceDecisionsByDate = new Map(
      attendanceDecisions.map((item) => [
        item.dateKey || format(item.date, "yyyy-MM-dd"),
        {
          additionalResolved: item.additionalResolved === true,
          authorizedSupplementaryMinutes: item.authorizedSupplementaryMinutes || 0,
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

    const estimate = calculatePayrollEstimate({
      employee: payrollEmployee,
      monthDate: month,
      punches,
      schedules,
      monthlyBaseHours: (await resolveMonthlyBaseHours({
        monthKey: format(month, "yyyy-MM"),
        year: month.getFullYear(),
        monthIndex: month.getMonth(),
        dailyBaseHours: ECUADOR_DAILY_BASE_HOURS,
      })).hourlyDivisor,
      scheduleRules: {
        lateDepartureToleranceMinutes: Number(
          scheduleRuleConfig?.lateDepartureToleranceMinutes ?? DEFAULT_LATE_DEPARTURE_TOLERANCE_MINUTES,
        ),
      },
      supplementaryByDate,
      attendanceDecisionsByDate,
      lateByDate,
      incompleteDayByDate,
    });

    return NextResponse.json(estimate);
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo calcular la estimación de nómina." },
      { status: 400 },
    );
  }
}
