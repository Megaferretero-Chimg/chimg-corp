import mongoose, { Schema } from "mongoose";

const deviceSchema = new Schema(
  {
    deviceId: { type: String, required: true, trim: true, unique: true },
    deviceName: { type: String, required: true, trim: true },
    warehouse: { type: Schema.Types.ObjectId, ref: "BusinessWarehouse", default: null },
    warehouseName: { type: String, trim: true, uppercase: true, default: "TODAS LAS BODEGAS" },
    tokenHash: { type: String, required: true, trim: true, unique: true, select: false },
    status: { type: String, enum: ["active", "revoked"], default: "active" },
    activatedAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: String, trim: true, default: "" },
    lastSeenAt: { type: Date, default: null },
    lastManifestAt: { type: Date, default: null },
    lastSyncAt: { type: Date, default: null },
    lastDownloadedVersion: { type: String, trim: true, default: "" },
    lastDownloadedCustomerVersion: { type: String, trim: true, default: "" },
    documentCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

deviceSchema.index({ status: 1, lastSeenAt: -1 });
deviceSchema.index({ warehouse: 1, status: 1 });

export default mongoose.models.BusinessDevice
  || mongoose.model("BusinessDevice", deviceSchema);
