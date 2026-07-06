import { NextResponse } from "next/server";
import { isValid, parseISO, startOfDay } from "date-fns";

import { isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { Employee } from "@/modules/company/models";
import { PayrollIncompleteDayDecision } from "@/modules/planner/models";
import { PayrollLateDecision } from "@/modules/planner/models";
import { PayrollSupplementaryDecision } from "@/modules/planner/models";

function parseDateValue(value) {
  if (!value) {
    return null;
  }

  const parsed = parseISO(String(value));
  return isValid(parsed) ? parsed : null;
}

function normalizeDecisionPayload(body) {
  const employeeId = String(body?.employeeId || "").trim();
  const decisions = Array.isArray(body?.decisions) ? body.decisions : [];
  const lateDecisions = Array.isArray(body?.lateDecisions) ? body.lateDecisions : [];
  const dayDecisions = Array.isArray(body?.dayDecisions) ? body.dayDecisions : [];

  if (!employeeId) {
    throw new Error("Debes indicar el empleado.");
  }

  if (!decisions.length && !lateDecisions.length && !dayDecisions.length) {
    throw new Error("No hay decisiones para guardar.");
  }

  return {
    employeeId,
    decisions: decisions.map((item) => {
      const date = parseDateValue(item?.date);
      const decision = String(item?.decision || "").trim();
      const scheduledEnd = parseDateValue(item?.scheduledEnd);
      const actualCheckOut = parseDateValue(item?.actualCheckOut);
      const candidateMinutes = Math.max(0, Number(item?.candidateMinutes) || 0);
      const candidateHours = Math.max(0, Number(item?.candidateHours) || 0);

      if (!date) {
        throw new Error("Una de las decisiones no tiene fecha válida.");
      }

      if (decision && !["supplementary", "not_applicable"].includes(decision)) {
        throw new Error("Una de las decisiones tiene un valor inválido.");
      }

      return {
        date: startOfDay(date),
        decision,
        scheduledEnd,
        actualCheckOut,
        candidateMinutes,
        candidateHours,
      };
    }),
    lateDecisions: lateDecisions.map((item) => {
      const date = parseDateValue(item?.date);
      const confirmed = Boolean(item?.confirmed);
      const scheduledStart = parseDateValue(item?.scheduledStart);
      const actualCheckIn = parseDateValue(item?.actualCheckIn);
      const lateMinutes = Math.max(0, Number(item?.lateMinutes) || 0);

      if (!date) {
        throw new Error("Uno de los atrasos no tiene fecha válida.");
      }

      return {
        date: startOfDay(date),
        confirmed,
        scheduledStart,
        actualCheckIn,
        lateMinutes,
      };
    }),
    dayDecisions: dayDecisions.map((item) => {
      const date = parseDateValue(item?.date);
      const decision = String(item?.decision || "").trim();
      const scheduledStart = parseDateValue(item?.scheduledStart);
      const scheduledEnd = parseDateValue(item?.scheduledEnd);
      const actualCheckIn = parseDateValue(item?.actualCheckIn);
      const punchCount = Math.max(0, Number(item?.punchCount) || 0);

      if (!date) {
        throw new Error("Uno de los días incompletos no tiene fecha válida.");
      }

      if (decision && !["valid_day", "absence"].includes(decision)) {
        throw new Error("Una de las resoluciones del día incompleto tiene un valor inválido.");
      }

      return {
        date: startOfDay(date),
        decision,
        punchCount,
        scheduledStart,
        scheduledEnd,
        actualCheckIn,
      };
    }),
  };
}

export async function POST(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const payload = normalizeDecisionPayload(body);

    await connectToDatabase();

    const employee = await Employee.findById(payload.employeeId).lean();

    if (!employee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    const supplementaryOperations = payload.decisions.map((item) => {
      if (!item.decision) {
        return {
          deleteOne: {
            filter: {
              employee: payload.employeeId,
              date: item.date,
            },
          },
        };
      }

      return {
        updateOne: {
          filter: {
            employee: payload.employeeId,
            date: item.date,
          },
          update: {
            $set: {
              decision: item.decision,
              candidateMinutes: item.candidateMinutes,
              candidateHours: item.candidateHours,
              scheduledEnd: item.scheduledEnd,
              actualCheckOut: item.actualCheckOut,
            },
            $setOnInsert: {
              employee: payload.employeeId,
              date: item.date,
            },
          },
          upsert: true,
        },
      };
    });

    const lateOperations = payload.lateDecisions.map((item) => {
      if (!item.confirmed) {
        return {
          deleteOne: {
            filter: {
              employee: payload.employeeId,
              date: item.date,
            },
          },
        };
      }

      return {
        updateOne: {
          filter: {
            employee: payload.employeeId,
            date: item.date,
          },
          update: {
            $set: {
              confirmed: true,
              lateMinutes: item.lateMinutes,
              scheduledStart: item.scheduledStart,
              actualCheckIn: item.actualCheckIn,
            },
            $setOnInsert: {
              employee: payload.employeeId,
              date: item.date,
            },
          },
          upsert: true,
        },
      };
    });

    const incompleteDayOperations = payload.dayDecisions.map((item) => {
      if (!item.decision) {
        return {
          deleteOne: {
            filter: {
              employee: payload.employeeId,
              date: item.date,
            },
          },
        };
      }

      return {
        updateOne: {
          filter: {
            employee: payload.employeeId,
            date: item.date,
          },
          update: {
            $set: {
              decision: item.decision,
              punchCount: item.punchCount,
              scheduledStart: item.scheduledStart,
              scheduledEnd: item.scheduledEnd,
              actualCheckIn: item.actualCheckIn,
            },
            $setOnInsert: {
              employee: payload.employeeId,
              date: item.date,
            },
          },
          upsert: true,
        },
      };
    });

    if (supplementaryOperations.length) {
      await PayrollSupplementaryDecision.bulkWrite(supplementaryOperations, { ordered: false });
    }

    if (lateOperations.length) {
      await PayrollLateDecision.bulkWrite(lateOperations, { ordered: false });
    }

    if (incompleteDayOperations.length) {
      await PayrollIncompleteDayDecision.bulkWrite(incompleteDayOperations, { ordered: false });
    }

    return NextResponse.json({
      success: true,
      savedDecisions:
        payload.decisions.length + payload.lateDecisions.length + payload.dayDecisions.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron guardar las decisiones de horas suplementarias." },
      { status: 400 },
    );
  }
}
