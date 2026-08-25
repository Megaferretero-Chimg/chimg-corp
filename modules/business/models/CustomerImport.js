import mongoose, { Schema } from "mongoose";

const customerImportSchema = new Schema({
  fileName: { type: String, required: true, trim: true },
  fileSize: { type: Number, default: 0 },
  status: { type: String, enum: ["processing", "validated", "needs_review", "published", "failed"], default: "processing" },
  sourceGeneratedAt: { type: Date, default: null },
  publishedVersion: { type: String, trim: true, default: "" },
  totalRows: { type: Number, default: 0 },
  processedRows: { type: Number, default: 0 },
  skippedRows: { type: Number, default: 0 },
  customerCount: { type: Number, default: 0 },
  warnings: [{ type: String, trim: true }],
  validationErrors: [{ type: String, trim: true }],
  uploadedBy: { type: String, trim: true, default: "" },
  uploadedByUser: { type: String, trim: true, default: "" },
  importedAt: { type: Date, default: null },
}, { timestamps: true });

customerImportSchema.index({ createdAt: -1 });
export default mongoose.models.BusinessCustomerImport || mongoose.model("BusinessCustomerImport", customerImportSchema);
