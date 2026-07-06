import mongoose, { Schema } from "mongoose";

const generatedDaySchema = new Schema(
  {
    dateKey: {
      type: String,
      trim: true,
      required: true,
    },
    dayOfWeek: {
      type: Number,
      min: 0,
      max: 6,
      required: true,
    },
    label: {
      type: String,
      trim: true,
      default: "",
    },
    dayType: {
      type: String,
      enum: ["workday", "vacation", "holiday", "weekend_overtime", "off_day"],
      default: "workday",
    },
    startTime: {
      type: String,
      trim: true,
      default: "",
    },
    lunchDurationMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    lunchStartTime: {
      type: String,
      trim: true,
      default: "",
    },
    lunchEndTime: {
      type: String,
      trim: true,
      default: "",
    },
    endTime: {
      type: String,
      trim: true,
      default: "",
    },
    authorizedExtraMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    template: {
      type: Schema.Types.ObjectId,
      ref: "BaseScheduleTemplate",
      default: null,
    },
    templateName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    areaCode: {
      type: String,
      trim: true,
      default: "",
    },
    areaName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    roleCode: {
      type: String,
      trim: true,
      default: "",
    },
    roleName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    operationalNote: {
      type: String,
      trim: true,
      default: "",
    },
    operationalJustification: {
      type: Boolean,
      default: false,
    },
    source: {
      type: String,
      enum: [
        "template",
        "holiday",
        "manual_override",
        "operational",
        "attendance_inferred",
        "attendance_extra",
        "attendance_rest",
      ],
      default: "template",
    },
  },
  { _id: false },
);

const weeklyPlanSchema = new Schema(
  {
    weekStartKey: {
      type: String,
      trim: true,
      required: true,
    },
    label: {
      type: String,
      trim: true,
      default: "",
    },
    template: {
      type: Schema.Types.ObjectId,
      ref: "BaseScheduleTemplate",
      required: true,
    },
    templateName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    rotationGroup: {
      type: String,
      trim: true,
      default: "",
    },
    variantType: {
      type: String,
      enum: ["base", "sabado", "domingo", "sabado_domingo", "custom"],
      default: "custom",
    },
    startTime: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false },
);

const scheduleHistorySchema = new Schema(
  {
    weekStartKey: {
      type: String,
      trim: true,
      default: "",
    },
    savedAt: {
      type: Date,
      default: Date.now,
    },
    savedBy: {
      type: String,
      trim: true,
      default: "",
    },
    savedByUser: {
      type: String,
      trim: true,
      default: "",
    },
    generatedDays: {
      type: [generatedDaySchema],
      default: [],
    },
  },
  { _id: false },
);

const planningApprovalSchema = new Schema(
  {
    weekStartKey: {
      type: String,
      trim: true,
      required: true,
    },
    approvedAt: {
      type: Date,
      default: Date.now,
    },
    approvedBy: {
      type: String,
      trim: true,
      default: "",
    },
    approvedByUser: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false },
);

const scheduleAssignmentSchema = new Schema(
  {
    monthKey: {
      type: String,
      required: true,
      trim: true,
    },
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
      uppercase: true,
      default: "",
    },
    areaCode: {
      type: String,
      trim: true,
      default: "",
    },
    areaName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    roleCode: {
      type: String,
      trim: true,
      default: "",
    },
    roleName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    template: {
      type: Schema.Types.ObjectId,
      ref: "BaseScheduleTemplate",
      default: null,
    },
    templateName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    rotationGroup: {
      type: String,
      trim: true,
      default: "",
    },
    generatedDays: {
      type: [generatedDaySchema],
      default: [],
    },
    weeklyPlan: {
      type: [weeklyPlanSchema],
      default: [],
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    scheduleHistory: {
      type: [scheduleHistorySchema],
      default: [],
    },
    planningApprovals: {
      type: [planningApprovalSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

scheduleAssignmentSchema.index({ monthKey: 1, employee: 1 }, { unique: true });
scheduleAssignmentSchema.index({ monthKey: 1, branchCode: 1 });

if (process.env.NODE_ENV !== "production" && mongoose.models.ScheduleAssignment) {
  delete mongoose.models.ScheduleAssignment;
}

const ScheduleAssignment =
  mongoose.models.ScheduleAssignment ||
  mongoose.model("ScheduleAssignment", scheduleAssignmentSchema);

export default ScheduleAssignment;
