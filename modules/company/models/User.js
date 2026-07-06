import mongoose, { Schema } from "mongoose";

const userSchema = new Schema(
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
    employeeDni: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    passwordHash: {
      type: String,
      required: true,
    },
    accessRole: {
      type: String,
      trim: true,
      default: "viewer",
    },
    accessRoleLabel: {
      type: String,
      trim: true,
      default: "Consulta",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

userSchema.index(
  { employeeId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      employeeId: { $type: "string", $gt: "" },
    },
  },
);
userSchema.index({ username: 1 }, { unique: true });
userSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      email: { $type: "string", $gt: "" },
    },
  },
);

if (process.env.NODE_ENV !== "production" && mongoose.models.User) {
  delete mongoose.models.User;
}

const User = mongoose.models.User || mongoose.model("User", userSchema);

export default User;
