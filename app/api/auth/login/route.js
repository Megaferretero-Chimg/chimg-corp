import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { PLANNING_EXCEPTIONS_ACCESS_ROLE } from "@/lib/access-roles";
import {
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
  validateCredentials,
} from "@/lib/auth";
import { planningModulePath } from "@/lib/modules/planning/routes";

export async function POST(request) {
  try {
    const body = await request.json();
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");

    const session = await validateCredentials(username, password);

    if (!session) {
      return NextResponse.json(
        { error: "Usuario o clave incorrectos." },
        { status: 401 },
      );
    }

    const cookieStore = await cookies();
    cookieStore.set(
      SESSION_COOKIE_NAME,
      session.token,
      getSessionCookieOptions(),
    );

    const redirectTo = session.accessRole === PLANNING_EXCEPTIONS_ACCESS_ROLE
      ? planningModulePath("/planning/exceptions")
      : "/modules";

    return NextResponse.json({ success: true, redirectTo });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo iniciar sesión." },
      { status: 500 },
    );
  }
}
