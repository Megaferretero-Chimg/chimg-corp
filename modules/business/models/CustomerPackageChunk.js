import mongoose, { Schema } from "mongoose";

const customerPackageChunkSchema = new Schema({
  publication: { type: Schema.Types.ObjectId, ref: "BusinessCustomerPublication", required: true },
  index: { type: Number, required: true, min: 0 },
  data: { type: Buffer, required: true },
}, { timestamps: true });

customerPackageChunkSchema.index({ publication: 1, index: 1 }, { unique: true });
export default mongoose.models.BusinessCustomerPackageChunk || mongoose.model("BusinessCustomerPackageChunk", customerPackageChunkSchema);
