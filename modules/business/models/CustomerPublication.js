import mongoose, { Schema } from "mongoose";

const customerPublicationSchema = new Schema({
  customerImport: { type: Schema.Types.ObjectId, ref: "BusinessCustomerImport", required: true, unique: true },
  version: { type: String, required: true, trim: true, unique: true },
  generatedAt: { type: Date, required: true },
  generatedAtText: { type: String, required: true, trim: true },
  publishedAt: { type: Date, required: true },
  publishedBy: { type: String, required: true, trim: true },
  checksum: { type: String, required: true, trim: true, lowercase: true },
  customerCount: { type: Number, required: true, min: 0 },
  byteLength: { type: Number, required: true, min: 2 },
  chunkCount: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ["published", "superseded"], default: "published" },
}, { timestamps: true });

customerPublicationSchema.index({ status: 1, publishedAt: -1 });
export default mongoose.models.BusinessCustomerPublication || mongoose.model("BusinessCustomerPublication", customerPublicationSchema);
