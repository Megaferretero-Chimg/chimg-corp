import mongoose, { Schema } from "mongoose";

const deviceSyncLogSchema = new Schema(
  {
    device: { type: Schema.Types.ObjectId, ref: "BusinessDevice", default: null },
    deviceId: { type: String, trim: true, default: "" },
    action: {
      type: String,
      enum: ["activate", "manifest", "download", "batch", "auth_rejected"],
      required: true,
    },
    status: { type: String, enum: ["success", "rejected", "partial"], required: true },
    version: { type: String, trim: true, default: "" },
    details: { type: Schema.Types.Mixed, default: {} },
    happenedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

deviceSyncLogSchema.index({ device: 1, happenedAt: -1 });
deviceSyncLogSchema.index({ action: 1, happenedAt: -1 });

export default mongoose.models.BusinessDeviceSyncLog
  || mongoose.model("BusinessDeviceSyncLog", deviceSyncLogSchema);
