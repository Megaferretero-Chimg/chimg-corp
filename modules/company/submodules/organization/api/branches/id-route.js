import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { isAuthenticated } from "@/lib/auth";
import {
  normalizeBranchPayload,
  serializeBranch,
} from "@/modules/company/submodules/organization/lib/branches";
import connectToDatabase from "@/lib/db/mongodb";
import { Branch } from "@/modules/company/models";

export async function PATCH(request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const { id } = await context.params;
    const body = await request.json();
    const existingBranch = await Branch.findById(id).lean();

    if (!existingBranch) {
      return NextResponse.json({ error: "Sucursal no encontrada." }, { status: 404 });
    }

    const payload = normalizeBranchPayload(body);
    const code = existingBranch.code;

    const branch = await Branch.findByIdAndUpdate(id, { ...payload, code }, {
      new: true,
      runValidators: true,
    });
    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "branch.update",
      entityType: "branch",
      entityId: branch._id.toString(),
      entityLabel: branch.name,
      route: `/api/company/branches/${id}`,
      details: {
        before: serializeBranch(existingBranch),
        after: serializeBranch(branch),
      },
    });

    return NextResponse.json({
      branch: serializeBranch(branch),
    });
  } catch (error) {
    if (error?.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const message =
        field === "code"
          ? "Ya existe una sucursal con ese código."
          : "Ya existe una sucursal con ese nombre.";

      return NextResponse.json({ error: message }, { status: 409 });
    }

    return NextResponse.json(
      { error: error.message || "No se pudo actualizar la sucursal." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request, context) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  await connectToDatabase();
  const { id } = await context.params;
  const branch = await Branch.findByIdAndDelete(id);

  if (!branch) {
    return NextResponse.json({ error: "Sucursal no encontrada." }, { status: 404 });
  }
  const actor = await resolveAuditActor();

  await createAuditLog({
    actor,
    action: "branch.delete",
    entityType: "branch",
    entityId: branch._id.toString(),
    entityLabel: branch.name,
    route: `/api/company/branches/${id}`,
    details: {
      deleted: serializeBranch(branch),
    },
  });

  return NextResponse.json({ success: true });
}
