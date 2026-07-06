import mongoose, { Schema } from "mongoose";

const organizationNodeSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    subtitle: {
      type: String,
      trim: true,
      default: "",
    },
    nodeType: {
      type: String,
      enum: ["position", "area", "committee", "support", "external"],
      default: "position",
    },
    level: {
      type: Number,
      min: 1,
      max: 10,
      default: 1,
    },
    parentId: {
      type: String,
      trim: true,
      default: "",
    },
    parentTitle: {
      type: String,
      trim: true,
      default: "",
    },
    areaCode: {
      type: String,
      trim: true,
      default: "",
    },
    areaName: {
      type: String,
      trim: true,
      default: "",
    },
    roleCode: {
      type: String,
      trim: true,
      default: "",
    },
    roleName: {
      type: String,
      trim: true,
      default: "",
    },
    responsibleEmployeeId: {
      type: String,
      trim: true,
      default: "",
    },
    responsibleEmployeeName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    positionX: {
      type: Number,
      default: null,
    },
    positionY: {
      type: Number,
      default: null,
    },
    width: {
      type: Number,
      default: null,
    },
    height: {
      type: Number,
      default: null,
    },
    notes: {
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

organizationNodeSchema.index({ code: 1 }, { unique: true });
organizationNodeSchema.index({ isActive: 1, level: 1, sortOrder: 1, title: 1 });
organizationNodeSchema.index({ isActive: 1, nodeType: 1, areaCode: 1 });
organizationNodeSchema.index({ parentId: 1, sortOrder: 1 });
organizationNodeSchema.index({ level: 1, sortOrder: 1 });
organizationNodeSchema.index({ positionX: 1, positionY: 1 });

const OrganizationNode =
  mongoose.models.OrganizationNode ||
  mongoose.model("OrganizationNode", organizationNodeSchema);

export default OrganizationNode;
