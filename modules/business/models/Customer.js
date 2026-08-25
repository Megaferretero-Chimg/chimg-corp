import mongoose, { Schema } from "mongoose";

const customerSchema = new Schema({
  identification: { type: String, required: true, trim: true, unique: true },
  identificationType: { type: String, trim: true, default: "CÉDULA" },
  customerType: { type: String, trim: true, default: "PERSONA" },
  firstNames: { type: String, trim: true, default: "" },
  lastNames: { type: String, trim: true, default: "" },
  name: { type: String, required: true, trim: true },
  address: { type: String, trim: true, default: "" },
  phone: { type: String, trim: true, default: "" },
  email: { type: String, trim: true, lowercase: true, default: "" },
  city: { type: String, trim: true, uppercase: true, default: "" },
  zone: { type: String, trim: true, uppercase: true, default: "" },
  isActive: { type: Boolean, default: true },
  lastImportedAt: { type: Date, default: null },
}, { timestamps: true });

customerSchema.index({ name: "text", identification: "text" });
customerSchema.index({ city: 1, customerType: 1 });

export default mongoose.models.BusinessCustomer || mongoose.model("BusinessCustomer", customerSchema);
