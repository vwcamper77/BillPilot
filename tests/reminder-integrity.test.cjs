const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("scheduler uses the central policy and durable event workflow", () => {
  const scheduler = read("app/api/scheduler/route.js");
  const service = read("lib/reminders/service.server.js");
  const store = read("lib/reminders/store.server.js");
  assert.match(scheduler, /runReminderScheduler/);
  assert.match(service, /decideReminderNotification/);
  assert.match(store, /runTransaction/);
  assert.match(store, /transaction\.create\(ref/);
  assert.match(store, /activeRoutineEventId/);
});
test("commercial entry path and entitlement are sourced separately", () => {
  const lifecycle = read("lib/reminders/lifecycle.server.js");
  assert.match(lifecycle, /entryPath/);
  assert.match(lifecycle, /entitlementState/);
  assert.match(lifecycle, /existing\.entryPath/);
  assert.match(lifecycle, /FREE_TRIAL/);
  assert.match(lifecycle, /DIRECT_PAID/);
});

test("reminder settings are authenticated, audited and never changed by GET", () => {
  const preferences = read("app/api/reminder-preferences/route.js");
  const unsubscribe = read("app/api/email/unsubscribe/route.js");
  assert.match(preferences, /verifyRequestUser/);
  assert.match(preferences, /reminderPreferenceAudits/);
  assert.match(unsubscribe, /export async function GET\(\)[\s\S]*status: 405/);
  assert.match(unsubscribe, /export async function POST/);
  assert.match(unsubscribe, /emailActionTokens/);
});

test("feature flags fail closed and provider webhooks are signed", () => {
  const config = read("lib/reminders/config.js");
  const webhook = read("lib/reminders/providerWebhook.server.js");
  assert.match(config, /REMINDER_EMAILS_ENABLED/);
  assert.match(config, /REMINDER_EMAILS_EMERGENCY_DISABLED/);
  assert.match(webhook, /svix-id/);
  assert.match(webhook, /timingSafeEqual/);
  assert.match(webhook, /emailSuppressions/);
});

test("financial data remains absent from reminder analytics", () => {
  const analytics = read("lib/analytics.js");
  assert.match(analytics, /notification_decision/);
  assert.match(analytics, /BLOCKED_KEY_PATTERN/);
  assert.doesNotMatch(read("lib/reminders/service.server.js"), /trackServerAnalyticsEvent\([^)]*amount|trackServerAnalyticsEvent\([^)]*balance/);
});
