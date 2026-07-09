import mongoose, { Schema } from "mongoose";

const exceptionSnapshotSchema = new Schema(
  {
    id: {
      type: String,
      trim: true,
      default: "",
    },
    title: {
      type: String,
      trim: true,
      default: "",
    },
    employeeId: {
      type: String,
      trim: true,
      default: "",
    },
    type: {
      type: String,
      trim: true,
      default: "",
    },
    typeLabel: {
      type: String,
      trim: true,
      default: "",
    },
    scope: {
      type: String,
      trim: true,
      default: "",
    },
    scopeLabel: {
      type: String,
      trim: true,
      default: "",
    },
    effect: {
      type: String,
      trim: true,
      default: "",
    },
    effectLabel: {
      type: String,
      trim: true,
      default: "",
    },
    attendanceMode: {
      type: String,
      trim: true,
      default: "",
    },
    attendanceModeLabel: {
      type: String,
      trim: true,
      default: "",
    },
    payMode: {
      type: String,
      trim: true,
      default: "",
    },
    payModeLabel: {
      type: String,
      trim: true,
      default: "",
    },
    dateKey: {
      type: String,
      trim: true,
      default: "",
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
    },
    manualPunchTime: {
      type: String,
      trim: true,
      default: "",
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
    registeredBy: {
      type: String,
      trim: true,
      default: "",
    },
    authorizedBy: {
      type: String,
      trim: true,
      default: "",
    },
    resolution: {
      type: String,
      trim: true,
      default: "",
    },
    resolutionLabel: {
      type: String,
      trim: true,
      default: "",
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
      trim: true,
      default: "",
    },
    statusLabel: {
      type: String,
      trim: true,
      default: "",
    },
    createdAt: {
      type: Date,
      default: null,
    },
    updatedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

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
    exceptionSnapshot: {
      type: [exceptionSnapshotSchema],
      default: [],
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
    groupId: {
      type: Schema.Types.ObjectId,
      ref: "PlanningWorkGroup",
      default: null,
    },
    groupName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
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
    groupId: {
      type: Schema.Types.ObjectId,
      ref: "PlanningWorkGroup",
      default: null,
    },
    groupName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
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
    versionSavedAt: {
      type: Date,
      default: null,
    },
    versionSavedBy: {
      type: String,
      trim: true,
      default: "",
    },
    versionSavedByUser: {
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
scheduleAssignmentSchema.index({ "scheduleHistory.groupId": 1, "scheduleHistory.weekStartKey": 1 });
scheduleAssignmentSchema.index({ "planningApprovals.groupId": 1, "planningApprovals.weekStartKey": 1 });

if (process.env.NODE_ENV !== "production" && mongoose.models.ScheduleAssignment) {
  delete mongoose.models.ScheduleAssignment;
}

const ScheduleAssignment =
  mongoose.models.ScheduleAssignment ||
  mongoose.model("ScheduleAssignment", scheduleAssignmentSchema);

export default ScheduleAssignment;
