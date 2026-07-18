import { NextResponse } from "next/server";

import { createAuditLog } from "@/lib/audit";
import connectToDatabase from "@/lib/db/mongodb";
import { User } from "@/modules/company/models";
import {
  hashPassword,
  normalizeUsername,
  verifyPassword,
} from "@/modules/company/submodules/access/lib/users";

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;

export async function POST(request) {
  try {
    const body = await request.json();
    const username = normalizeUsername(body?.username);
    const currentPassword = String(body?.currentPassword || "");
    const newPassword = String(body?.newPassword || "");

    if (!username || !currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Completa el usuario, la contraseña actual y la nueva." },
        { status: 400 },
      );
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: "La nueva contraseña debe tener al menos 6 caracteres." },
        { status: 400 },
      );
    }

    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: "La nueva contraseña no puede superar los 128 caracteres." },
        { status: 400 },
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "La nueva contraseña debe ser diferente a la actual." },
        { status: 400 },
      );
    }

    await connectToDatabase();

    const user = await User.findOne({ username }).select(
      "_id username employeeName passwordHash isActive",
    );

    if (
      !user ||
      user.isActive === false ||
      !verifyPassword(currentPassword, user.passwordHash)
    ) {
      return NextResponse.json(
        { error: "El usuario o la contraseña actual no son correctos." },
        { status: 401 },
      );
    }

    const previousPasswordHash = user.passwordHash;
    const passwordHash = hashPassword(newPassword);
    const updateResult = await User.updateOne(
      { _id: user._id, passwordHash: previousPasswordHash },
      { $set: { passwordHash } },
    );

    if (updateResult.modifiedCount !== 1) {
      return NextResponse.json(
        { error: "La contraseña cambió durante esta solicitud. Inténtalo nuevamente." },
        { status: 409 },
      );
    }

    await createAuditLog({
      actor: user.employeeName || user.username,
      action: "userAccess.changePassword",
      entityType: "user",
      entityId: user._id.toString(),
      entityLabel: user.username,
      route: "/api/auth/change-password",
      details: { source: "login" },
    });

    return NextResponse.json({
      success: true,
      message: "Contraseña actualizada. Ya puedes iniciar sesión.",
    });
  } catch {
    return NextResponse.json(
      { error: "No se pudo cambiar la contraseña." },
      { status: 500 },
    );
  }
}
