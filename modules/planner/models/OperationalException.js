import mongoose, { Schema } from "mongoose";

const operationalExceptionSchema = new Schema(
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
    branchName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    areaName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    roleName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    effect: {
      type: String,
      enum: [
        "planning_change",
        "authorized_overtime",
        "paid_absence",
        "paid_partial_leave",
        "unpaid_absence",
        "external_work",
        "manual_punch",
        "alert_review",
        "other",
      ],
      default: "other",
    },
    attendanceMode: {
      type: String,
      enum: ["use_punches", "use_authorized_schedule", "add_manual_punch", "ignore_attendance", "none"],
      default: "use_punches",
    },
    payMode: {
      type: String,
      enum: ["regular_only", "regular_and_extra", "discount", "no_pay_change", "none"],
      default: "regular_only",
    },
    type: {
      type: String,
      enum: ["absence", "overtime_authorization", "sick_leave", "permission", "schedule_change", "replacement", "medical_appointment", "early_leave", "late_arrival", "missing_punch", "outside_work", "outside_work_punch", "material_pickup", "field_visit", "other"],
      required: true,
    },
    scope: {
      type: String,
      enum: ["full_day", "partial_day", "early_leave", "late_arrival", "missing_punch", "outside_work", "exit_return", "date_range", "other"],
      default: "full_day",
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
    endDate: {
      type: Date,
      default: null,
    },
    endDateKey: {
      type: String,
      trim: true,
      default: "",
    },
    startTime: {
      type: String,
      trim: true,
      default: "",
    },
    endTime: {
      type: String,
      trim: true,
      default: "",
    },
    plannedStartTime: {
      type: String,
      trim: true,
      default: "",
    },
    plannedEndTime: {
      type: String,
      trim: true,
      default: "",
    },
    plannedDayType: {
      type: String,
      enum: ["workday", "off_day"],
      default: "workday",
    },
    isExtraDay: {
      type: Boolean,
      default: false,
    },
    plannedLunchStartTime: {
      type: String,
      trim: true,
      default: "",
    },
    plannedLunchEndTime: {
      type: String,
      trim: true,
      default: "",
    },
    plannedLunchDurationMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    applicableWeekdays: {
      type: [Number],
      default: undefined,
      validate: {
        validator(days) {
          return !Array.isArray(days) || days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
        },
        message: "Los dias aplicables deben estar entre 0 y 6.",
      },
    },
    manualPunch: {
      type: Schema.Types.ObjectId,
      ref: "AttendancePunch",
      default: null,
    },
    manualPunches: {
      type: [Schema.Types.ObjectId],
      ref: "AttendancePunch",
      default: undefined,
    },
    manualPunchTime: {
      type: String,
      trim: true,
      default: "",
    },
    manualPunchTimes: {
      type: [String],
      default: undefined,
    },
    permissionPunches: {
      type: [Schema.Types.ObjectId],
      ref: "AttendancePunch",
      default: undefined,
    },
    permissionPunchTimes: {
      type: [String],
      default: undefined,
    },
    discountMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    destination: {
      type: String,
      trim: true,
      default: "",
    },
    countsAsWorkedTime: {
      type: Boolean,
      default: false,
    },
    allowSupplementaryTime: {
      type: Boolean,
      default: false,
    },
    planningSource: {
      type: String,
      enum: ["", "schedule_planner", "attendance_comparison"],
      default: "",
    },
    requestKey: {
      type: String,
      trim: true,
      default: "",
    },
    registeredBy: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
    },
    createdByUser: {
      type: String,
      trim: true,
      default: "",
    },
    authorizedBy: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    resolution: {
      type: String,
      enum: ["pending", "discount_day", "paid_leave", "complete_scheduled_time", "approved_work_time", "justified_record", "reschedule", "replacement", "no_action", "other"],
      default: "pending",
    },
    resolutionNotes: {
      type: String,
      trim: true,
      default: "",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["open", "resolved", "void"],
      default: "open",
    },
  },
  {
    timestamps: true,
  },
);

operationalExceptionSchema.index({ employee: 1, date: 1 });
operationalExceptionSchema.index({ date: 1, status: 1 });
operationalExceptionSchema.index({ type: 1, resolution: 1 });
operationalExceptionSchema.index({ effect: 1, status: 1 });
operationalExceptionSchema.index({ createdByUser: 1, date: 1 });
operationalExceptionSchema.index({ employee: 1, dateKey: 1, endDateKey: 1, status: 1 });
operationalExceptionSchema.index({ employee: 1, planningSource: 1, dateKey: 1, endDateKey: 1, updatedAt: -1 });
operationalExceptionSchema.index(
  { requestKey: 1 },
  {
    unique: true,
    partialFilterExpression: { requestKey: { $type: "string", $gt: "" } },
  },
);

if (process.env.NODE_ENV !== "production" && mongoose.models.OperationalException) {
  delete mongoose.models.OperationalException;
}

const OperationalException =
  mongoose.models.OperationalException ||
  mongoose.model("OperationalException", operationalExceptionSchema);

export default OperationalException;
