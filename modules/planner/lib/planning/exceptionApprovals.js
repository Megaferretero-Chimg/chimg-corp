import { hasAccessPermission } from "@/modules/company/submodules/access/lib/permissions";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function canUserApproveExceptions(user) {
  return hasAccessPermission(user, "planner.exceptions.approve");
}

export function forcePendingExceptionPayload(body = {}) {
  return {
    ...body,
    authorizedBy: "",
    resolution: "pending",
    resolutionNotes: "",
  };
}

export function applyExceptionApprovalActor(body = {}, user = {}) {
  const resolution = normalizeCode(body?.resolution);
  const resolverName = String(
    user?.employeeName || user?.username || user?.id || "",
  ).trim();

  if (!resolution || resolution === "PENDING") {
    return {
      ...body,
      authorizedBy: "",
      resolution: "pending",
    };
  }

  return {
    ...body,
    authorizedBy: resolverName,
  };
}
