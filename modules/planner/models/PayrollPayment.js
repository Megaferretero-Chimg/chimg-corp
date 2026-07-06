import mongoose, { Schema } from "mongoose";

const payrollPaymentSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    employeeName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    monthKey: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["paid"],
      default: "paid",
    },
    amount: {
      type: Number,
      min: 0,
      default: 0,
    },
    paymentMethod: {
      type: String,
      trim: true,
      default: "",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    paidBy: {
      type: String,
      trim: true,
      default: "admin",
    },
    paidAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

payrollPaymentSchema.index({ monthKey: 1, employee: 1 }, { unique: true });
payrollPaymentSchema.index({ monthKey: 1, status: 1 });

if (process.env.NODE_ENV !== "production" && mongoose.models.PayrollPayment) {
  delete mongoose.models.PayrollPayment;
}

const PayrollPayment =
  mongoose.models.PayrollPayment ||
  mongoose.model("PayrollPayment", payrollPaymentSchema);

export default PayrollPayment;
