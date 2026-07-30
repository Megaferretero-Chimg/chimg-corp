import { createAuditLog } from "@/lib/audit";
import AuditLog from "@/models/AuditLog";
import { AttendanceDayDecision } from "@/modules/planner/models";

const SNAPSHOT_FIELDS = [
  "decision",
  "authorizedSupplementaryMinutes",
  "authorizedExtraordinaryMinutes",
  "manualSupplementaryMinutes",
  "manualExtraordinaryMinutes",
  "manualAdditionalReason",
  "detectedSupplementaryMinutes",
  "detectedExtraordinaryMinutes",
  "detectedLateMinutes",
  "adjustedLateMinutes",
  "detectedEarlyLeaveMinutes",
  "adjustedEarlyLeaveMinutes",
  "additionalResolved",
  "lateResolved",
  "note",
  "decidedBy",
];

const BOOLEAN_SNAPSHOT_FIELDS = new Set(["additionalResolved", "lateResolved"]);
const STRING_SNAPSHOT_FIELDS = new Set(["decision", "manualAdditionalReason", "note", "decidedBy"]);

export function attendanceDecisionSnapshot(decision = {}) {
  return Object.fromEntries(SNAPSHOT_FIELDS.map((field) => {
    if (decision?.[field] !== undefined && decision?.[field] !== null) {
      return [field, decision[field]];
    }

    if (BOOLEAN_SNAPSHOT_FIELDS.has(field)) return [field, false];
    if (STRING_SNAPSHOT_FIELDS.has(field)) return [field, field === "decision" ? "custom" : ""];
    return [field, 0];
  }));
}

function restoredDecisionFields(snapshot, dateKey) {
  return {
    ...attendanceDecisionSnapshot(snapshot),
    date: new Date(`${dateKey}T12:00:00.000Z`),
    dateKey,
  };
}

export async function removeCurrentAttendanceDecisionRevision({
  decision,
  employeeId,
  employeeName = "",
  dateKey,
  actor,
}) {
  const decisionId = decision?._id?.toString?.() || "";
  const latestRevisionAudit = await AuditLog.findOne({
    action: "attendanceDayDecision.upsert",
    entityType: "attendanceDayDecision",
    $or: [
      { entityId: decisionId },
      {
        "details.employeeId": employeeId,
        "details.dateKey": dateKey,
      },
    ],
  }).sort({ happenedAt: -1, _id: -1 });
  const previousSnapshot = latestRevisionAudit?.details?.before || null;
  const removedSnapshot = attendanceDecisionSnapshot(decision);

  if (previousSnapshot) {
    await AttendanceDayDecision.updateOne(
      { _id: decision._id },
      { $set: restoredDecisionFields(previousSnapshot, dateKey) },
    );
  } else {
    await AttendanceDayDecision.deleteOne({ _id: decision._id });
  }

  try {
    await createAuditLog({
      actor,
      action: "attendanceDayDecision.deactivate",
      entityType: "attendanceDayDecision",
      entityId: decisionId,
      entityLabel: `${employeeName || employeeId} ${dateKey}`,
      route: "/api/planner/attendance/day-decisions",
      details: {
        employeeId,
        employeeName,
        dateKey,
        before: removedSnapshot,
        after: previousSnapshot,
        restoredPreviousRevision: Boolean(previousSnapshot),
      },
    });
  } catch (error) {
    await AttendanceDayDecision.updateOne(
      { _id: decision._id },
      {
        $set: restoredDecisionFields(removedSnapshot, dateKey),
        $setOnInsert: { employee: employeeId },
      },
      { upsert: true },
    );
    throw error;
  }

  return {
    restoredPreviousRevision: Boolean(previousSnapshot),
  };
}
