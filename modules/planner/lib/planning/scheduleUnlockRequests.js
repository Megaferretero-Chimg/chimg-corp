const STATUS_LABELS = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
};

export function getUnlockRequestWeekMonthKeys(weekStartKey) {
  const start = new Date(`${weekStartKey}T12:00:00`);

  if (Number.isNaN(start.getTime())) return [];

  return [...new Set(Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);

    date.setDate(start.getDate() + index);
    return date.toISOString().slice(0, 7);
  }))];
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
