import mongoose, { Schema } from "mongoose";

const payrollIncompleteDayDecisionSchema = new Schema(
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
      enum: ["valid_day", "absence"],
      required: true,
    },
    punchCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    scheduledStart: {
      type: Date,
      default: null,
    },
    scheduledEnd: {
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

payrollIncompleteDayDecisionSchema.index({ employee: 1, date: 1 }, { unique: true });

const PayrollIncompleteDayDecision =
  mongoose.models.PayrollIncompleteDayDecision ||
  mongoose.model("PayrollIncompleteDayDecision", payrollIncompleteDayDecisionSchema);

export default PayrollIncompleteDayDecision;
