import mongoose, { Schema } from "mongoose";

const customerDraftSchema = new Schema({
  customerImport: { type: Schema.Types.ObjectId, ref: "BusinessCustomerImport", required: true },
  identification: { type: String, required: true, trim: true },
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
  active: { type: Boolean, default: true },
}, { timestamps: true });

customerDraftSchema.index({ customerImport: 1, identification: 1 }, { unique: true });
export default mongoose.models.BusinessCustomerDraft || mongoose.model("BusinessCustomerDraft", customerDraftSchema);
