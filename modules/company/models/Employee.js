import mongoose, { Schema } from "mongoose";

const employeeSchema = new Schema(
  {
    documentType: {
      type: String,
      trim: true,
      lowercase: true,
      default: "cedula",
    },
    dni: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    biometricCode: {
      type: String,
      trim: true,
      default: "",
    },
    biometricAliases: {
      type: [
        {
          branchCode: {
            type: String,
            trim: true,
            uppercase: true,
            default: "",
          },
          branchName: {
            type: String,
            trim: true,
            uppercase: true,
            default: "",
          },
          biometricCode: {
            type: String,
            trim: true,
            default: "",
          },
        },
      ],
      default: [],
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    personalEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    employmentRelation: {
      type: String,
      enum: ["nomina", "prestacion_servicios"],
      default: "nomina",
    },
    salary: {
      type: Number,
      default: 0,
      min: 0,
    },
    birthDate: {
      type: Date,
      default: null,
    },
    employmentStartDate: {
      type: Date,
      default: null,
    },
    branchId: {
      type: String,
      trim: true,
      default: "",
    },
    branchCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    branchName: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    branch: {
      type: String,
      trim: true,
      uppercase: true,
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
    roleAssignments: {
      type: [
        {
          code: {
            type: String,
            trim: true,
            default: "",
          },
          name: {
            type: String,
            trim: true,
            uppercase: true,
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
            uppercase: true,
            default: "",
          },
          isPrimary: {
            type: Boolean,
            default: false,
          },
        },
      ],
      default: [],
    },
    department: {
      type: String,
      trim: true,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    terminationDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

employeeSchema.index(
  { dni: 1 },
  {
    unique: true,
    partialFilterExpression: {
      dni: { $type: "string", $gt: "" },
    },
  },
);

employeeSchema.index(
  { branchCode: 1, biometricCode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      branchCode: { $type: "string", $gt: "" },
      biometricCode: { $type: "string", $gt: "" },
    },
  },
);

employeeSchema.index({
  "biometricAliases.branchCode": 1,
  "biometricAliases.biometricCode": 1,
});
employeeSchema.index({ isActive: 1, fullName: 1 });

const Employee =
  mongoose.models.Employee || mongoose.model("Employee", employeeSchema);

export default Employee;
