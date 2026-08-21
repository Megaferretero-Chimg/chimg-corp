import mongoose, { Schema } from "mongoose";

const inventoryImportSchema = new Schema(
  {
    fileName: { type: String, required: true, trim: true },
    fileSize: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["processing", "processed", "processed_with_warnings", "failed"],
      default: "processing",
    },
    totalRows: { type: Number, default: 0 },
    processedRows: { type: Number, default: 0 },
    skippedRows: { type: Number, default: 0 },
    productCount: { type: Number, default: 0 },
    warehouseCount: { type: Number, default: 0 },
    stockCount: { type: Number, default: 0 },
    warnings: [{ type: String, trim: true }],
    uploadedBy: { type: String, trim: true, default: "" },
    uploadedByUser: { type: String, trim: true, default: "" },
    importedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

inventoryImportSchema.index({ createdAt: -1 });

export default mongoose.models.BusinessInventoryImport
  || mongoose.model("BusinessInventoryImport", inventoryImportSchema);
