import mongoose from "mongoose";

export { default as AttendanceDayDecision } from "@/modules/planner/models/AttendanceDayDecision";
export { default as AttendancePunch } from "@/modules/planner/models/AttendancePunch";
export { default as AttendanceUpload } from "@/modules/planner/models/AttendanceUpload";
export { default as BaseScheduleTemplate } from "@/modules/planner/models/BaseScheduleTemplate";
export { default as DailyAttendance } from "@/modules/planner/models/DailyAttendance";
export { default as Holiday } from "@/modules/planner/models/Holiday";
export { default as MonthlyAttendanceClosure } from "@/modules/planner/models/MonthlyAttendanceClosure";
export { default as OperationalException } from "@/modules/planner/models/OperationalException";
export { default as PayrollIncompleteDayDecision } from "@/modules/planner/models/PayrollIncompleteDayDecision";
export { default as PayrollLateDecision } from "@/modules/planner/models/PayrollLateDecision";
export { default as PayrollPayment } from "@/modules/planner/models/PayrollPayment";
export { default as PayrollSupplementaryDecision } from "@/modules/planner/models/PayrollSupplementaryDecision";
export { default as ScheduleAssignment } from "@/modules/planner/models/ScheduleAssignment";
export { default as ScheduleUnlockRequest } from "@/modules/planner/models/ScheduleUnlockRequest";
export { default as ScheduleRuleConfig } from "@/modules/planner/models/ScheduleRuleConfig";
export { default as VacationRequest } from "@/modules/planner/models/VacationRequest";
export { default as WorkSchedule } from "@/modules/planner/models/WorkSchedule";

const planningWorkGroupMemberSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    employeeName: {
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
  },
  { _id: false, strict: false },
);

const planningWorkGroupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
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
    ownerEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    ownerEmployeeName: {
      type: String,
      trim: true,
      default: "",
    },
    members: {
      type: [planningWorkGroupMemberSchema],
      default: [],
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    strict: false,
  },
);

planningWorkGroupSchema.index({ branchCode: 1, name: 1 });
planningWorkGroupSchema.index({ "members.employee": 1 });
planningWorkGroupSchema.index({ ownerEmployee: 1, isActive: 1 });

export const PlanningWorkGroup =
  mongoose.models.PlanningWorkGroup || mongoose.model("PlanningWorkGroup", planningWorkGroupSchema);
