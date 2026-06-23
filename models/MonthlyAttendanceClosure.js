import mongoose, { Schema } from "mongoose";

const monthlyAttendanceClosureRowSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    employeeName: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    employeeDni: {
      type: String,
      trim: true,
      default: "",
    },
    branchCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    branchName: {
      type: String,
      trim: true,
      default: "",
    },
    areaCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    areaName: {
      type: String,
      trim: true,
      default: "",
    },
    roleCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    roleName: {
      type: String,
      trim: true,
      default: "",
    },
    plannedDays: {
      type: Number,
      min: 0,
      default: 0,
    },
    daysWithPunches: {
      type: Number,
      min: 0,
      default: 0,
    },
    missingPunchDays: {
      type: Number,
      min: 0,
      default: 0,
    },
    unplannedWorkDays: {
      type: Number,
      min: 0,
      default: 0,
    },
    lateDays: {
      type: Number,
      min: 0,
      default: 0,
    },
    regularWorkedMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    regularTargetMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    supplementaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    plannedSupplementaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    detectedSupplementaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    extraordinaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    plannedExtraordinaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    detectedExtraordinaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    holidayExtraordinaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    lateMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    salaryTotal: {
      type: Number,
      min: 0,
      default: 0,
    },
    salaryBase: {
      type: Number,
      min: 0,
      default: 0,
    },
    hourlyRate: {
      type: Number,
      min: 0,
      default: 0,
    },
    baseCompletionMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    baseCompletionFromSupplementaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    baseCompletionFromExtraordinaryMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { _id: false },
);

const monthlyAttendanceClosureSchema = new Schema(
  {
    monthKey: {
      type: String,
      required: true,
      trim: true,
    },
    version: {
      type: Number,
      min: 1,
      required: true,
      default: 1,
    },
    isLatest: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["closed"],
      default: "closed",
    },
    completeBaseHours: {
      type: Boolean,
      default: true,
    },
    rows: {
      type: [monthlyAttendanceClosureRowSchema],
      default: [],
    },
    totals: {
      employees: { type: Number, min: 0, default: 0 },
      plannedDays: { type: Number, min: 0, default: 0 },
      daysWithPunches: { type: Number, min: 0, default: 0 },
      missingPunchDays: { type: Number, min: 0, default: 0 },
      unplannedWorkDays: { type: Number, min: 0, default: 0 },
      lateDays: { type: Number, min: 0, default: 0 },
      regularWorkedMinutes: { type: Number, min: 0, default: 0 },
      regularTargetMinutes: { type: Number, min: 0, default: 0 },
      supplementaryMinutes: { type: Number, min: 0, default: 0 },
      plannedSupplementaryMinutes: { type: Number, min: 0, default: 0 },
      detectedSupplementaryMinutes: { type: Number, min: 0, default: 0 },
      extraordinaryMinutes: { type: Number, min: 0, default: 0 },
      plannedExtraordinaryMinutes: { type: Number, min: 0, default: 0 },
      detectedExtraordinaryMinutes: { type: Number, min: 0, default: 0 },
      holidayExtraordinaryMinutes: { type: Number, min: 0, default: 0 },
      lateMinutes: { type: Number, min: 0, default: 0 },
      salaryTotal: { type: Number, min: 0, default: 0 },
      baseCompletionMinutes: { type: Number, min: 0, default: 0 },
      baseCompletionFromSupplementaryMinutes: { type: Number, min: 0, default: 0 },
      baseCompletionFromExtraordinaryMinutes: { type: Number, min: 0, default: 0 },
    },
    closedBy: {
      type: String,
      trim: true,
      default: "admin",
    },
    closedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

monthlyAttendanceClosureSchema.index({ monthKey: 1, version: 1 }, { unique: true });
monthlyAttendanceClosureSchema.index({ monthKey: 1, isLatest: 1 });
monthlyAttendanceClosureSchema.index({ closedAt: -1 });

if (process.env.NODE_ENV !== "production" && mongoose.models.MonthlyAttendanceClosure) {
  delete mongoose.models.MonthlyAttendanceClosure;
}

const MonthlyAttendanceClosure =
  mongoose.models.MonthlyAttendanceClosure ||
  mongoose.model("MonthlyAttendanceClosure", monthlyAttendanceClosureSchema);

export default MonthlyAttendanceClosure;
