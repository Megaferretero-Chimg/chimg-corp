import mongoose, { Schema } from "mongoose";

const inventoryPackageChunkSchema = new Schema(
  {
    publication: {
      type: Schema.Types.ObjectId,
      ref: "BusinessInventoryPublication",
      required: true,
    },
    index: { type: Number, required: true, min: 0 },
    data: { type: Buffer, required: true },
  },
  { timestamps: true },
);

inventoryPackageChunkSchema.index({ publication: 1, index: 1 }, { unique: true });

function rejectChunkMutation() {
  throw new Error("Los bytes de un paquete publicado son inmutables.");
}

[
  "deleteMany",
  "deleteOne",
  "findOneAndDelete",
  "findOneAndReplace",
  "findOneAndUpdate",
  "replaceOne",
  "updateMany",
  "updateOne",
].forEach((operation) => inventoryPackageChunkSchema.pre(operation, rejectChunkMutation));

inventoryPackageChunkSchema.pre("save", function protectExistingChunk() {
  if (!this.isNew) rejectChunkMutation();
});

export default mongoose.models.BusinessInventoryPackageChunk
  || mongoose.model("BusinessInventoryPackageChunk", inventoryPackageChunkSchema);
