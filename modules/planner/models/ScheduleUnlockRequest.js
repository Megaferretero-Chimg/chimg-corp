import mongoose, { Schema } from "mongoose";

const scheduleUnlockRequestSchema = new Schema(
  {
    group: {
      type: Schema.Types.ObjectId,
      ref: "PlanningWorkGroup",
      required: true,
    },
    groupName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    branchCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    branchName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    monthKey: {
      type: String,
      trim: true,
      required: true,
    },
    weekStartKey: {
      type: String,
      trim: true,
      required: true,
    },
    approvalVersionKey: {
      type: String,
      trim: true,
      default: "",
    },
    approvalVersionSavedAt: {
      type: Date,
      default: null,
    },
    approvalApprovedAt: {
      type: Date,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      required: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    requestedBy: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    requestedByUser: {
      type: String,
      trim: true,
      default: "",
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    reviewedByUser: {
      type: String,
      trim: true,
      default: "",
    },
    reviewNotes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

scheduleUnlockRequestSchema.index({ status: 1, requestedAt: -1 });
scheduleUnlockRequestSchema.index({ group: 1, weekStartKey: 1, requestedAt: -1 });
scheduleUnlockRequestSchema.index(
  { group: 1, weekStartKey: 1, approvalVersionKey: 1 },
  {
    unique: true,
    name: "schedule_unlock_request_approval_version_unique",
    partialFilterExpression: { approvalVersionKey: { $type: "string" } },
  },
);

if (process.env.NODE_ENV !== "production" && mongoose.models.ScheduleUnlockRequest) {
  delete mongoose.models.ScheduleUnlockRequest;
}

const ScheduleUnlockRequest =
  mongoose.models.ScheduleUnlockRequest
  || mongoose.model("ScheduleUnlockRequest", scheduleUnlockRequestSchema);

export default ScheduleUnlockRequest;
