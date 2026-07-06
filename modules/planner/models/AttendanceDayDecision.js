import mongoose, { Schema } from "mongoose";

const attendanceDayDecisionSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    dateKey: {
      type: String,
      required: true,
      trim: true,
    },
    decision: {
      type: String,
      enum: [
        "full",
        "planned",
        "none",
        "custom",
        "discount_day",
        "pay_planned_day",
        "complete_regular_day",
        "reviewed",
        "justify_early_leave",
        "justify_no_punches",
        "justify_incomplete_punches",
        "justify_late",
      ],
      required: true,
      default: "full",
    },
    authorizedSupplementaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    authorizedExtraordinaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    detectedSupplementaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    detectedExtraordinaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    detectedLateMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    adjustedLateMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    detectedEarlyLeaveMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    adjustedEarlyLeaveMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    decidedBy: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

attendanceDayDecisionSchema.index({ employee: 1, dateKey: 1 }, { unique: true });

const AttendanceDayDecision =
  mongoose.models.AttendanceDayDecision ||
  mongoose.model("AttendanceDayDecision", attendanceDayDecisionSchema);

export default AttendanceDayDecision;
