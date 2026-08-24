import mongoose, { Schema } from "mongoose";

const pendingCustomerSchema = new Schema(
  {
    syncUuid: { type: String, required: true, trim: true, unique: true },
    device: { type: Schema.Types.ObjectId, ref: "BusinessDevice", required: true },
    deviceId: { type: String, required: true, trim: true },
    identification: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    city: { type: String, trim: true, default: "" },
    localCreatedAt: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["pending", "processed", "rejected"], default: "pending" },
    validationErrors: [{ type: String, trim: true }],
    snapshot: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

pendingCustomerSchema.index({ receivedAt: -1 });
pendingCustomerSchema.index({ device: 1, receivedAt: -1 });
pendingCustomerSchema.index({ status: 1, city: 1 });

export default mongoose.models.BusinessPendingCustomer
  || mongoose.model("BusinessPendingCustomer", pendingCustomerSchema);
