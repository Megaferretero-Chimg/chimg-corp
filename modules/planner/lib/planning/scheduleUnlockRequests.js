const STATUS_LABELS = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
};

function normalizedDate(value) {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildPlanningApprovalVersionKey(approval = {}) {
  const versionDate = normalizedDate(approval.versionSavedAt)
    || normalizedDate(approval.approvedAt);
  const savedAt = versionDate ? versionDate.toISOString() : "sin-fecha";
  const actor = approval.versionSavedByUser
    || approval.versionSavedBy
    || approval.approvedByUser
    || approval.approvedBy
    || "sistema";

  return `${approval.groupId || ""}|${savedAt}|${actor}`;
}

export function findActivePlanningApproval(assignments = [], groupId, weekStartKey) {
  const normalizedGroupId = String(groupId || "");

  return assignments
    .flatMap((assignment) => assignment?.planningApprovals || [])
    .find((approval) =>
      approval?.weekStartKey === weekStartKey
      && String(approval?.groupId || "") === normalizedGroupId
      && !approval?.unlockedAt,
    ) || null;
}

export function buildUnlockRequestVersionQuery(approval = {}) {
  const approvalVersionKey = buildPlanningApprovalVersionKey(approval);
  const approvalApprovedAt = normalizedDate(approval.approvedAt)
    || normalizedDate(approval.versionSavedAt);
  const versionFilters = [{ approvalVersionKey }];

  if (approvalApprovedAt) {
    versionFilters.push({
      approvalVersionKey: { $in: ["", null] },
      requestedAt: { $gte: approvalApprovedAt },
    });
  }

  return {
    approvalVersionKey,
    approvalVersionSavedAt: normalizedDate(approval.versionSavedAt),
    approvalApprovedAt,
    match: { $or: versionFilters },
  };
}

export function unlockRequestMatchesPlanningApproval(request = {}, approval = {}) {
  const identity = buildUnlockRequestVersionQuery(approval);
  const requestVersionKey = String(request.approvalVersionKey || "").trim();

  if (requestVersionKey) {
    return requestVersionKey === identity.approvalVersionKey;
  }

  const requestedAt = normalizedDate(request.requestedAt || request.createdAt);

  return Boolean(
    requestedAt
    && identity.approvalApprovedAt
    && requestedAt.getTime() >= identity.approvalApprovedAt.getTime(),
  );
}

export function getUnlockRequestWeekMonthKeys(weekStartKey) {
  const start = new Date(`${weekStartKey}T12:00:00`);

  if (Number.isNaN(start.getTime())) return [];

  return [...new Set(Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);

    date.setDate(start.getDate() + index);
    return date.toISOString().slice(0, 7);
  }))];
}

export function getUnlockRequestWeekEndKey(weekStartKey) {
  const start = new Date(`${weekStartKey}T12:00:00.000Z`);

  if (Number.isNaN(start.getTime())) return "";

  start.setUTCDate(start.getUTCDate() + 6);
  return start.toISOString().slice(0, 10);
}

export function serializeScheduleUnlockRequest(request) {
  if (!request) return null;

  const status = ["pending", "approved", "rejected"].includes(request.status)
    ? request.status
    : "pending";

  return {
    id: request._id.toString(),
    groupId: request.group?.toString?.() || String(request.group || ""),
    groupName: request.groupName || "",
    branchCode: request.branchCode || "",
    branchName: request.branchName || "",
    monthKey: request.monthKey || "",
    weekStartKey: request.weekStartKey || "",
    weekEndKey: getUnlockRequestWeekEndKey(request.weekStartKey),
    approvalVersionKey: request.approvalVersionKey || "",
    approvalVersionSavedAt: request.approvalVersionSavedAt || null,
    approvalApprovedAt: request.approvalApprovedAt || null,
    reason: request.reason || "",
    status,
    statusLabel: STATUS_LABELS[status],
    requestedAt: request.requestedAt || request.createdAt,
    requestedBy: request.requestedBy || "",
    requestedByUser: request.requestedByUser || "",
    reviewedAt: request.reviewedAt || null,
    reviewedBy: request.reviewedBy || "",
    reviewedByUser: request.reviewedByUser || "",
    reviewNotes: request.reviewNotes || "",
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
