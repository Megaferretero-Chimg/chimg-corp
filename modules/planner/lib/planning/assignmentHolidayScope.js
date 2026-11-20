import { BaseScheduleTemplate, Holiday } from "@/modules/planner/models";
import { holidayAppliesToBranch } from "@/modules/planner/lib/planning/holidayScope";
import { buildGeneratedDays, buildGeneratedDaysFromWeeklyPlan } from "@/modules/planner/lib/planning/scheduleAssignments";

export async function resolveAssignmentHolidayScope(assignments, suppliedHolidays) {
  if (!assignments.length) return assignments;

  const monthKeys = [...new Set(assignments.map(({ monthKey }) => monthKey))];
  const holidays = suppliedHolidays ?? await Holiday.find({
    scope: "branches",
    dateKey: { $regex: `^(${monthKeys.join("|")})-` },
  }).lean();
  const holidaysByDate = new Map(holidays.map((holiday) => [holiday.dateKey, holiday]));
  const staleAssignments = assignments.filter((assignment) => assignment.generatedDays?.some((day) => {
    const holiday = holidaysByDate.get(day.dateKey);
    return holiday && !holidayAppliesToBranch(holiday, assignment.branchCode) &&
      (day.source === "holiday" || day.dayType === "holiday");
  }));
  if (!staleAssignments.length) return assignments;

  const templateIds = [...new Set(staleAssignments.flatMap((assignment) => [
    assignment.template,
    ...(assignment.weeklyPlan || []).map((entry) => entry.template),
    ...(assignment.generatedDays || []).map((day) => day.template),
  ]).filter(Boolean).map(String))];
  const templates = await BaseScheduleTemplate.find({ _id: { $in: templateIds } }).lean();
  const templatesById = new Map(templates.map((template) => [String(template._id), template]));

  return assignments.map((assignment) => {
    if (!staleAssignments.includes(assignment)) return assignment;
    const template = templatesById.get(String(assignment.template));
    const weeklyPlan = (assignment.weeklyPlan || []).map((entry) => ({
      ...entry,
      templateDoc: templatesById.get(String(entry.template)),
    }));
    const restoredDays = weeklyPlan.some(({ templateDoc }) => templateDoc)
      ? buildGeneratedDaysFromWeeklyPlan(assignment.monthKey, weeklyPlan)
      : template ? buildGeneratedDays(assignment.monthKey, template) : [];
    const restoredByDate = new Map(restoredDays.map((day) => [day.dateKey, day]));

    return {
      ...assignment,
      generatedDays: assignment.generatedDays.map((day) => {
        const holiday = holidaysByDate.get(day.dateKey);
        if (!holiday || holidayAppliesToBranch(holiday, assignment.branchCode) ||
          (day.source !== "holiday" && day.dayType !== "holiday")) return day;

        const dayTemplate = templatesById.get(String(day.template));
        const restored = dayTemplate
          ? buildGeneratedDays(assignment.monthKey, dayTemplate).find(({ dateKey }) => dateKey === day.dateKey)
          : restoredByDate.get(day.dateKey);
        return {
          ...day,
          ...(restored || { dayType: day.startTime && day.endTime ? "workday" : "off_day", source: "manual_override" }),
          isHoliday: false,
        };
      }),
    };
  });
}
