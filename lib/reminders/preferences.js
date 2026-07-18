import { DEFAULT_REMINDER_PREFERENCES } from "./config";
import { PRIVACY_MODES, REMINDER_MODES } from "./policy";
import { isValidLocalTime, isValidTimeZone } from "./timezone";

function dateIso(value) {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
export function normaliseReminderPreferences(input = {}, { defaultStaleThresholdHours = 24 } = {}) {
  return {
    ...DEFAULT_REMINDER_PREFERENCES,
    timezone: isValidTimeZone(input.timezone) ? input.timezone : DEFAULT_REMINDER_PREFERENCES.timezone,
    balanceReminderMode: REMINDER_MODES.includes(input.balanceReminderMode) ? input.balanceReminderMode : DEFAULT_REMINDER_PREFERENCES.balanceReminderMode,
    preferredReminderTime: isValidLocalTime(input.preferredReminderTime) ? input.preferredReminderTime : DEFAULT_REMINDER_PREFERENCES.preferredReminderTime,
    staleThresholdHours: Number.isFinite(Number(input.staleThresholdHours))
      ? Math.min(168, Math.max(1, Number(input.staleThresholdHours))) : defaultStaleThresholdHours,
    billRemindersEnabled: input.billRemindersEnabled !== false,
    billLeadDays: 1,
    digestBills: true,
    quietHoursStart: isValidLocalTime(input.quietHoursStart) ? input.quietHoursStart : DEFAULT_REMINDER_PREFERENCES.quietHoursStart,
    quietHoursEnd: isValidLocalTime(input.quietHoursEnd) ? input.quietHoursEnd : DEFAULT_REMINDER_PREFERENCES.quietHoursEnd,
    privacyMode: PRIVACY_MODES.includes(input.privacyMode) ? input.privacyMode : DEFAULT_REMINDER_PREFERENCES.privacyMode,
    snoozeUntil: dateIso(input.snoozeUntil),
    guidedAutoTaper: input.guidedAutoTaper !== false,
    marketingOptIn: input.marketingOptIn === true,
    emailOpenTracking: false,
  };
}

export function validateReminderPreferenceUpdate(input = {}, now = new Date()) {
  const allowed = new Set([
    "timezone", "balanceReminderMode", "preferredReminderTime", "staleThresholdHours",
    "billRemindersEnabled", "quietHoursStart", "quietHoursEnd", "privacyMode",
    "guidedAutoTaper", "snoozeDays",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`Unsupported reminder preference: ${key}`);
  }
  if (input.timezone !== undefined && !isValidTimeZone(input.timezone)) throw new Error("Choose a valid IANA timezone.");
  if (input.balanceReminderMode !== undefined && !REMINDER_MODES.includes(input.balanceReminderMode)) throw new Error("Choose a valid reminder mode.");
  for (const key of ["preferredReminderTime", "quietHoursStart", "quietHoursEnd"]) {
    if (input[key] !== undefined && !isValidLocalTime(input[key])) throw new Error(`${key} must use HH:MM time.`);
  }
  if (input.privacyMode !== undefined && !PRIVACY_MODES.includes(input.privacyMode)) throw new Error("Choose Private or Detailed email content.");
  if (input.staleThresholdHours !== undefined && (!Number.isFinite(Number(input.staleThresholdHours)) || Number(input.staleThresholdHours) < 1 || Number(input.staleThresholdHours) > 168)) throw new Error("The stale threshold must be between 1 and 168 hours.");
  if (input.snoozeDays !== undefined && ![0, 1, 3, 7].includes(Number(input.snoozeDays))) throw new Error("Choose a 1-day, 3-day or 7-day snooze.");
  const patch = { ...input };
  if (input.snoozeDays !== undefined) {
    patch.snoozeUntil = Number(input.snoozeDays) === 0 ? null : new Date(now.getTime() + Number(input.snoozeDays) * 86400000);
    delete patch.snoozeDays;
  }
  patch.emailOpenTracking = false;
  return patch;
}

export function privacySafePreferenceDiff(before, after) {
  return Object.fromEntries(Object.keys(after)
    .filter((key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map((key) => [key, { from: before?.[key] ?? null, to: after[key] ?? null }]));
}
