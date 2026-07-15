import { AttendanceDayDecision, OperationalException } from "@/modules/planner/models";

function appliesToWeekday(dateKey, applicableWeekdays = []) {
  if (!Array.isArray(applicableWeekdays) || !applicableWeekdays.length) return true;
  const weekday = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  return applicableWeekdays.includes(weekday);
}

export async function findLaterExceptionForDay({ employeeId, dateKey, happenedAt, excludeId = "" }) {
  const query = {
    employee: employeeId,
    planningSource: "attendance_comparison",
    status: { $ne: "void" },
    resolution: { $ne: "pending" },
    updatedAt: { $gt: happenedAt || new Date(0) },
    $or: [
      { dateKey },
      { dateKey: { $lte: dateKey }, endDateKey: { $gte: dateKey } },
    ],
  };

  if (excludeId) query._id = { $ne: excludeId };

  const exceptions = await OperationalException.find(query).sort({ updatedAt: 1 }).lean();
  return exceptions.find((exception) => appliesToWeekday(dateKey, exception.applicableWeekdays)) || null;
}

export async function findLaterAttendanceDecisionForException(exception = {}) {
  const startDateKey = String(exception.dateKey || "");
  const endDateKey = String(exception.endDateKey || startDateKey);
  const decisions = await AttendanceDayDecision.find({
    employee: exception.employee,
    dateKey: { $gte: startDateKey, $lte: endDateKey },
    updatedAt: { $gt: exception.updatedAt || exception.createdAt || new Date(0) },
  }).sort({ updatedAt: 1 }).lean();

  return decisions.find((decision) => appliesToWeekday(decision.dateKey, exception.applicableWeekdays)) || null;
}

export async function findLaterExceptionForException(exception = {}) {
  const startDateKey = String(exception.dateKey || "");
  const endDateKey = String(exception.endDateKey || startDateKey);

  return OperationalException.findOne({
    _id: { $ne: exception._id },
    employee: exception.employee,
    planningSource: "attendance_comparison",
    status: { $ne: "void" },
    resolution: { $ne: "pending" },
    updatedAt: { $gt: exception.updatedAt || exception.createdAt || new Date(0) },
    dateKey: { $lte: endDateKey },
    $or: [
      { endDateKey: { $gte: startDateKey } },
      { endDateKey: "", dateKey: { $gte: startDateKey } },
      { endDateKey: { $exists: false }, dateKey: { $gte: startDateKey } },
    ],
  }).sort({ updatedAt: 1 }).lean();
}
