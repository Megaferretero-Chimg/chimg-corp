import mongoose, { Schema } from "mongoose";

const productSchema = new Schema(
  {
    saleCode: { type: String, required: true, trim: true },
    catalogCode: { type: String, trim: true, default: "" },
    productCode: { type: String, trim: true, default: "" },
    barcode: { type: String, trim: true, default: "" },
    description: { type: String, required: true, trim: true },
    companyName: { type: String, trim: true, default: "" },
    brand: { type: String, trim: true, default: "" },
    line: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, default: "" },
    group: { type: String, trim: true, default: "" },
    color: { type: String, trim: true, default: "" },
    productType: { type: String, trim: true, default: "" },
    presentation: { type: String, trim: true, default: "" },
    shelf: { type: String, trim: true, default: "" },
    specialCategory: { type: String, trim: true, default: "" },
    cost: { type: Number, default: 0, min: 0 },
    salePrice: { type: Number, default: 0, min: 0 },
    priceWithTax: { type: Number, default: 0, min: 0 },
    discountedPriceWithTax: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 0, min: 0 },
    sourceData: { type: Schema.Types.Mixed, default: {} },
    lastImportedAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

productSchema.index({ saleCode: 1 }, { unique: true });
productSchema.index({ description: "text", saleCode: "text", barcode: "text" });
productSchema.index({ brand: 1, category: 1 });

export default mongoose.models.BusinessProduct
  || mongoose.model("BusinessProduct", productSchema);
