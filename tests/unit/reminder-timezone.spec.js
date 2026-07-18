import { expect, test } from "@playwright/test";
import { localDateIso, localDateTimeToUtc, localTomorrowIso, permittedReminderSchedule, permittedReminderTime } from "../../lib/reminders/timezone.js";

test("tomorrow is a local calendar date across positive and negative offsets", () => {
  const now = new Date("2026-12-31T23:30:00Z");
  expect(localTomorrowIso(now, "Europe/London")).toBe("2027-01-01");
  expect(localTomorrowIso(now, "Pacific/Auckland")).toBe("2027-01-02");
  expect(localTomorrowIso(new Date("2027-01-01T05:00:00Z"), "America/Los_Angeles")).toBe("2027-01-01");
});

test("Europe/London scheduling follows daylight saving offsets", () => {
  expect(localDateTimeToUtc("2026-01-15", "18:00", "Europe/London").toISOString()).toBe("2026-01-15T18:00:00.000Z");
  expect(localDateTimeToUtc("2026-07-15", "18:00", "Europe/London").toISOString()).toBe("2026-07-15T17:00:00.000Z");
});

test("DST boundaries, leap day and month boundaries retain the intended local date", () => {
  for (const [date, time, zone] of [
    ["2026-03-29", "01:30", "Europe/London"],
    ["2026-10-25", "01:30", "Europe/London"],
    ["2028-02-29", "18:00", "Europe/London"],
    ["2026-12-31", "18:00", "Asia/Kolkata"],
  ]) {
    const utc = localDateTimeToUtc(date, time, zone);
    expect(localDateIso(utc, zone)).toBe(date);
  }
});

test("a preferred time inside overnight quiet hours moves to quiet-hours end", () => {
  expect(permittedReminderTime("21:00", "20:00", "08:00")).toBe("08:00");
  expect(permittedReminderTime("18:00", "20:00", "08:00")).toBe("18:00");
  expect(permittedReminderSchedule("2026-07-20", "21:00", "20:00", "08:00")).toEqual({ localDate: "2026-07-21", localTime: "08:00" });
  expect(permittedReminderSchedule("2026-07-20", "06:00", "20:00", "08:00")).toEqual({ localDate: "2026-07-20", localTime: "08:00" });
});
