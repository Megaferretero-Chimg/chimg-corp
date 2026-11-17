import mongoose from "mongoose";
import { notFound } from "next/navigation";
import { cache } from "react";

import { requireRequestAccess } from "@/lib/access-control";
import connectToDatabase from "@/lib/db/mongodb";
import { ACADEMY_LEARNING } from "@/modules/academy/module";
import Course from "@/modules/academy/models/Course";
import LearningProgress from "@/modules/academy/models/LearningProgress";
import Employee from "@/modules/company/models/Employee";
import Role from "@/modules/company/models/Role";

export const getLearner = cache(async function getLearner() {
  const { user, isAllowed } = await requireRequestAccess(ACADEMY_LEARNING.href);
  if (!isAllowed || !mongoose.isObjectIdOrHexString(user.employeeId)) notFound();

  await connectToDatabase();
  const employee = await Employee.findOne({ _id: user.employeeId, isActive: { $ne: false } })
    .select("fullName roleCode roleAssignments.code").lean();
  if (!employee) notFound();

  const codes = [...new Set([employee.roleCode, ...(employee.roleAssignments ?? []).map(({ code }) => code)]
    .filter(Boolean).map((code) => code.trim().toUpperCase()))];
  const roleIds = await Role.distinct("_id", { code: { $in: codes }, isActive: { $ne: false } });
  return { employeeId: String(employee._id), name: employee.fullName, roleIds };
});

export function assignedCourseFilter({ roleIds }) {
  return { status: "published", roleIds: { $in: roleIds } };
}

export async function getLearningCourse(courseId) {
  if (!mongoose.isObjectIdOrHexString(courseId)) notFound();
  const learner = await getLearner();
  const course = await Course.findOne({ ...assignedCourseFilter(learner), _id: courseId }).lean();
  if (!course) notFound();

  const progressId = learner.employeeId + ":" + String(course._id);
  const progress = await LearningProgress.findById(progressId).lean();
  return { course, learner, progressId, progress, now: Date.now() };
}
