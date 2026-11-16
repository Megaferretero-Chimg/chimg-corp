import { isValidQuestionPoints } from "../module.js";
import mongoose, { Schema } from "mongoose";

const mediaSchema = new Schema({
  publicId: { type: String, required: true },
  kind: { type: String, enum: ["image", "video"], required: true },
  format: { type: String, required: true },
}, { _id: false });

const textPartSchema = new Schema({
  style: { type: String, enum: ["paragraph", "heading", "subheading", "bullets", "numbered"], required: true },
  text: { type: String, default: "" },
}, { _id: false });

const lessonBlockSchema = new Schema({
  kind: { type: String, enum: ["text", "image", "video", "divider"], required: true },
  label: { type: String, trim: true, maxlength: 100 },
  parts: { type: [textPartSchema], default: undefined },
  asset: mediaSchema,
  images: { type: [mediaSchema], default: undefined },
  assets: { type: [mediaSchema], default: undefined },
}, { _id: false });

const lessonSchema = new Schema({
  title: { type: String, required: true, trim: true },
  content: { type: String, trim: true, default: "" },
  media: [mediaSchema],
  blocks: { type: [lessonBlockSchema], default: undefined },
});

const questionSchema = new Schema({
  prompt: { type: String, required: true, trim: true },
  image: mediaSchema,
  images: { type: [mediaSchema], default: undefined },
  points: { type: Number, default: 1, validate: isValidQuestionPoints },
  options: {
    type: [{ type: String, required: true, trim: true }],
    validate: {
      validator: (options) => options.length >= 2,
      message: "Cada pregunta debe tener al menos dos opciones.",
    },
  },
  correctOptionIndex: {
    type: Number,
    required: true,
    validate: {
      validator(index) {
        return Number.isInteger(index) && index >= 0 && index < this.options.length;
      },
      message: "La respuesta correcta debe corresponder a una de las opciones.",
    },
  },
});

const chapterSchema = new Schema({
  title: { type: String, required: true, trim: true },
  lessons: [lessonSchema],
  questions: [questionSchema],
  evaluation: {
    timeLimitMinutes: { type: Number, min: 1, validate: (value) => value == null || Number.isInteger(value) },
    questionsPerAttempt: { type: Number, min: 1, validate: (value) => value == null || Number.isInteger(value) },
    allowAnswerChanges: { type: Boolean, default: true },
    maxGrade: { type: Number, min: 0.01, default: 10 },
  },
});

const courseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    type: { type: String, match: /^(onboarding|express|[a-f0-9]{24})$/, required: true },
    status: { type: String, enum: ["draft", "published"], required: true, default: "draft" },
    chapters: [chapterSchema],
    finalEvaluation: {
      questions: [questionSchema],
    },
    roleIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Role", required: true }],
      validate: {
        validator: (ids) => ids.length === new Set(ids.map(String)).size,
        message: "Cada cargo solo se puede asignar una vez al curso.",
      },
    },
  },
  { timestamps: true, optimisticConcurrency: true },
);

courseSchema.pre("validate", function () {
  if (this.status !== "published") return;

  if (!this.chapters.length || this.chapters.some(({ lessons }) => !lessons.length)) {
    this.invalidate("chapters", "El curso debe tener capítulos y cada capítulo debe incluir una lección.");
  }

  if (this.chapters.some(({ questions }) => !questions.length) && !this.finalEvaluation?.questions?.length) {
    this.invalidate("chapters", "Cada capítulo debe incluir una evaluación.");
  }

  if (!this.roleIds.length) {
    this.invalidate("roleIds", "Selecciona al menos un cargo para publicar el curso.");
  }
});

export default mongoose.models.AcademyCourse || mongoose.model("AcademyCourse", courseSchema);
