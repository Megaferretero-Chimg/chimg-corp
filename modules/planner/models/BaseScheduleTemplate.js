import mongoose, { Schema } from "mongoose";

const scheduleDaySchema = new Schema(
  {
    dayOfWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 6,
    },
    dayType: {
      type: String,
      enum: ["workday", "vacation", "holiday", "weekend_overtime", "off_day"],
      default: "workday",
    },
    startTime: {
      type: String,
      trim: true,
      default: "",
    },
    lunchDurationMinutes: {
      type: Number,
      min: 0,
      default: 60,
    },
    lunchStartTime: {
      type: String,
      trim: true,
      default: "",
    },
    lunchEndTime: {
      type: String,
      trim: true,
      default: "",
    },
    hasLunch: {
      type: Boolean,
      default: true,
    },
    endTime: {
      type: String,
      trim: true,
      default: "",
    },
    authorizedExtraMinutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    graceMinutes: {
      type: Number,
      min: 0,
      default: 10,
    },
  },
  { _id: false },
);

const baseScheduleTemplateSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    areaCode: {
      type: String,
      trim: true,
      default: "",
    },
    areaName: {
      type: String,
      trim: true,
      uppercase: true,
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
      uppercase: true,
      default: "",
    },
    rotationGroup: {
      type: String,
      trim: true,
      default: "",
    },
    weeklyRows: {
      type: [scheduleDaySchema],
      default: [],
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

baseScheduleTemplateSchema.index(
  { name: 1 },
  {
    unique: true,
    name: "name_1_active_unique",
    partialFilterExpression: { isActive: true },
  },
);
baseScheduleTemplateSchema.index({ isActive: 1, name: 1 }, { name: "isActive_1_name_1" });

if (process.env.NODE_ENV !== "production" && mongoose.models.BaseScheduleTemplate) {
  delete mongoose.models.BaseScheduleTemplate;
}

const BaseScheduleTemplate =
  mongoose.models.BaseScheduleTemplate ||
  mongoose.model("BaseScheduleTemplate", baseScheduleTemplateSchema);

export default BaseScheduleTemplate;
