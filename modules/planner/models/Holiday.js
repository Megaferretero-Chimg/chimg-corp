import mongoose, { Schema } from "mongoose";

const holidaySchema = new Schema(
  {
    scope: { type: String, enum: ["all", "branches"], default: "all" },
    branchCodes: { type: [{ type: String, trim: true, uppercase: true }], default: [] },
    date: {
      type: Date,
      required: true,
    },
    dateKey: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
  },
  {
    timestamps: true,
  },
);

holidaySchema.index({ dateKey: 1 }, { unique: true });

if (process.env.NODE_ENV !== "production" && mongoose.models.Holiday) {
  delete mongoose.models.Holiday;
}

const Holiday = mongoose.models.Holiday || mongoose.model("Holiday", holidaySchema);

export default Holiday;
