import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";

const ALLOWED_EVENTS = new Set([
  "landing_page_viewed",
  "ad_landing_view",
  "onboarding_started",
  "onboarding_step_completed",
  "position_calculated",
  "preview_start_requested",
  "preview_started",
  "preview_reminder_sent",
  "preview_reminder_opened",
  "balance_updated_during_preview",
  "position_recalculated_during_preview",
  "preview_expired",
  "upgrade_offer_viewed",
  "upgrade_checkout_started",
  "subscription_started",
  "balance_entered",
  "payday_entered",
  "first_bill_added",
  "first_clear_result_viewed",
  "trial_offer_viewed",
  "trial_checkout_started",
  "try_now_clicked",
  "try_now_closed",
  "balance_step_completed",
  "payday_step_completed",
  "bill_entry_started",
  "voice_bill_input_started",
  "voice_bill_input_completed",
  "voice_bill_input_failed",
  "bill_interpretation_confirmed",
  "result_edited",
  "trial_checkout_completed",
  "trial_started",
  "trial_reminder_sent",
  "balance_reminder_clicked",
  "balance_updated",
  "trial_converted",
  "first_invoice_paid",
  "invoice_payment_failed",
  "subscription_cancelled",
  "trial_cancelled",
  "renewal_invoice_paid",
  "second_invoice_paid",
  "notification_decision",
  "notification_delivery",
  "notification_activity",
]);

const BLOCKED_KEYS = new Set([
  "amount",
  "balance",
  "email",
  "currentBalance",
  "price",
  "trialDays",
  "bills",
  "billText",
  "payday",
  "spokenText",
  "bankBalance",
]);
const BLOCKED_KEY_PATTERN = /amount|balance|price|salary|income|total|cost|spend|email|bill|payday|spoken|bank|name|text|description|memo/i;

export function sanitiseAnalyticsPayload(payload = {}) {
  const safe = {};

  for (const [key, value] of Object.entries(payload)) {
    if (BLOCKED_KEYS.has(key) || BLOCKED_KEY_PATTERN.test(key)) continue;
    if (typeof value === "boolean" || typeof value === "number") {
      safe[key] = value;
      continue;
    }
    if (typeof value === "string" && value.length <= 120 && !/[£$€]/.test(value)) {
      safe[key] = value;
    }
  }

  return safe;
}

export async function trackServerAnalyticsEvent(eventName, payload = {}) {
  if (!ALLOWED_EVENTS.has(eventName)) {
    return { ok: false, error: "Unsupported analytics event." };
  }

  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return { ok: true, skipped: true };
  }

  const safePayload = sanitiseAnalyticsPayload(payload);
  await getAdminDb().collection("analyticsEvents").add({
    eventName,
    uid: safePayload.uid || null,
    anonymousSessionId: safePayload.sessionId || null,
    source: safePayload.source || null,
    payload: safePayload,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
}
