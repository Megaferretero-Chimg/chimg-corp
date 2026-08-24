import mongoose, { Schema } from "mongoose";

const deviceActivationCodeSchema = new Schema(
  {
    codeHash: { type: String, required: true, trim: true, unique: true, select: false },
    codeSuffix: { type: String, required: true, trim: true },
    deviceName: { type: String, required: true, trim: true },
    warehouse: { type: Schema.Types.ObjectId, ref: "BusinessWarehouse", required: true },
    warehouseName: { type: String, required: true, trim: true, uppercase: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    usedByDeviceId: { type: String, trim: true, default: "" },
    revokedAt: { type: Date, default: null },
    createdBy: { type: String, required: true, trim: true },
    createdByUser: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

deviceActivationCodeSchema.index({ expiresAt: 1 });
deviceActivationCodeSchema.index({ usedAt: 1, revokedAt: 1, expiresAt: 1 });

export default mongoose.models.BusinessDeviceActivationCode
  || mongoose.model("BusinessDeviceActivationCode", deviceActivationCodeSchema);
