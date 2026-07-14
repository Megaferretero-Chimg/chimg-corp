import mongoose, { Schema } from "mongoose";

const areaLunchRuleSchema = new Schema(
  {
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
    lunchDurationMinutes: {
      type: Number,
      min: 0,
      default: 60,
    },
  },
  { _id: false },
);

const roleLunchRuleSchema = new Schema(
  {
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
    lunchDurationMinutes: {
      type: Number,
      min: 0,
      default: 60,
    },
  },
  { _id: false },
);

const employeeLunchRuleSchema = new Schema(
  {
    employeeId: {
      type: String,
      trim: true,
      default: "",
    },
    employeeName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    lunchDurationMinutes: {
      type: Number,
      min: 0,
      default: 60,
    },
  },
  { _id: false },
);

const payrollNeutralRoleRuleSchema = new Schema(
  {
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
    label: {
      type: String,
      trim: true,
      default: "",
    },
    scheduleAffectsSalary: {
      type: Boolean,
      default: false,
    },
    appliesSupplementaryHours: {
      type: Boolean,
      default: false,
    },
    appliesExtraordinaryHours: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

const laborRuleConfigSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      default: "default",
    },
    companyStartTime: {
      type: String,
      trim: true,
      default: "07:00",
    },
    companyEndTime: {
      type: String,
      trim: true,
      default: "19:00",
    },
    dailyBaseHours: {
      type: Number,
      min: 1,
      default: 8,
    },
    weeklyBaseHours: {
      type: Number,
      min: 1,
      default: 40,
    },
    defaultGraceMinutes: {
      type: Number,
      min: 0,
      default: 10,
    },
    maxSupplementaryMinutesPerDay: {
      type: Number,
      min: 0,
      default: 60,
    },
    maxSupplementaryMinutesPerWeek: {
      type: Number,
      min: 0,
      default: 300,
    },
    maxExtraordinaryDaysPerMonth: {
      type: Number,
      min: 0,
      max: 31,
      default: 2,
    },
    supplementaryMultiplier: {
      type: Number,
      min: 1,
      default: 1.5,
    },
    extraordinaryMultiplier: {
      type: Number,
      min: 1,
      default: 2,
    },
    paidVacationAsWorkday: {
      type: Boolean,
      default: true,
    },
    vacationIncludesSupplementaryHour: {
      type: Boolean,
      default: false,
    },
    areaLunchRules: {
      type: [areaLunchRuleSchema],
      default: [],
    },
    roleLunchRules: {
      type: [roleLunchRuleSchema],
      default: [],
    },
    employeeLunchRules: {
      type: [employeeLunchRuleSchema],
      default: [],
    },
    payrollNeutralRoleRules: {
      type: [payrollNeutralRoleRuleSchema],
      default: [],
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

laborRuleConfigSchema.index({ key: 1 }, { unique: true });

if (process.env.NODE_ENV !== "production" && mongoose.models.LaborRuleConfig) {
  delete mongoose.models.LaborRuleConfig;
}

const LaborRuleConfig =
  mongoose.models.LaborRuleConfig ||
  mongoose.model("LaborRuleConfig", laborRuleConfigSchema);

export default LaborRuleConfig;
