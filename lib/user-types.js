export const DEFAULT_USER_TYPES = [
  {
    code: "admin",
    name: "Administrador",
    description: "Acceso general a la administración del sistema.",
    isActive: true,
  },
  {
    code: "supervisor",
    name: "Supervisor",
    description: "Acceso operativo para supervisión y seguimiento.",
    isActive: true,
  },
  {
    code: "operator",
    name: "Operador",
    description: "Acceso de operación diaria con funciones limitadas.",
    isActive: true,
  },
  {
    code: "planning_exceptions",
    name: "Ajustes y excepciones",
    description: "Acceso limitado al módulo de planificación, solo para revisar y registrar ajustes y excepciones.",
    isActive: true,
  },
  {
    code: "viewer",
    name: "Consulta",
    description: "Acceso de lectura y revisión básica.",
    isActive: true,
  },
];

export const PROTECTED_USER_TYPE_CODES = new Set(["admin"]);

function slugifyTypeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s_-]/g, " ")
    .trim();
}

export function normalizeUserTypeCode(value) {
  return slugifyTypeText(value)
    .replace(/[\s_-]+/g, "_")
    .toLowerCase();
}

export function isProtectedUserTypeCode(value) {
  return PROTECTED_USER_TYPE_CODES.has(normalizeUserTypeCode(value));
}

export function normalizeUserTypePayload(body) {
  const name = String(body?.name || "").trim();
  const code = normalizeUserTypeCode(body?.code || name);
  const description = String(body?.description || "").trim();

  if (!name) {
    throw new Error("El nombre del tipo de usuario es obligatorio.");
  }

  if (!code) {
    throw new Error("No se pudo generar el código del tipo de usuario.");
  }

  if (isProtectedUserTypeCode(code)) {
    throw new Error("El rol de acceso Administrador está protegido y no se puede modificar.");
  }

  return {
    code,
    name,
    description,
    isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
  };
}

export function serializeUserType(userType) {
  return {
    id: userType._id.toString(),
    code: userType.code || "",
    name: userType.name || "",
    description: userType.description || "",
    isActive: userType.isActive !== false,
    isProtected: isProtectedUserTypeCode(userType.code),
    createdAt: userType.createdAt,
    updatedAt: userType.updatedAt,
  };
}
