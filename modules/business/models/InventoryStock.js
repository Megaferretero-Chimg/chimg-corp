import mongoose, { Schema } from "mongoose";

const inventoryStockSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "BusinessProduct", required: true },
    warehouse: { type: Schema.Types.ObjectId, ref: "BusinessWarehouse", required: true },
    quantity: { type: Number, default: 0 },
    fractionalQuantity: { type: Number, default: 0 },
    totalValue: { type: Number, default: 0 },
    lastImportedAt: { type: Date, default: null },
    lastImport: { type: Schema.Types.ObjectId, ref: "BusinessInventoryImport", default: null },
  },
  { timestamps: true },
);

inventoryStockSchema.index({ product: 1, warehouse: 1 }, { unique: true });
inventoryStockSchema.index({ warehouse: 1, quantity: 1 });

export default mongoose.models.BusinessInventoryStock
  || mongoose.model("BusinessInventoryStock", inventoryStockSchema);
