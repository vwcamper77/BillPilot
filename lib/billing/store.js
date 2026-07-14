import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { computeEntitlementState, shouldApplySubscriptionSnapshot } from "@/lib/billing/access";

const USER_COLLECTION = "users";
const BILLING_COLLECTION = "billing";
const SUBSCRIPTION_DOC = "subscription";
const ACCESS_COLLECTION = "access";
const ENTITLEMENT_DOC = "entitlement";
const STRIPE_EVENTS_COLLECTION = "stripeEvents";

export function getUserRef(uid) {
  return getAdminDb().collection(USER_COLLECTION).doc(uid);
}

export function getSubscriptionRef(uid) {
  return getUserRef(uid).collection(BILLING_COLLECTION).doc(SUBSCRIPTION_DOC);
}

export function getEntitlementRef(uid) {
  return getUserRef(uid).collection(ACCESS_COLLECTION).doc(ENTITLEMENT_DOC);
}

export async function getSubscriptionState(uid) {
  const [subscriptionSnap, entitlementSnap] = await Promise.all([
    getSubscriptionRef(uid).get(),
    getEntitlementRef(uid).get(),
  ]);

  return {
    subscription: subscriptionSnap.exists ? subscriptionSnap.data() : null,
    entitlement: entitlementSnap.exists ? entitlementSnap.data() : null,
  };
}

export async function upsertUserProfile(uid, payload = {}) {
  const ref = getUserRef(uid);
  const snapshot = await ref.get();
  await ref.set({
    ...payload,
    updatedAt: FieldValue.serverTimestamp(),
    ...(snapshot.exists ? {} : { createdAt: payload.createdAt || FieldValue.serverTimestamp() }),
  }, { merge: true });
}

export async function syncSubscriptionState(uid, nextSubscription, { force = false } = {}) {
  const subscriptionRef = getSubscriptionRef(uid);
  const entitlementRef = getEntitlementRef(uid);

  await getAdminDb().runTransaction(async (transaction) => {
    const currentSnap = await transaction.get(subscriptionRef);
    const current = currentSnap.exists ? currentSnap.data() : {};

    if (!force && !shouldApplySubscriptionSnapshot(current, nextSubscription)) {
      return;
    }

    const merged = {
      ...current,
      ...nextSubscription,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: current.createdAt || FieldValue.serverTimestamp(),
    };
    const entitlement = {
      ...computeEntitlementState(merged),
      stripeCustomerId: merged.stripeCustomerId || "",
      stripeSubscriptionId: merged.stripeSubscriptionId || "",
      currentPeriodEnd: merged.currentPeriodEnd || null,
      trialEnd: merged.trialEnd || null,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: current.createdAt || FieldValue.serverTimestamp(),
    };

    transaction.set(subscriptionRef, merged, { merge: true });
    transaction.set(entitlementRef, entitlement, { merge: true });
  });
}

export async function markStripeEventProcessed(eventId, payload = {}) {
  const ref = getAdminDb().collection(STRIPE_EVENTS_COLLECTION).doc(eventId);
  return getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() : {};
    if (existing.processingStatus === "succeeded") return false;
    const processingStartedAt = existing.processingStartedAt?.toDate?.()?.getTime?.() || 0;
    if (existing.processingStatus === "processing" && Date.now() - processingStartedAt < 5 * 60 * 1000) return false;
    transaction.set(ref, {
      ...payload,
      processingStatus: "processing",
      attempts: FieldValue.increment(1),
      processingStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    return true;
  });
}

export async function completeStripeEvent(eventId, payload = {}) {
  if (!eventId) return;
  await getAdminDb().collection(STRIPE_EVENTS_COLLECTION).doc(eventId).set({
    ...payload,
    processingStatus: "succeeded",
    processedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastErrorCode: null,
  }, { merge: true });
}

export async function failStripeEvent(eventId, error) {
  if (!eventId) return;
  await getAdminDb().collection(STRIPE_EVENTS_COLLECTION).doc(eventId).set({
    processingStatus: "failed",
    failedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastErrorCode: String(error?.code || error?.type || "webhook_processing_error").slice(0, 80),
  }, { merge: true });
}
