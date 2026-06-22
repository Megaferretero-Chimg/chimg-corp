import mongoose, { Schema } from "mongoose";

const roleSchema = new Schema(
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
    areaCode: {
      type: String,
      required: true,
      trim: true,
    },
    areaName: {
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
    subroles: {
      type: [
        {
          code: {
            type: String,
            trim: true,
            uppercase: true,
            default: "",
          },
          name: {
            type: String,
            trim: true,
            uppercase: true,
            default: "",
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
      ],
      default: [],
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

roleSchema.index({ code: 1 }, { unique: true });
roleSchema.index({ areaCode: 1, name: 1 }, { unique: true });

const Role = mongoose.models.Role || mongoose.model("Role", roleSchema);

export default Role;
