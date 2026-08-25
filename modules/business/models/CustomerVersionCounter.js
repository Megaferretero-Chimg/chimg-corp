import mongoose, { Schema } from "mongoose";

const customerVersionCounterSchema = new Schema({
  dateKey: { type: String, required: true, unique: true, trim: true },
  sequence: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: true });

export default mongoose.models.BusinessCustomerVersionCounter || mongoose.model("BusinessCustomerVersionCounter", customerVersionCounterSchema);
