import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as dateFns from "date-fns";

// Run the production helpers with database access isolated.
const context = vm.createContext({ ...dateFns, Date, Map, Set });
function load(path) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gm, "")
    .replace(/export /g, "");
  vm.runInContext(source, context);
}
load("lib/datetime/ecuador.js");
load("modules/planner/lib/planning/holidayScope.js");
load("modules/planner/lib/planning/holidays.js");
vm.runInContext("const WEEK_DAYS = Array.from({length: 7}, (_, dayOfWeek) => ({dayOfWeek, label: String(dayOfWeek)}));", context);
load("modules/planner/lib/planning/scheduleAssignments.js");
const template = {
  _id: "template-1", name: "Diurno",
  weeklyRows: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek, dayType: "workday", startTime: "08:00", endTime: "17:00", lunchDurationMinutes: 60,
  })),
};
context.BaseScheduleTemplate = { find: () => ({ lean: async () => [template] }) };
context.Holiday = { find: () => { throw new Error("Unexpected database query"); } };
load("modules/planner/lib/planning/assignmentHolidayScope.js");
const localHoliday = { dateKey: "2026-11-12", name: "AMBATO", scope: "branches", branchCodes: ["AMB"] };

test("legacy holidays remain global; local holidays require a matching branch", () => {
  assert.equal(context.holidayAppliesToBranch({ dateKey: localHoliday.dateKey }, "SAL"), true);
  assert.equal(context.holidayAppliesToBranch(localHoliday, "AMB"), true);
  assert.equal(context.holidayAppliesToBranch(localHoliday, "SAL"), false);
  assert.equal(context.holidayAppliesToBranch(localHoliday, ""), false);
});

test("normalization validates selection and removes duplicate branch codes", () => {
  const payload = context.normalizeHolidayPayload({ ...localHoliday, branchCodes: [" amb ", "AMB"] });
  assert.equal(payload.branchCodes.join(","), "AMB");
  assert.throws(() => context.normalizeHolidayPayload({ ...localHoliday, branchCodes: [] }), /sucursal/);
  assert.throws(() => context.normalizeHolidayPayload({ ...localHoliday, scope: "invalid" }), /alcance/);
  assert.equal(context.normalizeHolidayPayload({ ...localHoliday, scope: "all" }).branchCodes.length, 0);
});

test("generation applies a local holiday only to assigned branches", () => {
  for (const [branchCode, expected] of [["AMB", "holiday"], ["SAL", "workday"]]) {
    const assignment = context.buildAssignmentPayload({
      employee: { _id: branchCode, branchCode }, template, monthKey: "2026-11", holidays: [localHoliday],
    });
    assert.equal(assignment.generatedDays.find(day => day.dateKey === localHoliday.dateKey).dayType, expected);
  }
});

test("weekly plans also respect branch scope", () => {
  const weeklyPlan = context.getMonthWeekOptions("2026-11").map(week => ({ ...week, template }));
  const assignment = context.buildAssignmentPayload({
    employee: { _id: "salcedo", branchCode: "SAL" }, monthKey: "2026-11", holidays: [localHoliday], weeklyPlan,
  });
  assert.equal(assignment.generatedDays.find(day => day.dateKey === localHoliday.dateKey).dayType, "workday");
});

test("existing global holiday rows are restored for excluded branches without changing manual shifts", async () => {
  const oldDays = context.buildGeneratedDays("2026-11", template, [localHoliday]);
  const assignments = ["AMB", "SAL"].map(branchCode => ({
    monthKey: "2026-11", branchCode, template: template._id, generatedDays: oldDays,
  }));
  const resolved = await context.resolveAssignmentHolidayScope(assignments, [localHoliday]);
  assert.equal(resolved[0], assignments[0]);
  const restored = resolved[1].generatedDays.find(day => day.dateKey === localHoliday.dateKey);
  assert.equal(restored.dayType, "workday");
  assert.equal(restored.startTime, "08:00");
  assert.equal(restored.endTime, "17:00");
  assert.equal(oldDays.find(day => day.dateKey === localHoliday.dateKey).dayType, "holiday");
  const manual = { ...assignments[1], generatedDays: [{ dateKey: localHoliday.dateKey, dayType: "workday", source: "manual_override", startTime: "10:00", endTime: "18:00" }] };
  assert.equal((await context.resolveAssignmentHolidayScope([manual], [localHoliday]))[0], manual);
});
