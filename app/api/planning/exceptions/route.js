import { NextResponse } from "next/server";

import { getAuthenticatedUser, isAuthenticated } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import {
  buildMonthExceptionQuery,
  EXCEPTION_RESOLUTIONS,
  EXCEPTION_TYPES,
  normalizeExceptionPayload,
  serializeOperationalException,
} from "@/lib/planning/exceptions";
import Employee from "@/models/Employee";
import OperationalException from "@/models/OperationalException";

export async function GET(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const { searchParams } = new URL(request.url);
    const query = buildMonthExceptionQuery(searchParams.get("month"));

    const exceptions = await OperationalException.find(query)
      .sort({ date: -1, employeeName: 1 })
      .lean();

    return NextResponse.json({
      exceptions: exceptions.map(serializeOperationalException),
      options: {
        types: EXCEPTION_TYPES,
        resolutions: EXCEPTION_RESOLUTIONS,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudieron cargar las excepciones." },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesion invalida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const body = await request.json();
    const employeeId = String(body?.employeeId || "").trim();

    if (!employeeId) {
      throw new Error("Debes seleccionar un empleado.");
    }

    const employee = await Employee.findById(employeeId).lean();
    const user = await getAuthenticatedUser();
    const registeredBy = user?.employeeName || user?.username || user?.id || "SISTEMA";
    const payload = normalizeExceptionPayload({ ...body, registeredBy }, employee);
    const exception = await OperationalException.create(payload);

    return NextResponse.json(
      {
        message: "Excepcion registrada correctamente.",
        exception: serializeOperationalException(exception),
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo registrar la excepcion." },
      { status: 400 },
    );
  }
}
