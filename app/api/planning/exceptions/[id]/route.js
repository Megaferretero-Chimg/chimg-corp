import { NextResponse } from "next/server";

import { getAuthenticatedUser, isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  normalizeExceptionPayload,
  serializeOperationalException,
} from "@/lib/planning/exceptions";
import Employee from "@/models/Employee";
import OperationalException from "@/models/OperationalException";

export async function PATCH(request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    const params = await context.params;
    const exceptionId = String(params?.id || "").trim();

    if (!exceptionId) {
      return NextResponse.json({ error: "Debes indicar una excepcion valida." }, { status: 400 });
    }

    await connectToDatabase();

    const body = await request.json();
    const employeeId = String(body?.employeeId || "").trim();
    const employee = await Employee.findById(employeeId).lean();
    const user = await getAuthenticatedUser();
    const registeredBy = user?.employeeName || user?.username || user?.id || "SISTEMA";
    const payload = normalizeExceptionPayload({ ...body, registeredBy }, employee);
    const exception = await OperationalException.findByIdAndUpdate(exceptionId, payload, {
      new: true,
      runValidators: true,
    });

    if (!exception) {
      return NextResponse.json({ error: "Excepcion no encontrada." }, { status: 404 });
    }

    return NextResponse.json({
      message: "Excepcion actualizada correctamente.",
      exception: serializeOperationalException(exception),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo actualizar la excepcion." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  const params = await context.params;
  const exceptionId = String(params?.id || "").trim();

  if (!exceptionId) {
    return NextResponse.json({ error: "Debes indicar una excepcion valida." }, { status: 400 });
  }

  await connectToDatabase();

  const exception = await OperationalException.findByIdAndUpdate(
    exceptionId,
    { $set: { status: "void" } },
    { new: true },
  );

  if (!exception) {
    return NextResponse.json({ error: "Excepcion no encontrada." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
