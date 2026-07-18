import { expect, test } from "@playwright/test";
import { buildReminderEmail } from "../../lib/reminders/templates.js";
import { normaliseReminderPreferences } from "../../lib/reminders/preferences.js";

const event = (type, extra = {}) => ({ type, id: "event", relevantEntityIds: [], tomorrowIso: "2026-07-21", ...extra });
const prefs = (extra = {}) => normaliseReminderPreferences(extra);
const lifecycle = (extra = {}) => ({ entryPath: "FREE_TRIAL", entitlementState: "TRIAL_ACTIVE", conversionType: "MANUAL_CONVERSION", trialEndsAt: "2026-07-25T12:00:00Z", ...extra });

test("FREE_TRIAL and DIRECT_PAID welcome copy cannot be interchanged", () => {
  const trial = buildReminderEmail({ event: event("TRIAL_WELCOME"), lifecycle: lifecycle(), preferences: prefs(), user: {} });
  const paid = buildReminderEmail({ event: event("DIRECT_PAID_WELCOME"), lifecycle: lifecycle({ entryPath: "DIRECT_PAID", entitlementState: "PAID_ACTIVE", conversionType: null }), preferences: prefs(), user: {} });
  expect(trial.templateId).toBe("trial_welcome_reminder_setup");
  expect(trial.text).toContain("You will not be charged automatically");
  expect(paid.templateId).toBe("direct_paid_welcome_reminder_setup");
  expect(paid.text).not.toMatch(/trial|convert|countdown/i);
});
test("auto-renewing trial copy requires authoritative price, interval, date and cancellation route", () => {
  expect(() => buildReminderEmail({ event: event("TRIAL_WELCOME"), lifecycle: lifecycle({ conversionType: "AUTO_RENEW" }), preferences: prefs(), user: {} })).toThrow(/terms are incomplete/i);
  const message = buildReminderEmail({ event: event("TRIAL_WELCOME"), lifecycle: lifecycle({ conversionType: "AUTO_RENEW", planName: "ClearTill monthly", planAmountMinor: 199, planCurrency: "gbp", billingInterval: "month", firstChargeAt: "2026-07-25T12:00:00Z", cancelUrl: "https://www.cleartill.money/billing" }), preferences: prefs(), user: {} });
  expect(message.text).toContain("£1.99 per month");
  expect(message.subject).not.toContain("£");
});

test("private bill email redacts names, amounts and balance from every rendered surface", () => {
  const bill = { id: "b1", name: "Sensitive creditor", amount: 1250, currency: "GBP", sourceQuality: "scheduled" };
  const message = buildReminderEmail({ event: event("BILL_DUE_TOMORROW", { relevantEntityIds: ["b1"] }), lifecycle: lifecycle(), preferences: prefs(), user: {}, bills: [bill] });
  for (const surface of [message.subject, message.preheader, message.text, message.html]) {
    expect(surface).not.toContain("Sensitive creditor");
    expect(surface).not.toContain("1,250");
    expect(surface).not.toContain("£");
  }
  expect(message.subject).toBe("A bill is scheduled for tomorrow");
});

test("detailed mode includes bill detail only in the body and explains exposure", () => {
  const bill = { id: "b1", name: "Council tax", amount: 120, currency: "GBP", sourceQuality: "predicted" };
  const message = buildReminderEmail({ event: event("BILL_DUE_TOMORROW", { relevantEntityIds: ["b1"] }), lifecycle: lifecycle(), preferences: prefs({ privacyMode: "DETAILED" }), user: {}, bills: [bill] });
  expect(message.subject).toBe("A bill is expected tomorrow");
  expect(message.subject).not.toContain("£");
  expect(message.text).toContain("Council tax — £120.00");
  expect(message.text).toContain("inbox previews");
});

test("pending source wording never claims that ClearTill will pay a bill", () => {
  const message = buildReminderEmail({ event: event("BILL_DUE_TOMORROW"), lifecycle: lifecycle(), preferences: prefs(), user: {}, bills: [{ id: "b1", sourceQuality: "pending" }] });
  expect(message.subject).toBe("A bill is pending for tomorrow");
  expect(message.text).not.toMatch(/will be paid|is going out|guaranteed/i);
});

test("combined bill and balance selection renders one message with settings controls", () => {
  const message = buildReminderEmail({ event: event("BILL_AND_BALANCE_STALE"), lifecycle: lifecycle(), preferences: prefs(), user: {}, balanceUpdatedAt: "2026-07-18T12:00:00Z", bills: [{ id: "b1" }], now: new Date("2026-07-20T17:00:00Z") });
  expect(message.templateId).toBe("bill_and_balance_reminder");
  expect(message.text).toContain("Review and update");
  expect(message.text).toContain("Manage reminders");
});
