function normalizeDateValue(value, fieldLabel = "fecha") {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return null;
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)
    ? new Date(`${normalizedValue}T12:00:00.000Z`)
    : new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`La ${fieldLabel} no es valida.`);
  }

  return date;
}

function normalizeRoleAssignments(body) {
  const sourceAssignments = Array.isArray(body?.roleAssignments)
    ? body.roleAssignments
    : Array.isArray(body?.roles)
      ? body.roles
      : [];
  const assignments = sourceAssignments
    .map((role, index) => ({
      code: String(role?.code || role?.roleCode || "").trim(),
      name: String(role?.name || role?.roleName || "").trim().toUpperCase(),
      areaCode: String(role?.areaCode || "").trim(),
      areaName: String(role?.areaName || "").trim().toUpperCase(),
      isPrimary: Boolean(role?.isPrimary) || index === 0,
    }))
    .filter((role) => role.code && role.name);

  if (!assignments.length && body?.roleCode) {
    assignments.push({
      code: String(body.roleCode || "").trim(),
      name: String(body.roleName || "").trim().toUpperCase(),
      areaCode: String(body.areaCode || "").trim(),
      areaName: String(body.areaName || "").trim().toUpperCase(),
      isPrimary: true,
    });
  }

  return assignments.map((role, index) => ({
    ...role,
    isPrimary: index === 0,
  }));
}

const EMPLOYMENT_RELATION_VALUES = new Set(["nomina", "prestacion_servicios"]);

function normalizeEmploymentRelation(value) {
  const normalizedValue = String(value || "nomina").trim().toLowerCase();

  return EMPLOYMENT_RELATION_VALUES.has(normalizedValue) ? normalizedValue : "nomina";
}

function normalizeDni(value, documentType = "cedula") {
  const normalizedValue = String(value || "").trim().toUpperCase();

  if (String(documentType || "").trim().toLowerCase() === "cedula" && /^\d{9}$/.test(normalizedValue)) {
    return normalizedValue.padStart(10, "0");
  }

  return normalizedValue;
}

function normalizeBiometricAliases(body) {
  const aliases = Array.isArray(body?.biometricAliases) ? body.biometricAliases : [];
  const seenKeys = new Set();

  return aliases
    .map((alias) => ({
      branchCode: String(alias?.branchCode || "").trim().toUpperCase(),
      branchName: String(alias?.branchName || alias?.branchCode || "").trim().toUpperCase(),
      biometricCode: String(alias?.biometricCode || "").trim(),
    }))
    .filter((alias) => alias.branchCode && alias.biometricCode)
    .filter((alias) => {
      const key = `${alias.branchCode}|${alias.biometricCode}`;

      if (seenKeys.has(key)) {
        return false;
      }

      seenKeys.add(key);
      return true;
    });
}

export function normalizeEmployeePayload(body) {
  const fullName = String(body?.fullName || "").trim().toUpperCase();
  const salary = Number(body?.salary || 0);

  if (!fullName) {
    throw new Error("El nombre completo es obligatorio.");
  }

  if (!Number.isFinite(salary) || salary < 0) {
    throw new Error("El sueldo debe ser un numero valido mayor o igual a 0.");
  }

  const branchCode = String(body?.branchCode || body?.branch || "").trim().toUpperCase();
  const branchName = String(body?.branchName || body?.branch || "").trim().toUpperCase();
  const roleAssignments = normalizeRoleAssignments(body);
  const areaCode = String(body?.areaCode || "").trim();
  const areaName = String(body?.areaName || "").trim().toUpperCase();
  const roleCode = String(body?.roleCode || "").trim();
  const roleName = String(body?.roleName || "").trim().toUpperCase();

  const documentType = String(body?.documentType || "cedula").trim().toLowerCase() || "cedula";

  return {
    documentType,
    dni: normalizeDni(body?.dni, documentType),
    fullName,
    personalEmail: String(body?.personalEmail || "").trim().toLowerCase(),
    address: String(body?.address || "").trim(),
    phone: String(body?.phone || "").trim(),
    employmentRelation: normalizeEmploymentRelation(body?.employmentRelation),
    branchId: String(body?.branchId || "").trim(),
    branchCode,
    branchName,
    branch: branchName || branchCode,
    areaCode,
    areaName,
    roleCode,
    roleName,
    roleAssignments,
    department: areaName || String(body?.department || "").trim().toUpperCase(),
    salary,
    birthDate: normalizeDateValue(body?.birthDate, "fecha de nacimiento"),
    employmentStartDate: normalizeDateValue(body?.employmentStartDate, "fecha de ingreso"),
    biometricCode: String(body?.biometricCode || "").trim(),
    biometricAliases: normalizeBiometricAliases(body),
    isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
  };
}

export function serializeEmployee(employee) {
  const areaName = employee.areaName || employee.department || "";
  const roleName = employee.roleName || "";
  const roleAssignments = (employee.roleAssignments || []).map((role, index) => ({
    code: role.code || "",
    name: role.name || "",
    areaCode: role.areaCode || "",
    areaName: role.areaName || "",
    isPrimary: Boolean(role.isPrimary) || index === 0,
  }));
  const organizationLabel = [areaName, roleName].filter(Boolean).join(" · ");

  return {
    id: employee._id.toString(),
    documentType: employee.documentType || "cedula",
    dni: employee.dni || "",
    fullName: employee.fullName || "",
    personalEmail: employee.personalEmail || "",
    address: employee.address || "",
    phone: employee.phone || "",
    employmentRelation: employee.employmentRelation || "nomina",
    branchId: employee.branchId || "",
    branchCode: employee.branchCode || "",
    branchName: employee.branchName || employee.branch || "",
    branch: employee.branchName || employee.branch || employee.branchCode || "",
    areaCode: employee.areaCode || "",
    areaName,
    roleCode: employee.roleCode || "",
    roleName,
    roleAssignments,
    organizationLabel,
    salary: employee.salary || 0,
    birthDate: employee.birthDate ? employee.birthDate.toISOString().slice(0, 10) : "",
    employmentStartDate: employee.employmentStartDate ? employee.employmentStartDate.toISOString().slice(0, 10) : "",
    terminationDate: employee.terminationDate ? employee.terminationDate.toISOString().slice(0, 10) : "",
    biometricCode: employee.biometricCode || "",
    biometricAliases: (employee.biometricAliases || []).map((alias) => ({
      branchCode: alias.branchCode || "",
      branchName: alias.branchName || alias.branchCode || "",
      biometricCode: alias.biometricCode || "",
    })),
    department: employee.department || "",
    isActive: employee.isActive !== false,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}
