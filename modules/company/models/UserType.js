import mongoose, { Schema } from "mongoose";

const userTypeSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    permissions: {
      type: [String],
      default: [],
    },
    scopeType: {
      type: String,
      enum: ["company", "branch", "area", "team", "self"],
      default: "company",
    },
    landingPath: {
      type: String,
      trim: true,
      default: "/modules",
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

userTypeSchema.index({ code: 1 }, { unique: true });
userTypeSchema.index({ name: 1 }, { unique: true });

if (process.env.NODE_ENV !== "production" && mongoose.models.UserType) {
  delete mongoose.models.UserType;
}

const UserType =
  mongoose.models.UserType || mongoose.model("UserType", userTypeSchema);

export default UserType;
