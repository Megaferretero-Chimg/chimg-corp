import mongoose, { Schema } from "mongoose";

const branchSchema = new Schema(
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
    },
    city: {
      type: String,
      trim: true,
      default: "",
    },
    address: {
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

branchSchema.index({ code: 1 }, { unique: true });
branchSchema.index({ name: 1 }, { unique: true });

const Branch =
  mongoose.models.Branch || mongoose.model("Branch", branchSchema);

export default Branch;
