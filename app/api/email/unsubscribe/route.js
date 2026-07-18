import crypto from "crypto";
import { NextResponse } from "next/server";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { verifyEmailActionToken } from "@/lib/email";
import { normaliseLeadEmail } from "@/lib/leadMagnet";
import { cancelPendingNotificationTypes } from "@/lib/reminders/store.server";
import { NOTIFICATION_TYPES } from "@/lib/reminders/policy";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: false, error: "Confirm this change using POST." }, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request) {
  const contentType = request.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await request.json().catch(() => ({})) : Object.fromEntries(await request.formData());
  const userId = String(body.uid || "");
  const type = String(body.type || "");
  const expiresAt = Number(body.exp || 0);
  const token = String(body.token || "");
  if (!verifyEmailActionToken({ userId, type, expiresAt, token })) {
    return NextResponse.redirect(new URL("/unsubscribe?status=expired", request.url), 303);
  }

  const db = getAdminDb();
  const actionId = crypto.createHash("sha256").update(token).digest("hex");
  const actionRef = db.collection("emailActionTokens").doc(actionId);
  const preferencesRef = db.collection("users").doc(userId).collection("settings").doc("emailPreferences");
  const auditRef = db.collection("users").doc(userId).collection("reminderPreferenceAudits").doc(actionId);
  const accepted = await db.runTransaction(async (transaction) => {
    const userRef = db.collection("users").doc(userId);
    const [actionSnapshot, userSnapshot] = await Promise.all([
      transaction.get(actionRef),
      type === "lead_marketing" ? Promise.resolve(null) : transaction.get(userRef),
    ]);
    if (actionSnapshot.exists) return false;
    transaction.create(actionRef, { userId, purpose: "optional_reminders_off", expiresAt: new Date(expiresAt), consumedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() });
    if (type === "lead_marketing") {
      transaction.set(db.collection("emailSuppressions").doc(userId), {
        reason: "unsubscribe",
        source: "lead_marketing",
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(db.collection("marketingSubscribers").doc(userId), {
        status: "unsubscribed",
        unsubscribedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    }
    const userEmail = normaliseLeadEmail(userSnapshot?.data()?.email);
    const emailHash = userEmail ? crypto.createHash("sha256").update(userEmail).digest("hex") : null;
    transaction.set(preferencesRef, { balanceReminderMode: "OFF", billRemindersEnabled: false, optionalReminders: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(db.collection("emailSuppressions").doc(userId), {
      reason: "unsubscribe",
      source: "account",
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (emailHash) transaction.set(db.collection("emailSuppressions").doc(emailHash), {
      reason: "unsubscribe",
      source: "account_email",
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.create(auditRef, {
      userId,
      source: "signed_email_link",
      actorId: userId,
      diff: { balanceReminderMode: { to: "OFF" }, billRemindersEnabled: { to: false } },
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (accepted && type !== "lead_marketing") {
    await cancelPendingNotificationTypes(userId, [
      NOTIFICATION_TYPES.TRIAL_SETUP_NUDGE,
      NOTIFICATION_TYPES.PAID_SETUP_NUDGE,
      NOTIFICATION_TYPES.BALANCE_STALE,
      NOTIFICATION_TYPES.BILL_DUE_TOMORROW,
      NOTIFICATION_TYPES.BILL_AND_BALANCE_STALE,
      NOTIFICATION_TYPES.BALANCE_REMINDERS_PAUSED,
    ], "signed_unsubscribe");
  }
  return NextResponse.redirect(new URL(accepted ? "/unsubscribe?status=success" : "/unsubscribe?status=used", request.url), 303);
}
