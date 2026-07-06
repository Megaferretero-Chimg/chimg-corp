const DEFAULT_ATTENDANCE_PAYROLL_POLICY = {
  scheduleAffectsSalary: true,
  appliesSupplementaryHours: true,
  appliesExtraordinaryHours: true,
  label: "Ajustado al plan",
};

export function attendancePayrollPolicy(employee = {}) {
  if (employee?.punchesAffectHours === false) {
    return {
      scheduleAffectsSalary: false,
      appliesSupplementaryHours: false,
      appliesExtraordinaryHours: false,
      label: "Picadas no afectan horas",
    };
  }

  return DEFAULT_ATTENDANCE_PAYROLL_POLICY;
}

export function isAttendancePayrollNeutral(employee = {}) {
  const policy = attendancePayrollPolicy(employee);

  return !policy.scheduleAffectsSalary && !policy.appliesSupplementaryHours && !policy.appliesExtraordinaryHours;
}

export function isPlannedAttendanceExempt(employee = {}) {
  return !attendancePayrollPolicy(employee).scheduleAffectsSalary;
}

export function plannedAttendanceExemptionLabel(employee = {}) {
  return attendancePayrollPolicy(employee).label || DEFAULT_ATTENDANCE_PAYROLL_POLICY.label;
}
