import { Employee } from "@/modules/company/models";
import { getEmployeeBiometricEntries } from "@/modules/company/submodules/people/lib/employees";

export async function assertEmployeeBiometricCodesAvailable(
  employee,
  { excludeEmployeeId = "" } = {},
) {
  const entries = getEmployeeBiometricEntries(employee);

  if (!entries.length) {
    return;
  }

  const query = {
    $or: entries.flatMap(({ branchCode, biometricCode }) => [
      { branchCode, biometricCode },
      {
        biometricAliases: {
          $elemMatch: { branchCode, biometricCode },
        },
      },
    ]),
  };

  if (excludeEmployeeId) {
    query._id = { $ne: excludeEmployeeId };
  }

  const conflict = await Employee.findOne(query)
    .select({ fullName: 1, branchCode: 1, biometricCode: 1, biometricAliases: 1 })
    .lean();

  if (!conflict) {
    return;
  }

  const conflictEntries = new Set(
    getEmployeeBiometricEntries(conflict)
      .map(({ branchCode, biometricCode }) => `${branchCode}|${biometricCode}`),
  );
  const duplicatedEntry = entries.find(({ branchCode, biometricCode }) =>
    conflictEntries.has(`${branchCode}|${biometricCode}`),
  );
  const error = new Error(
    `El código biométrico ${duplicatedEntry?.biometricCode || ""} ya está asignado en `
    + `${duplicatedEntry?.branchCode || "esa sucursal"} a ${conflict.fullName || "otro empleado"}.`,
  );

  error.code = "BIOMETRIC_CODE_CONFLICT";
  throw error;
}
