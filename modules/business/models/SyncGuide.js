import mongoose, { Schema } from "mongoose";

const syncGuideSchema = new Schema(
  {
    syncUuid: { type: String, required: true, trim: true, unique: true },
    device: { type: Schema.Types.ObjectId, ref: "BusinessDevice", required: true },
    deviceId: { type: String, required: true, trim: true },
    internalNumber: { type: String, trim: true, default: "" },
    warehouse: { type: String, trim: true, uppercase: true, default: "" },
    cashierName: { type: String, trim: true, default: "" },
    sellerName: { type: String, trim: true, default: "" },
    customerIdentification: { type: String, trim: true, default: "" },
    customerName: { type: String, trim: true, default: "" },
    total: { type: Number, default: 0, min: 0 },
    localCreatedAt: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["pending", "processed", "rejected"], default: "pending" },
    validationErrors: [{ type: String, trim: true }],
    snapshot: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

syncGuideSchema.index({ receivedAt: -1 });
syncGuideSchema.index({ device: 1, receivedAt: -1 });
syncGuideSchema.index({ warehouse: 1, cashierName: 1, status: 1 });

export default mongoose.models.BusinessSyncGuide
  || mongoose.model("BusinessSyncGuide", syncGuideSchema);
