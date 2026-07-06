import { NextResponse } from "next/server";

import { createAuditLog, resolveAuditActor } from "@/lib/audit";
import { isAuthenticated } from "@/lib/auth";
import {
  normalizeBranchPayload,
  resolveUniqueBranchCode,
  serializeBranch,
} from "@/modules/company/submodules/organization/lib/branches";
import connectToDatabase from "@/lib/db/mongodb";
import { Branch } from "@/modules/company/models";

export async function GET() {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  await connectToDatabase();

  const branches = await Branch.find({})
    .sort({ name: 1 })
    .lean();

  return NextResponse.json({
    branches: branches.map(serializeBranch),
  });
}

export async function POST(request) {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const body = await request.json();
    const payload = normalizeBranchPayload(body);
    const existingBranches = await Branch.find({}, { code: 1 }).lean();
    const code = resolveUniqueBranchCode(
      payload.code,
      existingBranches.map((branch) => branch.code),
      payload.name,
    );
    const branch = await Branch.create({
      ...payload,
      code,
    });
    const actor = await resolveAuditActor();

    await createAuditLog({
      actor,
      action: "branch.create",
      entityType: "branch",
      entityId: branch._id.toString(),
      entityLabel: branch.name,
      route: "/api/company/branches",
      details: {
        after: serializeBranch(branch),
      },
    });

    return NextResponse.json(
      {
        branch: serializeBranch(branch),
      },
      { status: 201 },
    );
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
      { error: error.message || "No se pudo crear la sucursal." },
      { status: 400 },
    );
  }
}
