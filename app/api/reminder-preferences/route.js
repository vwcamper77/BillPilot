import { NextResponse } from "next/server";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { verifyRequestUser } from "@/lib/serverAuth";
import { getReminderRuntimeConfig } from "@/lib/reminders/config";
import { normaliseReminderPreferences, privacySafePreferenceDiff, validateReminderPreferenceUpdate } from "@/lib/reminders/preferences";
import { recordReminderMeaningfulActivity } from "@/lib/reminders/lifecycle.server";
import { queuePreferenceChangedNotification } from "@/lib/reminders/service.server";
import { cancelPendingNotificationTypes } from "@/lib/reminders/store.server";
import { NOTIFICATION_TYPES } from "@/lib/reminders/policy";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const user = await requireVerifiedUser(request);
    const snapshot = await preferenceRef(user.uid).get();
    const config = getReminderRuntimeConfig();
    return NextResponse.json({ ok: true, preferences: normaliseReminderPreferences(snapshot.exists ? snapshot.data() : {}, { defaultStaleThresholdHours: config.staleThresholdHours }) });
  } catch (error) {
    return preferenceError(error);
  }
}

export async function POST(request) {
  try {
    const user = await requireVerifiedUser(request);
    const body = await request.json().catch(() => ({}));
    const now = new Date();
    const patch = validateReminderPreferenceUpdate(body?.preferences || {}, now);
    const ref = preferenceRef(user.uid);
    const auditRef = getAdminDb().collection("users").doc(user.uid).collection("reminderPreferenceAudits").doc();
    const stateRef = getAdminDb().collection("users").doc(user.uid).collection("notifications").doc("state");
    const config = getReminderRuntimeConfig();
    let saved;
    let changed = false;
    await getAdminDb().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const before = normaliseReminderPreferences(snapshot.exists ? snapshot.data() : {}, { defaultStaleThresholdHours: config.staleThresholdHours });
      saved = normaliseReminderPreferences({ ...before, ...patch }, { defaultStaleThresholdHours: config.staleThresholdHours });
      const diff = privacySafePreferenceDiff(before, saved);
      if (!Object.keys(diff).length) return;
      changed = true;
      transaction.set(ref, { ...saved, snoozeUntil: saved.snoozeUntil ? new Date(saved.snoozeUntil) : null, updatedAt: FieldValue.serverTimestamp(), ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }) }, { merge: true });
      transaction.create(auditRef, { userId: user.uid, source: "user", actorId: user.uid, diff, createdAt: FieldValue.serverTimestamp() });
      transaction.set(stateRef, { ...(patch.balanceReminderMode && !["OFF", "BILLS_ONLY"].includes(patch.balanceReminderMode) ? { autoPaused: false, pauseNoticePending: false } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    if (changed) {
      await recordReminderMeaningfulActivity(user.uid, "reminder_preferences_changed", now);
      const typesToCancel = new Set();
      if (patch.balanceReminderMode === "OFF" || patch.balanceReminderMode === "BILLS_ONLY" || patch.snoozeUntil) {
        typesToCancel.add(NOTIFICATION_TYPES.BALANCE_STALE);
        typesToCancel.add(NOTIFICATION_TYPES.BILL_AND_BALANCE_STALE);
      }
      if (patch.balanceReminderMode === "OFF" || patch.billRemindersEnabled === false) {
        typesToCancel.add(NOTIFICATION_TYPES.BILL_DUE_TOMORROW);
        typesToCancel.add(NOTIFICATION_TYPES.BILL_AND_BALANCE_STALE);
      }
      if (typesToCancel.size) await cancelPendingNotificationTypes(user.uid, [...typesToCancel], "preferences_changed");
      await queuePreferenceChangedNotification(user.uid, auditRef.id, { now }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, preferences: saved });
  } catch (error) {
    return preferenceError(error);
  }
}

function preferenceRef(uid) {
  return getAdminDb().collection("users").doc(uid).collection("settings").doc("emailPreferences");
}

async function requireVerifiedUser(request) {
  const user = await verifyRequestUser(request);
  if (!user?.uid || user.firebase?.sign_in_provider === "anonymous" || !user.email_verified) {
    const error = new Error("Use a verified ClearTill account to manage reminders.");
    error.code = "auth/unverified-account";
    throw error;
  }
  return user;
}

function preferenceError(error) {
  const authError = String(error?.code || "").startsWith("auth/");
  return NextResponse.json({ ok: false, error: authError ? "Please sign in again to manage reminders." : error?.message || "Reminder settings could not be saved." }, { status: authError ? 401 : 400 });
}
