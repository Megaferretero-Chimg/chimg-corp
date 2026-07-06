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
    totalCalendarDays: {
      type: Number,
      min: 1,
      default: 1,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["scheduled", "cancelled"],
      default: "scheduled",
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

vacationRequestSchema.index({ employee: 1, startDate: 1, endDate: 1 });
vacationRequestSchema.index({ startDate: 1, endDate: 1 });

if (process.env.NODE_ENV !== "production" && mongoose.models.VacationRequest) {
  delete mongoose.models.VacationRequest;
}

const VacationRequest =
  mongoose.models.VacationRequest ||
  mongoose.model("VacationRequest", vacationRequestSchema);

export default VacationRequest;
