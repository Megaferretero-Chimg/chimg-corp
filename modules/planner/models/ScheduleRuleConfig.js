import mongoose, { Schema } from "mongoose";

const scheduleRuleConfigSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      default: "default",
    },
    lateToleranceMinutes: {
      type: Number,
      min: 0,
      max: 180,
      default: 10,
    },
    earlyLeaveToleranceMinutes: {
      type: Number,
      min: 0,
      max: 180,
      default: 5,
    },
    lateDepartureToleranceMinutes: {
      type: Number,
      min: 0,
      max: 180,
      default: 20,
    },
  },
  {
    timestamps: true,
  },
);

scheduleRuleConfigSchema.index({ key: 1 }, { unique: true });

if (process.env.NODE_ENV !== "production" && mongoose.models.ScheduleRuleConfig) {
  delete mongoose.models.ScheduleRuleConfig;
}

const ScheduleRuleConfig =
  mongoose.models.ScheduleRuleConfig ||
  mongoose.model("ScheduleRuleConfig", scheduleRuleConfigSchema);

export default ScheduleRuleConfig;
