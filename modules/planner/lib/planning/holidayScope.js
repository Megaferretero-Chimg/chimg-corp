export function holidayAppliesToBranch(holiday, branchCode) {
  if (holiday?.scope !== "branches") return true;
  const code = String(branchCode || "").trim().toUpperCase();
  return Boolean(code) && (holiday.branchCodes || []).includes(code);
}

export function holidaysForBranch(holidays = [], branchCode) {
  return holidays.filter((holiday) => holidayAppliesToBranch(holiday, branchCode));
}
