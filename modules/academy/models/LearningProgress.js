import mongoose, { Schema } from "mongoose";

const attemptSchema = new Schema({
  attemptId: String,
  startedAt: Date,
  finishedAt: Date,
  day: String,
  dailyCount: Number,
  passingGrade: Number,
  history: [{
    _id: false,
    attemptId: String,
    startedAt: Date,
    finishedAt: Date,
    grade: Number,
    maxGrade: Number,
    passingGrade: Number,
  }],
  questions: [{
    _id: Schema.Types.ObjectId,
    prompt: String,
    options: [String],
    points: Number,
    correctOptionIndex: Number,
    images: [{ _id: false, publicId: String, kind: String, format: String }],
  }],
  answers: { type: Map, of: Number },
  maxGrade: Number,
  allowAnswerChanges: Boolean,
  expiresAt: Date,
  revision: Number,
  result: {
    type: new Schema({ grade: Number, correct: Number, answered: Number }, { _id: false }),
    default: undefined,
  },
}, { _id: false });

const progressSchema = new Schema({
  _id: String,
  employeeId: { type: String, required: true },
  courseId: { type: Schema.Types.ObjectId, required: true },
  completedLessonIds: [String],
  attempts: { type: Map, of: attemptSchema },
});

if (process.env.NODE_ENV !== "production" && mongoose.models.AcademyLearningProgress) {
  delete mongoose.models.AcademyLearningProgress;
}

export default mongoose.models.AcademyLearningProgress ||
  mongoose.model("AcademyLearningProgress", progressSchema);
