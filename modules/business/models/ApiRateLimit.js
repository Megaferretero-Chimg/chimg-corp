import mongoose, { Schema } from "mongoose";

const apiRateLimitSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    count: { type: Number, required: true, min: 0, default: 0 },
    windowStartedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

apiRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.BusinessApiRateLimit
  || mongoose.model("BusinessApiRateLimit", apiRateLimitSchema);
