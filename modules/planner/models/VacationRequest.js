import mongoose, { Schema } from "mongoose";

const vacationRequestSchema = new Schema(
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
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    startDateKey: {
      type: String,
      required: true,
      trim: true,
    },
    endDateKey: {
      type: String,
      required: true,
      trim: true,
    },
    coveredDateKeys: {
      type: [String],
      default: [],
    },
    totalCalendarDays: {
      type: Number,
      min: 1,
      default: 1,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
    },
    requestedBy: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    requestedByUser: {
      type: String,
      trim: true,
      default: "",
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    reviewedByUser: {
      type: String,
      trim: true,
      default: "",
    },
    reviewNotes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

vacationRequestSchema.index({ employee: 1, startDate: 1, endDate: 1 });
vacationRequestSchema.index({ startDate: 1, endDate: 1 });
vacationRequestSchema.index({ employee: 1, startDateKey: 1, endDateKey: 1 });
vacationRequestSchema.index({ status: 1, startDateKey: 1, endDateKey: 1 });
vacationRequestSchema.index(
  { employee: 1, coveredDateKeys: 1 },
  {
    unique: true,
    name: "employee_covered_vacation_date_unique",
    partialFilterExpression: { "coveredDateKeys.0": { $exists: true } },
  },
);

if (process.env.NODE_ENV !== "production" && mongoose.models.VacationRequest) {
  delete mongoose.models.VacationRequest;
}

const VacationRequest =
  mongoose.models.VacationRequest ||
  mongoose.model("VacationRequest", vacationRequestSchema);

export default VacationRequest;
