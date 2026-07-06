import mongoose, { Schema } from "mongoose";

const dailyAttendanceSchema = new Schema(
  {
    upload: {
      type: Schema.Types.ObjectId,
      ref: "AttendanceUpload",
      required: true,
    },
    employee: {
      type: Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    checkIn: Date,
    lunchOut: Date,
    lunchIn: Date,
    checkOut: Date,
    workedMinutes: {
      type: Number,
      default: 0,
    },
    lateMinutes: {
      type: Number,
      default: 0,
    },
    earlyLeaveMinutes: {
      type: Number,
      default: 0,
    },
    overtimeMinutes: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: [
        "complete",
        "late",
        "overtime",
        "early_leave",
        "incomplete",
        "missing",
        "without_schedule",
      ],
      default: "complete",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

dailyAttendanceSchema.index({ upload: 1, employee: 1, date: 1 }, { unique: true });

const DailyAttendance =
  mongoose.models.DailyAttendance ||
  mongoose.model("DailyAttendance", dailyAttendanceSchema);

export default DailyAttendance;
