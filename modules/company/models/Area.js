import mongoose, { Schema } from "mongoose";

const areaSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

areaSchema.index({ code: 1 }, { unique: true });
areaSchema.index({ name: 1 }, { unique: true });
areaSchema.index({ isActive: 1, name: 1 });

const Area = mongoose.models.Area || mongoose.model("Area", areaSchema);

export default Area;
