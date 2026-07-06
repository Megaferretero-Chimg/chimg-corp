import mongoose, { Schema } from "mongoose";

const workScheduleSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    weekStartDate: {
      type: Date,
      required: true,
    },
    weekKey: {
      type: String,
      required: true,
      trim: true,
    },
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
      default: 60,
      enum: [0, 30, 60, 90],
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
    graceMinutes: {
      type: Number,
      default: 10,
      min: 0,
    },
    isWorkingDay: {
      type: Boolean,
      default: true,
    },
    isPaidDay: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

workScheduleSchema.index({ employee: 1, weekKey: 1, dayOfWeek: 1 }, { unique: true });
workScheduleSchema.index({ employee: 1, weekStartDate: -1 });

const WorkSchedule =
  mongoose.models.WorkSchedule ||
  mongoose.model("WorkSchedule", workScheduleSchema);

export default WorkSchedule;
