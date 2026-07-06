import mongoose, { Schema } from "mongoose";

const payrollLateDecisionSchema = new Schema(
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
    confirmed: {
      type: Boolean,
      default: false,
    },
    lateMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    scheduledStart: {
      type: Date,
      default: null,
    },
    actualCheckIn: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

payrollLateDecisionSchema.index({ employee: 1, date: 1 }, { unique: true });

const PayrollLateDecision =
  mongoose.models.PayrollLateDecision ||
  mongoose.model("PayrollLateDecision", payrollLateDecisionSchema);

export default PayrollLateDecision;
