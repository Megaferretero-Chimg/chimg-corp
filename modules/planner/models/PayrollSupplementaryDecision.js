import mongoose, { Schema } from "mongoose";

const payrollSupplementaryDecisionSchema = new Schema(
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
    decision: {
      type: String,
      enum: ["supplementary", "not_applicable"],
      required: true,
    },
    candidateMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    candidateHours: {
      type: Number,
      default: 0,
      min: 0,
    },
    scheduledEnd: {
      type: Date,
      default: null,
    },
    actualCheckOut: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

payrollSupplementaryDecisionSchema.index({ employee: 1, date: 1 }, { unique: true });

const PayrollSupplementaryDecision =
  mongoose.models.PayrollSupplementaryDecision ||
  mongoose.model("PayrollSupplementaryDecision", payrollSupplementaryDecisionSchema);

export default PayrollSupplementaryDecision;
