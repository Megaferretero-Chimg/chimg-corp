import mongoose, { Schema } from "mongoose";

const warehouseSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true, uppercase: true },
    location: { type: String, trim: true, default: "" },
    sourceNames: [{ type: String, trim: true, uppercase: true }],
    isActive: { type: Boolean, default: true },
    createdFromImport: { type: Boolean, default: false },
  },
  { timestamps: true },
);

warehouseSchema.index({ code: 1 }, { unique: true });
warehouseSchema.index({ name: 1 }, { unique: true });
warehouseSchema.index({ sourceNames: 1 });

export default mongoose.models.BusinessWarehouse
  || mongoose.model("BusinessWarehouse", warehouseSchema);
