import { NextResponse } from "next/server";

import { createAuditLog } from "@/lib/audit";
import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { parseMonthKey } from "@/modules/planner/lib/planning/holidays";
import { Employee } from "@/modules/company/models";
import { PayrollPayment } from "@/modules/planner/models";

const PAYMENT_METHODS = new Set(["transferencia", "efectivo", "cheque", "deposito", "otro"]);

function serializePayment(payment) {
  if (!payment) {
    return null;
  }

  return {
    id: payment._id.toString(),
    employeeId: payment.employee?.toString?.() || "",
    employeeName: payment.employeeName || "",
    monthKey: payment.monthKey || "",
    status: payment.status || "paid",
    isPaid: payment.status === "paid",
    amount: Number(payment.amount) || 0,
    paymentMethod: payment.paymentMethod || "",
    notes: payment.notes || "",
    paidBy: payment.paidBy || "",
    paidAt: payment.paidAt || null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

function normalizePayload(body) {
  const employeeId = String(body?.employeeId || "").trim();
  const { monthKey } = parseMonthKey(body?.month);
  const paymentMethod = String(body?.paymentMethod || "").trim();
  const amount = Math.max(0, Math.round((Number(body?.amount) || 0) * 100) / 100);

  if (!employeeId) {
    throw new Error("Debes indicar el empleado.");
  }

  if (!PAYMENT_METHODS.has(paymentMethod)) {
    throw new Error("Selecciona un método de pago válido.");
  }

  return {
    employeeId,
    monthKey,
    paymentMethod,
    amount,
    notes: String(body?.notes || "").trim().slice(0, 500),
  };
}

export async function GET(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const { searchParams } = new URL(request.url);
    const { monthKey } = parseMonthKey(searchParams.get("month"));
    const employeeId = String(searchParams.get("employeeId") || "").trim();
    const query = { monthKey };

    if (employeeId) {
      query.employee = employeeId;
    }

    const payments = await PayrollPayment.find(query).sort({ employeeName: 1 }).lean();

    return NextResponse.json({
      monthKey,
      payment: employeeId ? serializePayment(payments[0]) : null,
      payments: payments.map(serializePayment),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo cargar el estado de pagos." },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    const payload = normalizePayload(await request.json());

    await connectToDatabase();

    const employee = await Employee.findById(payload.employeeId).select("_id fullName").lean();

    if (!employee) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    const actor = user.employeeName || user.username || user.id;
    const previousPayment = await PayrollPayment.findOne({
      employee: payload.employeeId,
      monthKey: payload.monthKey,
    }).lean();

    await PayrollPayment.updateOne(
      {
        employee: payload.employeeId,
        monthKey: payload.monthKey,
      },
      {
        $set: {
          employeeName: employee.fullName || "",
          status: "paid",
          amount: payload.amount,
          paymentMethod: payload.paymentMethod,
          notes: payload.notes,
          paidBy: actor,
          paidAt: new Date(),
        },
        $setOnInsert: {
          employee: payload.employeeId,
          monthKey: payload.monthKey,
        },
      },
      { upsert: true },
    );

    const savedPayment = await PayrollPayment.findOne({
      employee: payload.employeeId,
      monthKey: payload.monthKey,
    }).lean();

    await createAuditLog({
      actor,
      action: "payrollPayment.upsert",
      entityType: "payrollPayment",
      entityId: savedPayment?._id?.toString?.() || "",
      entityLabel: `${employee.fullName || payload.employeeId} ${payload.monthKey}`,
      route: "/api/planner/payroll/payments",
      details: {
        employeeId: payload.employeeId,
        employeeName: employee.fullName || "",
        monthKey: payload.monthKey,
        before: previousPayment ? serializePayment(previousPayment) : null,
        after: serializePayment(savedPayment),
      },
    });

    return NextResponse.json({
      success: true,
      payment: serializePayment(savedPayment),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo registrar el pago." },
      { status: 400 },
    );
  }
}
