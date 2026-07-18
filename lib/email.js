import crypto from "crypto";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { getAppBaseUrl } from "@/lib/billing/config";
import deliveryPolicy from "@/lib/emailDeliveryPolicy.cjs";

const { EMAIL_CLAIM_LEASE_MS, decideEmailClaim, failureStatusForAttempt } = deliveryPolicy;

const OPTIONAL_EMAIL_TYPES = new Set([
  "onboarding_incomplete",
  "weekly_planning",
  "midweek_balance",
  "preview_balance_check",
  "preview_cost_check",
]);

export function buildEmailIdempotencyKey({ userId, type, period }) {
  return `${userId}:${type}:${period}`;
}

export function buildEmailPreview({ billCount = 0, billsTotal = 0, includeAmounts = false } = {}) {
  if (!billCount) return "";
  if (!includeAmounts) return "Your upcoming costs are saved in ClearTill.";
  if (!billsTotal) return "";
  return `You have ${billCount} bill${billCount === 1 ? "" : "s"} totalling £${Number(billsTotal).toFixed(0)} due before payday.`;
}

export function signEmailActionToken({ userId, type, expiresAt, purpose = "optional_reminders_off" }) {
  const secret = process.env.EMAIL_LINK_SECRET || process.env.CRON_SECRET || "local-dev-secret";
  return crypto
    .createHmac("sha256", secret)
    .update(`${purpose}:${userId}:${type}:${expiresAt}`)
    .digest("hex");
}

export function buildUnsubscribeUrl({ userId, type }) {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const token = signEmailActionToken({ userId, type, expiresAt });
  return `${getAppBaseUrl()}/unsubscribe?uid=${encodeURIComponent(userId)}&type=${encodeURIComponent(type)}&exp=${expiresAt}&token=${token}`;
}

export function verifyEmailActionToken({ userId, type, expiresAt, token, purpose = "optional_reminders_off", now = Date.now() }) {
  const expiry = Number(expiresAt);
  if (!userId || !type || !token || !Number.isFinite(expiry) || expiry <= now) return false;
  const expected = signEmailActionToken({ userId, type, expiresAt: expiry, purpose });
  const providedBuffer = Buffer.from(String(token));
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function claimEmailDelivery({ userId, type, period, transactional = false }) {
  const idempotencyKey = buildEmailIdempotencyKey({ userId, type, period });
  const ref = getAdminDb().collection("emailDeliveries").doc(idempotencyKey);

  const now = new Date();
  const claimToken = crypto.randomUUID();
  return getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const decision = decideEmailClaim(snapshot.exists ? snapshot.data() : null, now.getTime());
    if (!decision.ok) {
      if (decision.reason === "max_attempts" && snapshot.data()?.status !== "permanent_failure") {
        transaction.set(ref, { status: "permanent_failure", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      return { ok: false, reason: decision.reason, ref, idempotencyKey };
    }
    transaction.set(ref, {
      userId,
      type,
      period,
      transactional,
      status: "claimed",
      attempts: decision.attempts,
      claimToken,
      lastAttemptAt: now,
      leaseExpiresAt: new Date(now.getTime() + EMAIL_CLAIM_LEASE_MS),
      lastRecovery: decision.recovery,
      ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, ref, idempotencyKey, claimToken, attempts: decision.attempts };
  });
}

export async function markEmailDelivery(ref, patch = {}, { claimToken = null } = {}) {
  return getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || (claimToken && snapshot.data()?.claimToken !== claimToken)) return false;
    transaction.set(ref, {
      ...patch,
      leaseExpiresAt: FieldValue.delete(),
      claimToken: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

export function emailFailureStatus(attempts) {
  return failureStatusForAttempt(attempts);
}

export async function shouldSuppressOptionalEmail(userId, type) {
  const [prefsSnap, suppressionSnap] = await Promise.all([
    getAdminDb().collection("users").doc(userId).collection("settings").doc("emailPreferences").get(),
    getAdminDb().collection("emailSuppressions").doc(userId).get(),
  ]);

  if (suppressionSnap.exists) {
    return true;
  }

  if (!OPTIONAL_EMAIL_TYPES.has(type)) {
    return false;
  }

  if (!prefsSnap.exists) {
    return false;
  }

  const prefs = prefsSnap.data();
  return prefs.optionalReminders === false || prefs.weeklyReminders === false;
}

export async function sendResendEmail({ to, subject, html, text, headers = {} }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;

  if (!apiKey || !from) {
    return { ok: false, skipped: true, error: "Email is not configured." };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(headers["X-ClearTill-Idempotency-Key"]
        ? { "Idempotency-Key": headers["X-ClearTill-Idempotency-Key"] }
        : {}),
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
      headers,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload?.message || "Resend rejected the email.");
    error.status = response.status;
    error.permanent = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
    throw error;
  }

  return { ok: true, payload, providerMessageId: payload?.id || null };
}
