import { createAuditLog } from "@/lib/audit";
import AuditLog from "@/models/AuditLog";
import { AttendanceDayDecision } from "@/modules/planner/models";

const SNAPSHOT_FIELDS = [
  "decision",
  "authorizedSupplementaryMinutes",
  "authorizedExtraordinaryMinutes",
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
const STRING_SNAPSHOT_FIELDS = new Set(["decision", "note", "decidedBy"]);

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
  permanent = false,
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
    if (latestRevisionAudit) {
      if (permanent) {
        await AuditLog.deleteOne({ _id: latestRevisionAudit._id });
      } else {
        await AuditLog.updateOne(
          { _id: latestRevisionAudit._id },
          {
            $set: {
              actor,
              action: "attendanceDayDecision.delete",
              route: "/api/planner/attendance/day-decisions",
              happenedAt: new Date(),
              "details.employeeId": employeeId,
              "details.employeeName": employeeName,
              "details.dateKey": dateKey,
              "details.before": removedSnapshot,
              "details.after": null,
            },
          },
        );
      }
    } else if (!permanent) {
      await createAuditLog({
        actor,
        action: "attendanceDayDecision.delete",
        entityType: "attendanceDayDecision",
        entityId: decisionId,
        entityLabel: `${employeeName || employeeId} ${dateKey}`,
        route: "/api/planner/attendance/day-decisions",
        details: {
          employeeId,
          employeeName,
          dateKey,
          before: removedSnapshot,
          after: null,
        },
      });
    }
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
