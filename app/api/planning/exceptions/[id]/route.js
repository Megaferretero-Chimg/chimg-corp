import { NextResponse } from "next/server";

import { getAuthenticatedUser, isAuthenticated } from "@/lib/auth";
import { PLANNING_EXCEPTIONS_ACCESS_ROLE } from "@/lib/access-roles";
import connectToDatabase from "@/lib/db/mongodb";
import {
  normalizeExceptionPayload,
  serializeOperationalException,
} from "@/lib/planning/exceptions";
import { deleteExceptionManualPunch, syncExceptionManualPunch } from "@/lib/planning/exceptionPunches";
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

    if (user?.accessRole === PLANNING_EXCEPTIONS_ACCESS_ROLE) {
      return NextResponse.json(
        { error: "Este perfil solo puede crear excepciones pendientes. Recursos Humanos debe aprobar, modificar o anular." },
        { status: 403 },
      );
    }

    const registeredBy = user?.employeeName || user?.username || user?.id || "SISTEMA";
    const payload = normalizeExceptionPayload({ ...body, registeredBy }, employee);
    const currentException = await OperationalException.findById(exceptionId).lean();

    if (!currentException) {
      return NextResponse.json({ error: "Excepcion no encontrada." }, { status: 404 });
    }

    const exception = await OperationalException.findByIdAndUpdate(exceptionId, {
      ...payload,
      manualPunch: currentException.manualPunch || null,
    }, {
      new: true,
      runValidators: true,
    });

    try {
      await syncExceptionManualPunch(exception);
    } catch (syncError) {
      await OperationalException.replaceOne({ _id: currentException._id }, currentException);
      throw syncError;
    }

    const savedException = await OperationalException.findById(exception._id).lean();

    return NextResponse.json({
      message: "Excepcion actualizada correctamente.",
      exception: serializeOperationalException(savedException),
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

  const user = await getAuthenticatedUser();

  if (user?.accessRole === PLANNING_EXCEPTIONS_ACCESS_ROLE) {
    return NextResponse.json(
      { error: "Este perfil no puede anular excepciones. Recursos Humanos debe revisar el registro." },
      { status: 403 },
    );
  }

  const exception = await OperationalException.findByIdAndUpdate(
    exceptionId,
    { $set: { status: "void" } },
    { new: true },
  );

  if (!exception) {
    return NextResponse.json({ error: "Excepcion no encontrada." }, { status: 404 });
  }

  await deleteExceptionManualPunch(exception);

  return NextResponse.json({ success: true });
}
