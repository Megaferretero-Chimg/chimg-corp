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
    supervisorRoleCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    supervisorRoleName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    scheduleMode: {
      type: String,
      enum: ["variable", "fixed"],
      default: "variable",
    },
    punchesAffectHours: {
      type: Boolean,
      default: true,
    },
    fixedScheduleTemplate: {
      type: Schema.Types.ObjectId,
      ref: "BaseScheduleTemplate",
      default: null,
    },
    fixedScheduleTemplateName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    fixedScheduleTemplateSourceName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    fixedScheduleAreaCode: {
      type: String,
      trim: true,
      default: "",
    },
    fixedScheduleAreaName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    fixedScheduleRoleCode: {
      type: String,
      trim: true,
      default: "",
    },
    fixedScheduleRoleName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    fixedScheduleRotationGroup: {
      type: String,
      trim: true,
      default: "",
    },
    fixedScheduleWeeklyRows: {
      type: [scheduleDaySchema],
      default: [],
    },
    functions: {
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
roleSchema.index({ isActive: 1, name: 1 });
roleSchema.index({ supervisorRoleCode: 1 });
roleSchema.index({ scheduleMode: 1, fixedScheduleTemplate: 1 });
roleSchema.index({ punchesAffectHours: 1, isActive: 1 });

if (
  mongoose.models.Role &&
  (!mongoose.models.Role.schema.path("supervisorRoleCode") ||
    !mongoose.models.Role.schema.path("scheduleMode") ||
    !mongoose.models.Role.schema.path("punchesAffectHours"))
) {
  delete mongoose.models.Role;
}

const Role = mongoose.models.Role || mongoose.model("Role", roleSchema);

export default Role;
