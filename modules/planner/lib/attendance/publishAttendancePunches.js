import { AttendancePunch } from "@/modules/planner/models";
import { Employee } from "@/modules/company/models";
import { buildPunchMinuteKey } from "@/modules/planner/lib/attendance/punchIdentity";
import { formatEcuadorDateKey, getEcuadorParts, makeEcuadorDate } from "@/lib/datetime/ecuador";
import { buildEmployeeActiveInMonthQuery, isEmployeeActiveOnDate } from "@/modules/company/submodules/people/lib/employees";

function applyAttendancePunchTimeAdjustments(snapshot) {
  return snapshot;
}

function isUploadPeriod(month, year) {
  return Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year);
}

function punchBelongsToUploadPeriod(punch, upload) {
  if (!isUploadPeriod(upload.month, upload.year)) {
    return true;
  }

  const parts = getEcuadorParts(punch.punchedAt);

  return parts?.month === upload.month && parts?.year === upload.year;
}

async function findActiveEmployee(normalizedEmployee, upload) {
  const biometricCode = String(normalizedEmployee.biometricCode || "").trim();
  const branchCode = String(
    normalizedEmployee.branchCode || upload.branchCode || "",
  ).trim().toUpperCase();

  if (!biometricCode || !branchCode) {
    return null;
  }

  const activityQuery = isUploadPeriod(upload.month, upload.year)
    ? buildEmployeeActiveInMonthQuery(makeEcuadorDate(upload.year, upload.month - 1, 1))
    : { isActive: { $ne: false } };

  return Employee.findOne({
    ...activityQuery,
    $or: [
      {
        branchCode,
        biometricCode,
      },
      {
        biometricAliases: {
          $elemMatch: {
            branchCode,
            biometricCode,
          },
        },
      },
    ],
  });
}

export async function publishAttendancePunches(upload) {
  const normalizedSnapshot = applyAttendancePunchTimeAdjustments(upload.normalizedSnapshot, {
    branchCode: upload.branchCode,
    branchName: upload.branchName,
  });

  upload.normalizedSnapshot = normalizedSnapshot;

  await AttendancePunch.deleteMany({ upload: upload._id });

  let publishedEmployees = 0;
  let publishedPunches = 0;
  let skippedDuplicatePunches = 0;
  let skippedUnmatchedEmployees = 0;
  let skippedUnmatchedPunches = 0;

  for (const normalizedEmployee of normalizedSnapshot.employees || []) {
    const employee = await findActiveEmployee(normalizedEmployee, upload);

    if (!employee) {
      skippedUnmatchedEmployees += 1;
      skippedUnmatchedPunches += normalizedEmployee.punches?.length || 0;
      continue;
    }

    const rawPunches = (normalizedEmployee.punches || [])
      .filter((punch) => punchBelongsToUploadPeriod(punch, upload))
      .filter((punch) => isEmployeeActiveOnDate(employee, formatEcuadorDateKey(punch.punchedAt)))
      .map((punch) => ({
        upload: upload._id,
        employee: employee._id,
        punchedAt: punch.punchedAt,
        rawValue: punch.rawValue || "",
      }));

    const uniquePunchesByMinute = new Map();

    rawPunches.forEach((punch) => {
      const minuteKey = buildPunchMinuteKey(punch.punchedAt);

      if (!minuteKey || uniquePunchesByMinute.has(minuteKey)) {
        return;
      }

      uniquePunchesByMinute.set(minuteKey, punch);
    });

    const uniquePunches = [...uniquePunchesByMinute.values()];
    skippedDuplicatePunches += rawPunches.length - uniquePunches.length;

    if (uniquePunches.length) {
      const sortedUniquePunches = [...uniquePunches].sort(
        (left, right) => new Date(left.punchedAt).getTime() - new Date(right.punchedAt).getTime(),
      );
      const firstPunchTime = new Date(sortedUniquePunches[0].punchedAt).getTime();
      const lastPunchTime = new Date(sortedUniquePunches[sortedUniquePunches.length - 1].punchedAt).getTime();
      const firstMinute = new Date(Math.floor(firstPunchTime / 60000) * 60000);
      const lastMinute = new Date(Math.floor(lastPunchTime / 60000) * 60000 + 60000);
      const existingPunches = await AttendancePunch.find({
        employee: employee._id,
        punchedAt: {
          $gte: firstMinute,
          $lt: lastMinute,
        },
      })
        .select({ punchedAt: 1 })
        .lean();

      const existingMinuteKeys = new Set(
        existingPunches.map((punch) => buildPunchMinuteKey(punch.punchedAt)),
      );

      const punchesToInsert = uniquePunches.filter(
        (punch) => !existingMinuteKeys.has(buildPunchMinuteKey(punch.punchedAt)),
      );

      skippedDuplicatePunches += uniquePunches.length - punchesToInsert.length;

      if (punchesToInsert.length) {
        await AttendancePunch.insertMany(punchesToInsert, { ordered: false });
      }

      publishedPunches += punchesToInsert.length;
    }

    publishedEmployees += 1;
  }

  upload.punchesPublishedAt = new Date();
  upload.publishedEmployees = publishedEmployees;
  upload.publishedPunches = publishedPunches;
  upload.skippedDuplicatePunches = skippedDuplicatePunches;
  upload.skippedUnmatchedEmployees = skippedUnmatchedEmployees;
  upload.skippedUnmatchedPunches = skippedUnmatchedPunches;
  await upload.save();

  return {
    publishedAt: upload.punchesPublishedAt,
    publishedEmployees,
    publishedPunches,
    skippedDuplicatePunches,
    skippedUnmatchedEmployees,
    skippedUnmatchedPunches,
  };
}

export function buildPublishMessage(result) {
  if (result.skippedUnmatchedEmployees > 0) {
    return "Las picadas se cargaron y se omitieron códigos sin empleado activo en la sucursal.";
  }

  if (result.skippedDuplicatePunches > 0) {
    return "Las picadas se cargaron y se omitieron duplicados ya existentes.";
  }

  return "Las picadas se cargaron correctamente en el sistema.";
}
