import crypto from "crypto";
import { expect, test } from "@playwright/test";
import { signEmailActionToken, verifyEmailActionToken } from "../../lib/email.js";
import { verifyResendWebhook } from "../../lib/reminders/providerWebhook.server.js";
import { normaliseReminderPreferences, validateReminderPreferenceUpdate } from "../../lib/reminders/preferences.js";

test("email action tokens expire and are bound to user, purpose and category", () => {
  process.env.EMAIL_LINK_SECRET = "test-secret";
  const expiresAt = Date.parse("2026-07-20T18:15:00Z");
  const token = signEmailActionToken({ userId: "u1", type: "BALANCE_STALE", expiresAt });
  expect(verifyEmailActionToken({ userId: "u1", type: "BALANCE_STALE", expiresAt, token, now: expiresAt - 1 })).toBe(true);
  expect(verifyEmailActionToken({ userId: "u2", type: "BALANCE_STALE", expiresAt, token, now: expiresAt - 1 })).toBe(false);
  expect(verifyEmailActionToken({ userId: "u1", type: "BALANCE_STALE", expiresAt, token, now: expiresAt + 1 })).toBe(false);
});
test("Resend webhook signatures require an in-window Svix signature", () => {
  const key = Buffer.from("reminder-webhook-secret");
  const secret = `whsec_${key.toString("base64")}`;
  const payload = JSON.stringify({ type: "email.bounced", data: { email_id: "email_1" } });
  const id = "msg_test";
  const timestamp = "1784563200";
  const signature = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  const now = Number(timestamp) * 1000;
  expect(verifyResendWebhook({ payload, id, timestamp, signature: `v1,${signature}`, secret, now })).toBe(true);
  expect(verifyResendWebhook({ payload: `${payload}x`, id, timestamp, signature: `v1,${signature}`, secret, now })).toBe(false);
  expect(verifyResendWebhook({ payload, id, timestamp, signature: `v1,${signature}`, secret, now: now + 301000 })).toBe(false);
});

test("preference validation enforces IANA timezone, privacy mode and fixed snoozes", () => {
  expect(() => validateReminderPreferenceUpdate({ timezone: "GMT+banana" })).toThrow(/IANA timezone/);
  expect(() => validateReminderPreferenceUpdate({ privacyMode: "PUBLIC" })).toThrow(/Private or Detailed/);
  expect(() => validateReminderPreferenceUpdate({ snoozeDays: 2 })).toThrow(/1-day/);
  const stored = normaliseReminderPreferences({ privacyMode: "DETAILED", emailOpenTracking: true });
  expect(stored.privacyMode).toBe("DETAILED");
  expect(stored.emailOpenTracking).toBe(false);
});
