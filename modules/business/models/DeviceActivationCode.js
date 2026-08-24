import mongoose, { Schema } from "mongoose";

const deviceActivationCodeSchema = new Schema(
  {
    codeHash: { type: String, required: true, trim: true, unique: true, select: false },
    codeSuffix: { type: String, required: true, trim: true },
    deviceName: { type: String, required: true, trim: true },
    warehouse: { type: Schema.Types.ObjectId, ref: "BusinessWarehouse", default: null },
    warehouseName: { type: String, trim: true, uppercase: true, default: "TODAS LAS BODEGAS" },
    permanent: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },
    usedAt: { type: Date, default: null },
    usedByDeviceId: { type: String, trim: true, default: "" },
    revokedAt: { type: Date, default: null },
    createdBy: { type: String, required: true, trim: true },
    createdByUser: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

deviceActivationCodeSchema.index({ permanent: 1, usedAt: 1, revokedAt: 1 });
deviceActivationCodeSchema.index({ expiresAt: 1 });

export default mongoose.models.BusinessDeviceActivationCode
  || mongoose.model("BusinessDeviceActivationCode", deviceActivationCodeSchema);
