import crypto from "crypto";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { getAppBaseUrl } from "@/lib/billing/config";

const OPTIONAL_EMAIL_TYPES = new Set([
  "weekly_planning",
  "midweek_balance",
]);

export function buildEmailIdempotencyKey({ userId, type, period }) {
  return `${userId}:${type}:${period}`;
}

export function buildEmailPreview({ billCount = 0, billsTotal = 0 } = {}) {
  if (!billCount || !billsTotal) return "";
  return `You have ${billCount} bill${billCount === 1 ? "" : "s"} totalling £${Number(billsTotal).toFixed(0)} due before payday.`;
}

export function signEmailActionToken({ userId, type }) {
  const secret = process.env.EMAIL_LINK_SECRET || process.env.CRON_SECRET || "local-dev-secret";
  return crypto
    .createHmac("sha256", secret)
    .update(`${userId}:${type}`)
    .digest("hex");
}

export function buildUnsubscribeUrl({ userId, type }) {
  const token = signEmailActionToken({ userId, type });
  return `${getAppBaseUrl()}/unsubscribe?uid=${encodeURIComponent(userId)}&type=${encodeURIComponent(type)}&token=${token}`;
}

export async function claimEmailDelivery({ userId, type, period, transactional = false }) {
  const idempotencyKey = buildEmailIdempotencyKey({ userId, type, period });
  const ref = getAdminDb().collection("emailDeliveries").doc(idempotencyKey);

  try {
    await ref.create({
      userId,
      type,
      period,
      transactional,
      status: "claimed",
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, ref, idempotencyKey };
  } catch (error) {
    if (error?.code === 6 || String(error?.message || "").includes("Already exists")) {
      return { ok: false, reason: "duplicate", ref, idempotencyKey };
    }
    throw error;
  }
}

export async function markEmailDelivery(ref, patch = {}) {
  await ref.set({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
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
  return prefs.weeklyReminders === false;
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
    throw new Error(payload?.message || "Resend rejected the email.");
  }

  return { ok: true, payload };
}
