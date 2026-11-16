import mongoose, { Schema } from "mongoose";

const courseCategorySchema = new Schema({
  code: { type: String, enum: ["onboarding", "express"], unique: true, sparse: true },
  isActive: { type: Boolean, default: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  normalizedName: { type: String, required: true, unique: true },
}, { timestamps: true });

export default mongoose.models.AcademyCourseCategory ||
  mongoose.model("AcademyCourseCategory", courseCategorySchema);
