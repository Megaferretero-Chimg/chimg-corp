import mongoose from "mongoose";

function normalizeScheduleTimeText(value) {
  return String(value || "").replace(
    /\b(\d{1,2})\s*([Hh.]|:)\s*(\d{2})\b/g,
    (match, hoursValue, _separator, minutesValue) => {
      const hours = Number(hoursValue);
      const minutes = Number(minutesValue);

      if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) {
        return match;
      }

      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    },
  );
}

const shouldApply = process.argv.includes("--apply");

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI no está configurado.");
}

await mongoose.connect(process.env.MONGODB_URI);

try {
  const database = mongoose.connection.db;
  const templatesCollection = database.collection("basescheduletemplates");
  const rolesCollection = database.collection("roles");
  const templates = await templatesCollection
    .find({ name: /\d{1,2}[Hh]\d{2}/ })
    .project({ name: 1 })
    .toArray();
  const roles = await rolesCollection
    .find({
      $or: [
        { fixedScheduleTemplateName: /\d{1,2}[Hh]\d{2}/ },
        { fixedScheduleTemplateSourceName: /\d{1,2}[Hh]\d{2}/ },
      ],
    })
    .project({ fixedScheduleTemplateName: 1, fixedScheduleTemplateSourceName: 1 })
    .toArray();
  const templateChanges = templates
    .map((template) => ({
      id: template._id,
      before: template.name || "",
      after: normalizeScheduleTimeText(template.name),
    }))
    .filter((change) => change.before !== change.after);
  const roleChanges = roles
    .map((role) => ({
      id: role._id,
      fixedScheduleTemplateName: normalizeScheduleTimeText(role.fixedScheduleTemplateName),
      fixedScheduleTemplateSourceName: normalizeScheduleTimeText(role.fixedScheduleTemplateSourceName),
    }));

  if (shouldApply) {
    if (templateChanges.length) {
      await templatesCollection.bulkWrite(
        templateChanges.map((change) => ({
          updateOne: {
            filter: { _id: change.id },
            update: { $set: { name: change.after } },
          },
        })),
      );
    }

    if (roleChanges.length) {
      await rolesCollection.bulkWrite(
        roleChanges.map((change) => ({
          updateOne: {
            filter: { _id: change.id },
            update: {
              $set: {
                fixedScheduleTemplateName: change.fixedScheduleTemplateName,
                fixedScheduleTemplateSourceName: change.fixedScheduleTemplateSourceName,
              },
            },
          },
        })),
      );
    }
  }

  console.log(JSON.stringify({
    mode: shouldApply ? "applied" : "dry-run",
    templates: templateChanges.length,
    roles: roleChanges.length,
  }, null, 2));
} finally {
  await mongoose.disconnect();
}
