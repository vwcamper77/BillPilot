const PARTS_FORMATTERS = new Map();

function formatter(timeZone) {
  if (!PARTS_FORMATTERS.has(timeZone)) {
    PARTS_FORMATTERS.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }));
  }
  return PARTS_FORMATTERS.get(timeZone);
}

export function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format(new Date());
    return Boolean(value);
  } catch {
    return false;
  }
}

export function isValidLocalTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

export function zonedParts(date, timeZone) {
  const values = Object.fromEntries(formatter(timeZone).formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
    weekday: values.weekday,
  };
}

export function localDateIso(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addLocalDays(isoDate, days) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return shifted.toISOString().slice(0, 10);
}

export function localTomorrowIso(now, timeZone) {
  return addLocalDays(localDateIso(now, timeZone), 1);
}

export function minutesOfDay(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
}

export function isInsideQuietHours(localTime, quietStart, quietEnd) {
  const value = minutesOfDay(localTime);
  const start = minutesOfDay(quietStart);
  const end = minutesOfDay(quietEnd);
  if (start === end) return false;
  return start < end ? value >= start && value < end : value >= start || value < end;
}

export function permittedReminderTime(preferred, quietStart, quietEnd) {
  return isInsideQuietHours(preferred, quietStart, quietEnd) ? quietEnd : preferred;
}

export function permittedReminderSchedule(localDate, preferred, quietStart, quietEnd) {
  if (!isInsideQuietHours(preferred, quietStart, quietEnd)) {
    return { localDate, localTime: preferred };
  }
  const overnight = minutesOfDay(quietStart) > minutesOfDay(quietEnd);
  const belongsToNextMorning = overnight && minutesOfDay(preferred) >= minutesOfDay(quietStart);
  return {
    localDate: belongsToNextMorning ? addLocalDays(localDate, 1) : localDate,
    localTime: quietEnd,
  };
}

function localComparable(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
}

export function localDateTimeToUtc(isoDate, localTime, timeZone) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  const [hour, minute] = String(localTime).split(":").map(Number);
  const desired = { year, month, day, hour, minute, second: 0 };
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(candidate, timeZone);
    const difference = localComparable(desired) - localComparable(actual);
    if (difference === 0) return candidate;
    candidate = new Date(candidate.getTime() + difference);
  }

  // A DST jump can make a local time nonexistent. Move forward to the first
  // valid minute on the intended local date rather than sending early.
  for (let minuteOffset = 1; minuteOffset <= 180; minuteOffset += 1) {
    const probe = new Date(candidate.getTime() + minuteOffset * 60000);
    const actual = zonedParts(probe, timeZone);
    if (localDateIso(probe, timeZone) === isoDate
      && localComparable(actual) >= localComparable(desired)) return probe;
  }
  return candidate;
}

export function calendarDayAge(start, now, timeZone) {
  if (!start) return 0;
  const startIso = localDateIso(new Date(start), timeZone);
  const nowIso = localDateIso(new Date(now), timeZone);
  const startMs = Date.parse(`${startIso}T00:00:00Z`);
  const nowMs = Date.parse(`${nowIso}T00:00:00Z`);
  return Math.max(0, Math.floor((nowMs - startMs) / 86400000));
}

export function localWeekday(date, timeZone) {
  return zonedParts(date, timeZone).weekday;
}
