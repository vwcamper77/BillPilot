export const REMINDER_POLICY_VERSION = "2026-07-18.v1";
export const REMINDER_TEMPLATE_VERSION = "2026-07-18.v1";

function enabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function getReminderRuntimeConfig() {
  const lifecycleStartAt = process.env.REMINDER_LIFECYCLE_START_AT ? new Date(process.env.REMINDER_LIFECYCLE_START_AT) : null;
  return {
    enabled: enabled(process.env.REMINDER_EMAILS_ENABLED),
    routineEnabled: enabled(process.env.REMINDER_ROUTINE_ENABLED),
    emergencyDisabled: enabled(process.env.REMINDER_EMAILS_EMERGENCY_DISABLED),
    guidedCohortPercent: boundedNumber(process.env.REMINDER_GUIDED_COHORT_PERCENT, 50, 0, 100),
    staleThresholdHours: boundedNumber(process.env.REMINDER_STALE_THRESHOLD_HOURS, 24, 1, 168),
    trialEndingHours: boundedNumber(process.env.REMINDER_TRIAL_ENDING_HOURS, 48, 12, 168),
    schedulerLookbackMinutes: boundedNumber(process.env.REMINDER_SCHEDULER_LOOKBACK_MINUTES, 75, 15, 360),
    routineCapHours: boundedNumber(process.env.REMINDER_ROUTINE_CAP_HOURS, 24, 1, 72),
    inactivityPauseDays: boundedNumber(process.env.REMINDER_INACTIVITY_PAUSE_DAYS, 30, 7, 180),
    webhookToleranceSeconds: boundedNumber(process.env.REMINDER_WEBHOOK_TOLERANCE_SECONDS, 300, 60, 900),
    lifecycleStartAt: lifecycleStartAt && !Number.isNaN(lifecycleStartAt.getTime()) ? lifecycleStartAt : null,
  };
}

export const DEFAULT_REMINDER_PREFERENCES = Object.freeze({
  timezone: "Europe/London",
  balanceReminderMode: "GUIDED",
  preferredReminderTime: "18:00",
  staleThresholdHours: 24,
  billRemindersEnabled: true,
  billLeadDays: 1,
  digestBills: true,
  quietHoursStart: "20:00",
  quietHoursEnd: "08:00",
  privacyMode: "PRIVATE",
  snoozeUntil: null,
  guidedAutoTaper: true,
  marketingOptIn: false,
  emailOpenTracking: false,
});
