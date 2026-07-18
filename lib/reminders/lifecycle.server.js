import crypto from "crypto";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { getAppBaseUrl } from "@/lib/billing/config";
import { NOTIFICATION_TYPES } from "./policy";

function toDate(value) {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function iso(value) {
  return toDate(value)?.toISOString() || null;
}

function stableVersion(parts) {
  return crypto.createHash("sha256").update(parts.map((part) => String(part ?? "")).join("|")).digest("hex").slice(0, 24);
}

function paidAccess(entitlement) {
  return entitlement.hasAccess && entitlement.accessType !== "no_card_preview";
}

export function deriveCommercialLifecycle({ uid, existing = {}, entitlement, subscription = {}, preview = {}, now = new Date(), cohort = "GUIDED" }) {
  const previewUsed = Boolean(entitlement.previewUsed || preview.startedAt || ["active", "expired", "converted"].includes(String(preview.status || "").toLowerCase()));
  const stripeTrial = entitlement.subscriptionStatus === "trialing" && entitlement.trialStatus === "active";
  const entryPath = existing.entryPath || (stripeTrial || previewUsed ? "FREE_TRIAL" : paidAccess(entitlement) ? "DIRECT_PAID" : null);
  let entitlementState = "INACTIVE";
  if (stripeTrial || entitlement.previewStatus === "active") entitlementState = "TRIAL_ACTIVE";
  else if (paidAccess(entitlement)) entitlementState = "PAID_ACTIVE";
  else if (["past_due", "unpaid"].includes(entitlement.subscriptionStatus)) entitlementState = "PAST_DUE";
  else if (["canceled", "cancelled"].includes(entitlement.subscriptionStatus)) entitlementState = "CANCELLED";
  else if (entryPath === "FREE_TRIAL" && (entitlement.previewStatus === "expired" || entitlement.trialStatus === "expired" || previewUsed)) entitlementState = "TRIAL_EXPIRED";

  const conversionType = existing.conversionType || (stripeTrial ? "AUTO_RENEW" : entryPath === "FREE_TRIAL" ? "MANUAL_CONVERSION" : null);
  const trialStartedAt = iso(existing.trialStartedAt || entitlement.trialStartedAt || entitlement.previewStartedAt || preview.startedAt);
  const trialEndsAt = iso(entitlement.trialEndsAt || entitlement.previewEndsAt || preview.endsAt || existing.trialEndsAt);
  const paidActivatedAt = existing.paidActivatedAt || (entitlementState === "PAID_ACTIVE" ? iso(subscription.firstSuccessfulPaymentAt || subscription.checkoutCompletedAt || subscription.updatedAt || now) : null);
  const reminderLifecycleStartedAt = existing.reminderLifecycleStartedAt || (entryPath === "FREE_TRIAL" ? trialStartedAt : paidActivatedAt);
  const sourceVersion = stableVersion([
    entryPath, entitlementState, subscription.lastStripeEventId, entitlement.stripeSubscriptionId,
    entitlement.previewStatus, trialStartedAt, trialEndsAt, subscription.currentPeriodEnd,
  ]);
  const price = subscription.planAmountMinor || subscription.unitAmount || null;

  return {
    uid,
    entryPath,
    entitlementState,
    conversionType,
    sourceId: entitlement.stripeSubscriptionId || (trialStartedAt ? `preview:${trialStartedAt}` : entitlement.sourceRecordId || null),
    sourceVersion,
    trialStartedAt,
    trialEndsAt,
    paidActivatedAt,
    reminderLifecycleStartedAt,
    firstValueActionAt: existing.firstValueActionAt || null,
    cohort: existing.cohort || cohort,
    planName: subscription.planName || subscription.planNickname || null,
    planAmountMinor: price ? Number(price) : null,
    planCurrency: subscription.planCurrency || null,
    billingInterval: subscription.billingInterval || null,
    firstChargeAt: conversionType === "AUTO_RENEW" ? trialEndsAt : null,
    cancelUrl: conversionType === "AUTO_RENEW" ? `${getAppBaseUrl()}/billing` : null,
    previousEntitlementState: existing.entitlementState || null,
    updatedAt: now.toISOString(),
  };
}

export function lifecycleTransitionEvent(previous, current) {
  if (!current.entryPath) return null;
  if (!previous?.entryPath) {
    if (current.entitlementState === "TRIAL_ACTIVE" && current.entryPath === "FREE_TRIAL") return NOTIFICATION_TYPES.TRIAL_WELCOME;
    if (current.entitlementState === "PAID_ACTIVE" && current.entryPath === "DIRECT_PAID") return NOTIFICATION_TYPES.DIRECT_PAID_WELCOME;
  }
  if (previous?.entitlementState === "TRIAL_ACTIVE" && current.entitlementState === "PAID_ACTIVE" && current.entryPath === "FREE_TRIAL") return NOTIFICATION_TYPES.TRIAL_CONVERTED_TO_PAID;
  if (previous?.entitlementState === "TRIAL_ACTIVE" && current.entitlementState === "TRIAL_EXPIRED" && current.entryPath === "FREE_TRIAL") return NOTIFICATION_TYPES.TRIAL_EXPIRED;
  return null;
}

export async function syncCommercialLifecycle({ uid, entitlement, subscription, preview, now = new Date(), cohort = "GUIDED" }) {
  const ref = getAdminDb().collection("users").doc(uid).collection("notifications").doc("lifecycle");
  return getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? snapshot.data() : {};
    const current = deriveCommercialLifecycle({ uid, existing: previous, entitlement, subscription, preview, now, cohort });
    if (!current.entryPath) return { previous, current, eventType: null };
    transaction.set(ref, {
      ...current,
      trialStartedAt: toDate(current.trialStartedAt),
      trialEndsAt: toDate(current.trialEndsAt),
      paidActivatedAt: toDate(current.paidActivatedAt),
      reminderLifecycleStartedAt: toDate(current.reminderLifecycleStartedAt),
      firstValueActionAt: toDate(current.firstValueActionAt),
      updatedAt: FieldValue.serverTimestamp(),
      ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    return { previous, current, eventType: lifecycleTransitionEvent(previous, current) };
  });
}

export async function recordReminderMeaningfulActivity(uid, reason, now = new Date()) {
  const userRef = getAdminDb().collection("users").doc(uid);
  const lifecycleRef = userRef.collection("notifications").doc("lifecycle");
  const stateRef = userRef.collection("notifications").doc("state");
  await getAdminDb().runTransaction(async (transaction) => {
    const [lifecycleSnapshot, stateSnapshot] = await Promise.all([transaction.get(lifecycleRef), transaction.get(stateRef)]);
    const state = stateSnapshot.exists ? stateSnapshot.data() : {};
    const lastActivity = toDate(state.lastMeaningfulActivityAt);
    if (lastActivity && now.getTime() - lastActivity.getTime() < 5 * 60 * 1000) return;
    transaction.set(lifecycleRef, {
      ...(lifecycleSnapshot.data()?.firstValueActionAt ? {} : { firstValueActionAt: now }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(stateRef, { lastMeaningfulActivityAt: now, consecutiveNoActionReminders: 0, updatedAt: FieldValue.serverTimestamp(), lastActivityReason: String(reason || "activity").slice(0, 60) }, { merge: true });
  });
}
