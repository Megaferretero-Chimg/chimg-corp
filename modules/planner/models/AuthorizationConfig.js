import mongoose, { Schema } from "mongoose";

const authorizationConfigSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      default: "default",
    },
    requireSupplementaryAuthorization: {
      type: Boolean,
      default: true,
    },
    requireExtraordinaryAuthorization: {
      type: Boolean,
      default: true,
    },
    requireHolidayWorkAuthorization: {
      type: Boolean,
      default: true,
    },
    requireScheduleChangeAuthorization: {
      type: Boolean,
      default: false,
    },
    requireTimeOffAuthorization: {
      type: Boolean,
      default: true,
    },
    defaultAuthorizedSupplementaryMinutesPerDay: {
      type: Number,
      min: 0,
      default: 60,
    },
    supplementaryAuthorizationThresholdMinutes: {
      type: Number,
      min: 0,
      default: 60,
    },
    extraordinaryAuthorizationThresholdMinutes: {
      type: Number,
      min: 0,
      default: 1,
    },
    authorizationToleranceMinutes: {
      type: Number,
      min: 0,
      default: 10,
    },
    maxAuthorizableMinutesPerDay: {
      type: Number,
      min: 0,
      default: 180,
    },
    maxAuthorizableMinutesPerWeek: {
      type: Number,
      min: 0,
      default: 600,
    },
    requireSupplementaryJustification: {
      type: Boolean,
      default: true,
    },
    requireExtraordinaryJustification: {
      type: Boolean,
      default: true,
    },
    requireHolidayWorkJustification: {
      type: Boolean,
      default: true,
    },
    allowRetroactiveAuthorization: {
      type: Boolean,
      default: true,
    },
    retroactiveAuthorizationDays: {
      type: Number,
      min: 0,
      default: 5,
    },
    includeOnlyAuthorizedInPayroll: {
      type: Boolean,
      default: true,
    },
    defaultAuthorizationScope: {
      type: String,
      enum: ["day", "date_range", "event"],
      default: "day",
    },
    requiresDoubleApproval: {
      type: Boolean,
      default: false,
    },
    authorizerRoleCodes: {
      type: [String],
      default: ["admin", "supervisor"],
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

authorizationConfigSchema.index({ key: 1 }, { unique: true });

if (process.env.NODE_ENV !== "production" && mongoose.models.AuthorizationConfig) {
  delete mongoose.models.AuthorizationConfig;
}

const AuthorizationConfig =
  mongoose.models.AuthorizationConfig ||
  mongoose.model("AuthorizationConfig", authorizationConfigSchema);

export default AuthorizationConfig;
