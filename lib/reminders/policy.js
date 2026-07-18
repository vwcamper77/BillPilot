import crypto from "crypto";
import { REMINDER_POLICY_VERSION } from "./config";
import {
  calendarDayAge,
  localDateIso,
  localDateTimeToUtc,
  localTomorrowIso,
  localWeekday,
  permittedReminderSchedule,
} from "./timezone";

export const COMMERCIAL_ENTRY_PATHS = Object.freeze(["FREE_TRIAL", "DIRECT_PAID"]);
export const REMINDER_MODES = Object.freeze(["GUIDED", "DAILY", "WEEKDAYS", "THREE_PER_WEEK", "WEEKLY", "BILLS_ONLY", "OFF"]);
export const PRIVACY_MODES = Object.freeze(["PRIVATE", "DETAILED"]);

export const NOTIFICATION_TYPES = Object.freeze({
  TRIAL_WELCOME: "TRIAL_WELCOME",
  DIRECT_PAID_WELCOME: "DIRECT_PAID_WELCOME",
  TRIAL_SETUP_NUDGE: "TRIAL_SETUP_NUDGE",
  PAID_SETUP_NUDGE: "PAID_SETUP_NUDGE",
  TRIAL_ENDING_SOON: "TRIAL_ENDING_SOON",
  TRIAL_CONVERTED_TO_PAID: "TRIAL_CONVERTED_TO_PAID",
  TRIAL_EXPIRED: "TRIAL_EXPIRED",
  BALANCE_STALE: "BALANCE_STALE",
  BILL_DUE_TOMORROW: "BILL_DUE_TOMORROW",
  BILL_AND_BALANCE_STALE: "BILL_AND_BALANCE_STALE",
  BALANCE_REMINDERS_PAUSED: "BALANCE_REMINDERS_PAUSED",
  PREFERENCES_CHANGED: "PREFERENCES_CHANGED",
});

export const ROUTINE_TYPES = new Set([
  NOTIFICATION_TYPES.TRIAL_SETUP_NUDGE,
  NOTIFICATION_TYPES.PAID_SETUP_NUDGE,
  NOTIFICATION_TYPES.BALANCE_STALE,
  NOTIFICATION_TYPES.BILL_DUE_TOMORROW,
  NOTIFICATION_TYPES.BILL_AND_BALANCE_STALE,
  NOTIFICATION_TYPES.BALANCE_REMINDERS_PAUSED,
]);

const CADENCE_WEEKDAYS = Object.freeze({
  THREE_PER_WEEK: new Set(["Mon", "Wed", "Fri"]),
  TWICE_PER_WEEK: new Set(["Tue", "Fri"]),
  WEEKLY: new Set(["Mon"]),
});

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function guidedTierForAge(ageDays, cohort = "GUIDED") {
  if (cohort === "LIGHT") {
    if (ageDays <= 6) return "THREE_PER_WEEK";
    if (ageDays <= 29) return "TWICE_PER_WEEK";
    return "WEEKLY";
  }
  if (ageDays <= 6) return "DAILY";
  if (ageDays <= 29) return "THREE_PER_WEEK";
  if (ageDays <= 59) return "TWICE_PER_WEEK";
  return "WEEKLY";
}

export function nextLowerCadenceTier(tier) {
  return ({ DAILY: "THREE_PER_WEEK", THREE_PER_WEEK: "TWICE_PER_WEEK", TWICE_PER_WEEK: "WEEKLY", WEEKLY: "WEEKLY" })[tier] || "THREE_PER_WEEK";
}

export function adaptiveReminderState({ state = {}, preferences, lifecycle, now = new Date(), inactivityPauseDays = 30 }) {
  const patch = {};
  const activity = state.lastMeaningfulActivityAt || lifecycle.firstValueActionAt || lifecycle.reminderLifecycleStartedAt;
  if (preferences.balanceReminderMode === "GUIDED" && preferences.guidedAutoTaper && Number(state.consecutiveNoActionReminders || 0) >= 3) {
    const age = calendarDayAge(lifecycle.reminderLifecycleStartedAt, now, preferences.timezone);
    const current = state.currentCadenceTier || guidedTierForAge(age, lifecycle.cohort);
    const next = nextLowerCadenceTier(current);
    if (next !== current) Object.assign(patch, { currentCadenceTier: next, consecutiveNoActionReminders: 0, backoffNoticePending: true });
  }
  if (activity && new Date(now).getTime() - new Date(activity).getTime() >= inactivityPauseDays * 86400000 && !state.autoPaused) {
    Object.assign(patch, { autoPaused: true, autoPausedAt: new Date(now), pauseNoticePending: !state.pauseNoticeSentAt });
  }
  return patch;
}

export function cadenceDue({ mode, ageDays, localDay, cohort = "GUIDED", currentCadenceTier = null }) {
  const resolved = mode === "GUIDED" ? (currentCadenceTier || guidedTierForAge(ageDays, cohort)) : mode;
  if (resolved === "DAILY") return true;
  if (resolved === "WEEKDAYS") return !["Sat", "Sun"].includes(localDay);
  if (resolved === "THREE_PER_WEEK") return CADENCE_WEEKDAYS.THREE_PER_WEEK.has(localDay);
  if (resolved === "TWICE_PER_WEEK") return CADENCE_WEEKDAYS.TWICE_PER_WEEK.has(localDay);
  if (resolved === "WEEKLY") return CADENCE_WEEKDAYS.WEEKLY.has(localDay);
  return false;
}

export function isBalanceStale(balanceUpdatedAt, now, thresholdHours) {
  const updated = millis(balanceUpdatedAt);
  return !updated || millis(now) - updated >= Number(thresholdHours) * 3600000;
}

export function eligibleTomorrowBills(bills, tomorrowIso) {
  return (bills || []).filter((bill) => {
    const status = String(bill.status || "").toLowerCase();
    if (bill.active === false || ["paid", "completed", "cancelled", "canceled", "deleted"].includes(status)) return false;
    if (String(bill.nextDueDate || bill.dueDate || "") !== tomorrowIso) return false;
    return !bill.paidThroughDate || String(bill.paidThroughDate) < tomorrowIso;
  });
}

export function buildNotificationIdempotencyKey({ userId, type, sourceVersion = "none", billIds = [], localDate = "none", leadDays = 0 }) {
  return [userId, type, sourceVersion, [...billIds].sort().join(",") || "none", localDate, leadDays, REMINDER_POLICY_VERSION].join(":");
}

export function notificationEventId(idempotencyKey) {
  return crypto.createHash("sha256").update(idempotencyKey).digest("hex");
}

function lifecycleIdempotencyVersion(type, lifecycle) {
  if (type === NOTIFICATION_TYPES.TRIAL_WELCOME) return `${lifecycle.trialStartedAt || "unknown"}:${lifecycle.trialEndsAt || "unknown"}:${lifecycle.conversionType || "unknown"}`;
  if (type === NOTIFICATION_TYPES.TRIAL_ENDING_SOON || type === NOTIFICATION_TYPES.TRIAL_EXPIRED) return lifecycle.trialEndsAt || lifecycle.sourceVersion;
  if (type === NOTIFICATION_TYPES.DIRECT_PAID_WELCOME || type === NOTIFICATION_TYPES.TRIAL_CONVERTED_TO_PAID) return lifecycle.paidActivatedAt || lifecycle.sourceId || lifecycle.sourceVersion;
  return lifecycle.sourceVersion;
}

export function decideReminderNotification({
  userId,
  lifecycle,
  preferences,
  state = {},
  balanceUpdatedAt = null,
  bills = [],
  lifecycleEvent = null,
  now = new Date(),
  config,
}) {
  const timeZone = preferences.timezone;
  const localDate = localDateIso(now, timeZone);
  const permitted = permittedReminderSchedule(localDate, preferences.preferredReminderTime, preferences.quietHoursStart, preferences.quietHoursEnd);
  const localTime = permitted.localTime;
  const scheduledAt = localDateTimeToUtc(permitted.localDate, localTime, timeZone);
  const base = {
    eligible: false,
    notificationType: null,
    reasons: [],
    relevantEntityIds: [],
    commercialEntryPath: lifecycle.entryPath,
    entitlementState: lifecycle.entitlementState,
    conversionType: lifecycle.conversionType,
    sourceVersion: lifecycle.sourceVersion,
    scheduledLocalDate: permitted.localDate,
    scheduledLocalTime: localTime,
    scheduledAtUtc: scheduledAt.toISOString(),
    privacyMode: preferences.privacyMode,
    policyVersion: REMINDER_POLICY_VERSION,
    category: "routine",
  };

  if (lifecycleEvent) {
    const idempotencyKey = buildNotificationIdempotencyKey({ userId, type: lifecycleEvent, sourceVersion: lifecycleIdempotencyVersion(lifecycleEvent, lifecycle), localDate: "lifecycle" });
    return { ...base, eligible: true, notificationType: lifecycleEvent, category: "lifecycle", reasons: ["lifecycle_event_due"], idempotencyKey, scheduledAtUtc: now.toISOString() };
  }
  if (!["TRIAL_ACTIVE", "PAID_ACTIVE"].includes(lifecycle.entitlementState)) return { ...base, reasons: ["no_eligible_entitlement"] };
  if (!config.routineEnabled) return { ...base, reasons: ["routine_delivery_disabled"] };
  if (preferences.balanceReminderMode === "OFF") return { ...base, reasons: ["reminders_off"] };
  if (state.suppressed) return { ...base, reasons: ["address_suppressed"] };

  const tomorrowIso = localTomorrowIso(now, timeZone);
  const dueBills = preferences.billRemindersEnabled ? eligibleTomorrowBills(bills, tomorrowIso) : [];
  const stale = isBalanceStale(balanceUpdatedAt, now, preferences.staleThresholdHours);
  const snoozed = millis(preferences.snoozeUntil) > millis(now);
  const ageDays = calendarDayAge(lifecycle.reminderLifecycleStartedAt, now, timeZone);
  const localDay = localWeekday(now, timeZone);
  const cadenceIsDue = !snoozed && preferences.balanceReminderMode !== "BILLS_ONLY" && cadenceDue({
    mode: preferences.balanceReminderMode,
    ageDays,
    localDay,
    cohort: lifecycle.cohort,
    currentCadenceTier: state.currentCadenceTier,
  });
  const balanceDue = stale && cadenceIsDue && !state.autoPaused;

  let type = null;
  let reasons = [];
  if (dueBills.length && balanceDue) {
    type = NOTIFICATION_TYPES.BILL_AND_BALANCE_STALE;
    reasons = ["bills_due_tomorrow", "balance_stale", "cadence_due"];
  } else if (dueBills.length) {
    type = NOTIFICATION_TYPES.BILL_DUE_TOMORROW;
    reasons = ["bills_due_tomorrow"];
  } else if (balanceDue && config.routineEnabled) {
    type = NOTIFICATION_TYPES.BALANCE_STALE;
    reasons = ["balance_stale", "cadence_due"];
  } else if (state.pauseNoticePending && config.routineEnabled) {
    type = NOTIFICATION_TYPES.BALANCE_REMINDERS_PAUSED;
    reasons = ["inactivity_pause_due"];
  } else {
    const lifecycleAgeMs = millis(now) - millis(lifecycle.reminderLifecycleStartedAt);
    const noFirstValue = !lifecycle.firstValueActionAt;
    const setupType = lifecycle.entryPath === "FREE_TRIAL" ? NOTIFICATION_TYPES.TRIAL_SETUP_NUDGE : NOTIFICATION_TYPES.PAID_SETUP_NUDGE;
    if (config.routineEnabled && noFirstValue && lifecycleAgeMs >= 86400000 && !state.setupNudgeSentAt) {
      type = setupType;
      reasons = ["setup_incomplete_24_hours"];
    }
  }

  if (!type) return { ...base, reasons: [snoozed ? "balance_snoozed" : stale ? "cadence_not_due" : "balance_current"] };
  const billIds = dueBills.map((bill) => bill.id).filter(Boolean);
  const idempotencyKey = buildNotificationIdempotencyKey({ userId, type, sourceVersion: lifecycle.sourceVersion, billIds, localDate: tomorrowIso, leadDays: 1 });
  return { ...base, eligible: true, notificationType: type, reasons, relevantEntityIds: billIds, idempotencyKey, tomorrowIso };
}
