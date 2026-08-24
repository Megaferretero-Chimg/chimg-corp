import mongoose, { Schema } from "mongoose";

const inventoryPublicationSchema = new Schema(
  {
    inventoryImport: {
      type: Schema.Types.ObjectId,
      ref: "BusinessInventoryImport",
      required: true,
      unique: true,
    },
    version: { type: String, required: true, trim: true, unique: true },
    generatedAt: { type: Date, required: true },
    generatedAtText: { type: String, required: true, trim: true },
    publishedAt: { type: Date, required: true },
    publishedBy: { type: String, required: true, trim: true },
    publishedByUser: { type: String, trim: true, default: "" },
    checksum: { type: String, required: true, trim: true, lowercase: true },
    productCount: { type: Number, required: true, min: 0 },
    stockCount: { type: Number, required: true, min: 0 },
    byteLength: { type: Number, required: true, min: 2 },
    chunkCount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["published", "superseded"], default: "published" },
    packageRef: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

inventoryPublicationSchema.index({ status: 1, publishedAt: -1 });

inventoryPublicationSchema.pre("save", function protectPublishedSnapshot() {
  if (!this.isNew) {
    const modified = this.modifiedPaths().filter((path) => !["status", "updatedAt"].includes(path));
    if (modified.length) throw new Error("Las versiones publicadas son inmutables.");
  }
});

function protectPublicationUpdate() {
  const update = this.getUpdate() || {};
  const touched = new Set([
    ...Object.keys(update).filter((key) => !key.startsWith("$")),
    ...Object.keys(update.$set || {}),
    ...Object.keys(update.$unset || {}),
    ...Object.keys(update.$inc || {}),
  ]);
  const forbidden = [...touched].filter((path) => !["status", "updatedAt"].includes(path));
  if (forbidden.length) throw new Error("Las versiones publicadas son inmutables.");
}

["findOneAndUpdate", "updateOne", "updateMany"].forEach((operation) => {
  inventoryPublicationSchema.pre(operation, protectPublicationUpdate);
});

["deleteOne", "deleteMany", "findOneAndDelete"].forEach((operation) => {
  inventoryPublicationSchema.pre(operation, function rejectPublicationDelete() {
    throw new Error("Las versiones publicadas no se pueden eliminar.");
  });
});

export default mongoose.models.BusinessInventoryPublication
  || mongoose.model("BusinessInventoryPublication", inventoryPublicationSchema);
