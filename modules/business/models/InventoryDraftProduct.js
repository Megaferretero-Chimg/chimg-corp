import mongoose, { Schema } from "mongoose";

const draftStockSchema = new Schema(
  {
    warehouse: { type: String, required: true, trim: true, uppercase: true },
    quantity: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const inventoryDraftProductSchema = new Schema(
  {
    inventoryImport: {
      type: Schema.Types.ObjectId,
      ref: "BusinessInventoryImport",
      required: true,
    },
    code: { type: String, required: true, trim: true },
    barcode: { type: String, trim: true, default: "" },
    description: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
    stocks: { type: [draftStockSchema], default: [] },
  },
  { timestamps: true },
);

inventoryDraftProductSchema.index({ inventoryImport: 1, code: 1 }, { unique: true });
inventoryDraftProductSchema.index({ inventoryImport: 1 });

export default mongoose.models.BusinessInventoryDraftProduct
  || mongoose.model("BusinessInventoryDraftProduct", inventoryDraftProductSchema);
