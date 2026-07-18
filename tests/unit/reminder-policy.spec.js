import { expect, test } from "@playwright/test";
import {
  adaptiveReminderState,
  buildNotificationIdempotencyKey,
  cadenceDue,
  decideReminderNotification,
  eligibleTomorrowBills,
  guidedTierForAge,
  isBalanceStale,
  nextLowerCadenceTier,
  notificationEventId,
} from "../../lib/reminders/policy.js";
import { deriveCommercialLifecycle, lifecycleTransitionEvent } from "../../lib/reminders/lifecycle.server.js";
import { normaliseReminderPreferences } from "../../lib/reminders/preferences.js";
import { routineWindowDecision } from "../../lib/reminders/store.server.js";

const NOW = new Date("2026-07-20T17:00:00.000Z"); // 18:00 Europe/London
const config = { routineEnabled: true };

function lifecycle(overrides = {}) {
  return {
    entryPath: "FREE_TRIAL", entitlementState: "TRIAL_ACTIVE", conversionType: "MANUAL_CONVERSION",
    sourceVersion: "v1", reminderLifecycleStartedAt: "2026-07-18T12:00:00.000Z", cohort: "GUIDED",
    firstValueActionAt: "2026-07-18T12:00:00.000Z", ...overrides,
  };
}

function preferences(overrides = {}) {
  return normaliseReminderPreferences({ ...overrides });
}

test("commercial entry path is derived independently from reminder mode", () => {
  const freeTrial = deriveCommercialLifecycle({
    uid: "u1", entitlement: { previewUsed: true, previewStatus: "active", previewStartedAt: "2026-07-18T12:00:00Z", previewEndsAt: "2026-07-25T12:00:00Z", subscriptionStatus: "none", trialStatus: "not_started", hasAccess: true, accessType: "no_card_preview" },
    preview: { status: "active" }, now: NOW,
  });
  const directPaid = deriveCommercialLifecycle({
    uid: "u2", entitlement: { previewUsed: false, previewStatus: "not_started", subscriptionStatus: "active", trialStatus: "not_started", hasAccess: true, accessType: "active_subscription" },
    subscription: { firstSuccessfulPaymentAt: NOW.getTime() }, now: NOW,
  });
  expect(freeTrial.entryPath).toBe("FREE_TRIAL");
  expect(freeTrial.conversionType).toBe("MANUAL_CONVERSION");
  expect(directPaid.entryPath).toBe("DIRECT_PAID");
  expect(preferences({ balanceReminderMode: "WEEKLY" }).balanceReminderMode).toBe("WEEKLY");
});

test("legacy Stripe trial terms are authoritative auto-renewal fields", () => {
  const projected = deriveCommercialLifecycle({
    uid: "u1",
    entitlement: { previewUsed: false, previewStatus: "not_started", subscriptionStatus: "trialing", trialStatus: "active", trialStartedAt: "2026-07-18T12:00:00Z", trialEndsAt: "2026-07-25T12:00:00Z", hasAccess: true, accessType: "active_trial", stripeSubscriptionId: "sub_1" },
    subscription: { planAmountMinor: 199, planCurrency: "gbp", billingInterval: "month", planName: "ClearTill monthly", lastStripeEventId: "evt_1" }, now: NOW,
  });
  expect(projected.entryPath).toBe("FREE_TRIAL");
  expect(projected.conversionType).toBe("AUTO_RENEW");
  expect(projected.planAmountMinor).toBe(199);
  expect(projected.firstChargeAt).toBe("2026-07-25T12:00:00.000Z");
});

test("trial conversion and expiry transitions do not become direct-paid welcomes", () => {
  expect(lifecycleTransitionEvent({ entryPath: "FREE_TRIAL", entitlementState: "TRIAL_ACTIVE" }, lifecycle({ entitlementState: "PAID_ACTIVE" }))).toBe("TRIAL_CONVERTED_TO_PAID");
  expect(lifecycleTransitionEvent({ entryPath: "FREE_TRIAL", entitlementState: "TRIAL_ACTIVE" }, lifecycle({ entitlementState: "TRIAL_EXPIRED" }))).toBe("TRIAL_EXPIRED");
  expect(lifecycleTransitionEvent({}, lifecycle({ entryPath: "DIRECT_PAID", entitlementState: "PAID_ACTIVE" }))).toBe("DIRECT_PAID_WELCOME");
});

test("a converted trial that becomes past due is not misclassified as trial expired", () => {
  const projected = deriveCommercialLifecycle({
    uid: "u1",
    existing: { entryPath: "FREE_TRIAL", conversionType: "MANUAL_CONVERSION", reminderLifecycleStartedAt: "2026-07-18T12:00:00Z" },
    entitlement: { previewUsed: true, previewStatus: "converted", subscriptionStatus: "past_due", hasAccess: false },
    preview: { status: "converted", startedAt: "2026-07-18T12:00:00Z" },
    now: NOW,
  });
  expect(projected.entitlementState).toBe("PAST_DUE");
  expect(projected.entryPath).toBe("FREE_TRIAL");
});

test("lifecycle idempotency does not change with the scheduler's local date", () => {
  const first = decideReminderNotification({ userId: "u1", lifecycle: lifecycle({ trialEndsAt: "2026-07-22T17:00:00Z" }), preferences: preferences(), lifecycleEvent: "TRIAL_ENDING_SOON", now: NOW, config });
  const later = decideReminderNotification({ userId: "u1", lifecycle: lifecycle({ sourceVersion: "v2", trialEndsAt: "2026-07-22T17:00:00Z" }), preferences: preferences(), lifecycleEvent: "TRIAL_ENDING_SOON", now: new Date("2026-07-21T17:00:00Z"), config });
  expect(first.idempotencyKey).toBe(later.idempotencyKey);
});

test("overnight quiet hours defer an evening reminder to the next morning", () => {
  const decision = decideReminderNotification({ userId: "u1", lifecycle: lifecycle(), preferences: preferences({ preferredReminderTime: "21:00", quietHoursStart: "20:00", quietHoursEnd: "08:00" }), balanceUpdatedAt: null, now: NOW, config });
  expect(decision.scheduledLocalDate).toBe("2026-07-21");
  expect(decision.scheduledLocalTime).toBe("08:00");
});

test("Guided cadence changes at every policy boundary", () => {
  expect([0, 6].map((age) => guidedTierForAge(age))).toEqual(["DAILY", "DAILY"]);
  expect([7, 29].map((age) => guidedTierForAge(age))).toEqual(["THREE_PER_WEEK", "THREE_PER_WEEK"]);
  expect([30, 59].map((age) => guidedTierForAge(age))).toEqual(["TWICE_PER_WEEK", "TWICE_PER_WEEK"]);
  expect(guidedTierForAge(60)).toBe("WEEKLY");
  expect(guidedTierForAge(0, "LIGHT")).toBe("THREE_PER_WEEK");
});

test("all explicit reminder modes are deterministic", () => {
  expect(cadenceDue({ mode: "DAILY", ageDays: 70, localDay: "Sun" })).toBe(true);
  expect(cadenceDue({ mode: "WEEKDAYS", ageDays: 1, localDay: "Sat" })).toBe(false);
  expect(cadenceDue({ mode: "THREE_PER_WEEK", ageDays: 1, localDay: "Wed" })).toBe(true);
  expect(cadenceDue({ mode: "WEEKLY", ageDays: 1, localDay: "Tue" })).toBe(false);
  expect(cadenceDue({ mode: "BILLS_ONLY", ageDays: 1, localDay: "Mon" })).toBe(false);
  expect(cadenceDue({ mode: "OFF", ageDays: 1, localDay: "Mon" })).toBe(false);
});

test("the routine feature flag suppresses balance and bill email together", () => {
  const decision = decideReminderNotification({ userId: "u1", lifecycle: lifecycle(), preferences: preferences(), balanceUpdatedAt: null, bills: [{ id: "a", active: true, nextDueDate: "2026-07-21" }], now: NOW, config: { routineEnabled: false } });
  expect(decision.eligible).toBe(false);
  expect(decision.reasons).toEqual(["routine_delivery_disabled"]);
});

test("stale balance plus eligible bills produces one combined notification", () => {
  const bills = [{ id: "a", active: true, nextDueDate: "2026-07-21" }, { id: "b", active: true, nextDueDate: "2026-07-21" }];
  const decision = decideReminderNotification({ userId: "u1", lifecycle: lifecycle(), preferences: preferences(), balanceUpdatedAt: "2026-07-18T12:00:00Z", bills, now: NOW, config });
  expect(decision.notificationType).toBe("BILL_AND_BALANCE_STALE");
  expect(decision.relevantEntityIds).toEqual(["a", "b"]);
});

test("bill eligibility excludes changed, paid, deleted and rescheduled bills", () => {
  const due = eligibleTomorrowBills([
    { id: "ok", active: true, nextDueDate: "2026-07-21" },
    { id: "paid", active: true, status: "paid", nextDueDate: "2026-07-21" },
    { id: "through", active: true, paidThroughDate: "2026-07-21", nextDueDate: "2026-07-21" },
    { id: "deleted", active: false, nextDueDate: "2026-07-21" },
    { id: "moved", active: true, nextDueDate: "2026-07-22" },
  ], "2026-07-21");
  expect(due.map((bill) => bill.id)).toEqual(["ok"]);
});

test("snooze suppresses balance cadence but not bill alerts", () => {
  const decision = decideReminderNotification({ userId: "u1", lifecycle: lifecycle(), preferences: preferences({ snoozeUntil: "2026-07-23T00:00:00Z" }), balanceUpdatedAt: null, bills: [{ id: "a", active: true, nextDueDate: "2026-07-21" }], now: NOW, config });
  expect(decision.notificationType).toBe("BILL_DUE_TOMORROW");
});

test("backoff and inactivity pause are deterministic and preserve bill alerts", () => {
  const patch = adaptiveReminderState({ state: { consecutiveNoActionReminders: 3, lastMeaningfulActivityAt: "2026-06-01T12:00:00Z" }, preferences: preferences(), lifecycle: lifecycle(), now: NOW, inactivityPauseDays: 30 });
  expect(patch.currentCadenceTier).toBe("THREE_PER_WEEK");
  expect(patch.autoPaused).toBe(true);
  expect(nextLowerCadenceTier("WEEKLY")).toBe("WEEKLY");
});

test("rolling cap and stable idempotency prevent duplicate routines", () => {
  expect(routineWindowDecision({ lastRoutineSentAt: new Date(NOW.getTime() - 23 * 3600000) }, NOW, 24)).toEqual({ ok: false, reason: "routine_cap" });
  expect(routineWindowDecision({ lastRoutineSentAt: new Date(NOW.getTime() - 25 * 3600000) }, NOW, 24)).toEqual({ ok: true });
  const one = buildNotificationIdempotencyKey({ userId: "u1", type: "BILL_DUE_TOMORROW", sourceVersion: "v1", billIds: ["b", "a"], localDate: "2026-07-21", leadDays: 1 });
  const two = buildNotificationIdempotencyKey({ userId: "u1", type: "BILL_DUE_TOMORROW", sourceVersion: "v1", billIds: ["a", "b"], localDate: "2026-07-21", leadDays: 1 });
  expect(one).toBe(two);
  expect(notificationEventId(one)).toBe(notificationEventId(two));
  expect(isBalanceStale("2026-07-20T16:30:00Z", NOW, 24)).toBe(false);
});
