const MINUTE_MS = 60 * 1000;

export function buildPunchMinuteKey(value) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return String(Math.floor(parsed.getTime() / MINUTE_MS));
}

export function buildPunchMinuteRange(value) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const minuteStart = new Date(Math.floor(parsed.getTime() / MINUTE_MS) * MINUTE_MS);
  const minuteEnd = new Date(minuteStart.getTime() + MINUTE_MS);

  return {
    start: minuteStart,
    end: minuteEnd,
  };
}

export function dedupePunchesByMinute(punches = []) {
  const punchesByMinute = new Map();

  punches
    .filter((punch) => punch?.punchedAt)
    .sort((left, right) => {
      const leftTime = new Date(left.punchedAt).getTime();
      const rightTime = new Date(right.punchedAt).getTime();

      if (leftTime !== rightTime) return leftTime - rightTime;

      return String(left._id || left.id || "").localeCompare(String(right._id || right.id || ""));
    })
    .forEach((punch) => {
      const minuteKey = buildPunchMinuteKey(punch.punchedAt);

      if (!minuteKey || punchesByMinute.has(minuteKey)) {
        return;
      }

      punchesByMinute.set(minuteKey, punch);
    });

  return [...punchesByMinute.values()];
}
