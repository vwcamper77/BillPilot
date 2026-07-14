import { getAdminDb } from "@/lib/firebaseAdmin";
import { getAccessExpiryDate } from "@/lib/billingAccess";
import { isEmailInAllowlist } from "@/lib/adminAuth.server";
import { normaliseStripeStatus, preventsDuplicateSubscription } from "@/lib/billing/access";
import entitlementRules from "@/lib/entitlementRules.cjs";

function toDate(value) {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateIso(value) {
  return toDate(value)?.toISOString() || null;
}

function isActiveRecord(record, now) {
  if (!record) return false;
  const status = String(record.status || record.accessStatus || "").toLowerCase();
  if (["refunded", "revoked", "expired", "cancelled", "canceled"].includes(status)) return false;
  const expiry = getAccessExpiryDate(record);
  if (expiry && expiry.getTime() <= now.getTime()) return false;
  return ["active", "claimed", "legacy", "granted"].includes(status)
    || Boolean(record.paid && (!expiry || expiry.getTime() > now.getTime()));
}

function inactiveEntitlementReason(record, now) {
  if (!record) return "no_entitlement";
  const status = String(record.status || record.accessStatus || "inactive").toLowerCase();
  const expiry = getAccessExpiryDate(record);
  if (expiry && expiry.getTime() <= now.getTime()) return "entitlement_expired";
  if (["cancelled", "canceled"].includes(status)) return "entitlement_cancelled";
  if (["refunded", "revoked"].includes(status)) return `entitlement_${status}`;
  return `entitlement_${status}`;
}

function bypassFor({ uid, email, user = {} }) {
  const normalizedUid = String(uid || "").trim();
  const configuredUids = new Set(String(process.env.ENTITLEMENT_BYPASS_UIDS || "").split(",").map((v) => v.trim()).filter(Boolean));
  const allowlistedEmail = isEmailInAllowlist(email, "ENTITLEMENT_BYPASS_EMAILS")
    || isEmailInAllowlist(email, "ADMIN_EMAILS")
    || isEmailInAllowlist(email, "FOUNDING_ACCESS_ADMIN_EMAILS");
  return Boolean(user.isAdminOrTestBypass || user.entitlementBypass || configuredUids.has(normalizedUid) || allowlistedEmail);
}

/** Pure normalization function, exported so every access rule is directly testable. */
export function normalizeEntitlementState({
  uid,
  accountEmail = null,
  user = {},
  subscription = {},
  subscriptionEntitlement = {},
  canonicalEntitlements = [],
  legacyBilling = {},
  customer = {},
  now = new Date(),
} = {}) {
  const isAuthenticated = Boolean(uid);
  const subscriptionStatus = normaliseStripeStatus(
    subscription.subscriptionStatus || subscriptionEntitlement.subscriptionStatus || customer.subscriptionStatus,
  );
  const trialStartedAt = dateIso(subscription.trialStart || subscriptionEntitlement.trialStart);
  const trialEndsAt = dateIso(subscription.trialEnd || subscriptionEntitlement.trialEnd || subscriptionEntitlement.trialEndAt);
  const currentPeriodEnd = dateIso(subscription.currentPeriodEnd || subscriptionEntitlement.currentPeriodEnd);
  const stripeCustomerId = subscription.stripeCustomerId
    || subscriptionEntitlement.stripeCustomerId
    || customer.stripeCustomerId
    || legacyBilling.stripeCustomerId
    || user.stripeCustomerId
    || null;
  const stripeSubscriptionId = subscription.stripeSubscriptionId
    || subscriptionEntitlement.stripeSubscriptionId
    || customer.stripeSubscriptionId
    || legacyBilling.stripeSubscriptionId
    || user.stripeSubscriptionId
    || null;
  const isAdminOrTestBypass = isAuthenticated && bypassFor({ uid, email: accountEmail || user.email, user });

  const rankedCanonical = [...canonicalEntitlements].sort((left, right) => {
    const active = Number(isActiveRecord(right, now)) - Number(isActiveRecord(left, now));
    if (active) return active;
    return (toDate(right.accessExpiresAt)?.getTime() || 0) - (toDate(left.accessExpiresAt)?.getTime() || 0);
  });
  const canonical = rankedCanonical[0] || null;
  const canonicalActive = isActiveRecord(canonical, now);
  const legacyActive = isActiveRecord(legacyBilling, now) || isActiveRecord(user, now);
  const trialActive = subscriptionStatus === "trialing" && (!trialEndsAt || new Date(trialEndsAt).getTime() > now.getTime());
  const trialExpired = subscriptionStatus === "trialing" && Boolean(trialEndsAt) && new Date(trialEndsAt).getTime() <= now.getTime();

  const canonicalSource = String(canonical?.accessSource || canonical?.paymentType || "").toLowerCase();
  const canonicalKind = canonicalSource.includes("manual") || canonicalSource.includes("internal_promo") || canonical?.paymentType === "free"
    ? "manually_granted" : "founding_member";
  const legacySource = String(legacyBilling.accessSource || user.accessSource || "").toLowerCase();
  const legacyPlan = String(legacyBilling.plan || user.accessPlan || "").toLowerCase();
  const legacyKind = legacySource.includes("manual") || legacySource.includes("internal")
    ? "manually_granted" : legacyPlan.includes("founding") ? "founding_member" : "legacy_paid";
  const decision = entitlementRules.decideEntitlement({
    isAuthenticated,
    isAdminOrTestBypass,
    subscriptionStatus,
    trialActive,
    trialExpired,
    canonicalActive,
    canonicalKind,
    legacyActive,
    legacyKind,
    inactiveEntitlementReason: inactiveEntitlementReason(canonical, now),
  });
  const { hasAccess, accessType, reason, paymentPending } = decision;

  const trialStatus = trialActive ? "active"
    : trialEndsAt && new Date(trialEndsAt).getTime() <= now.getTime() ? "expired"
      : trialStartedAt ? "ended" : "not_started";
  const accessExpiresAt = dateIso(canonical?.accessExpiresAt || canonical?.accessUntil || legacyBilling.accessExpiresAt || legacyBilling.accessUntil || user.accessUntil);

  return {
    isAuthenticated,
    hasAccess,
    accessType,
    subscriptionStatus,
    trialStatus,
    trialStartedAt,
    trialEndsAt,
    currentPeriodEnd,
    stripeCustomerId,
    stripeSubscriptionId,
    isFoundingMember: accessType === "founding_member",
    isAdminOrTestBypass,
    reason,
    paymentPending,
    preventsDuplicateCheckout: decision.preventsDuplicateCheckout || preventsDuplicateSubscription(subscriptionStatus),
    canManageBilling: Boolean(stripeCustomerId),
    accessExpiresAt,
    accountEmail: accountEmail || user.email || null,
    paymentEmail: canonical?.checkoutEmail || canonical?.claimedEmail || subscription.customerEmail || customer.paymentEmail || null,
    sourceRecordId: canonical?.id || null,
    // Transitional aliases for existing clients. New code should use the normalized fields above.
    hasFullAccess: hasAccess,
    canManageSubscription: Boolean(stripeCustomerId),
    trialStart: trialStartedAt,
    trialEnd: trialEndsAt,
  };
}

export async function resolveEntitlementForUid(uid, { accountEmail = null } = {}) {
  if (!uid) return normalizeEntitlementState({ uid: null, accountEmail });
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const [userSnap, subscriptionSnap, subscriptionEntitlementSnap, canonicalSnap, legacySnap, customerSnap] = await Promise.all([
    userRef.get(),
    userRef.collection("billing").doc("subscription").get(),
    userRef.collection("access").doc("entitlement").get(),
    db.collection("pendingEntitlements").where("uid", "==", uid).limit(20).get(),
    userRef.collection("settings").doc("billing").get(),
    db.collection("customers").doc(uid).get(),
  ]);
  return normalizeEntitlementState({
    uid,
    accountEmail,
    user: userSnap.exists ? userSnap.data() : {},
    subscription: subscriptionSnap.exists ? subscriptionSnap.data() : {},
    subscriptionEntitlement: subscriptionEntitlementSnap.exists ? subscriptionEntitlementSnap.data() : {},
    canonicalEntitlements: canonicalSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    legacyBilling: legacySnap.exists ? legacySnap.data() : {},
    customer: customerSnap.exists ? customerSnap.data() : {},
  });
}

export async function hasActiveEntitlement(uid, options = {}) {
  const entitlement = await resolveEntitlementForUid(uid, options);
  return {
    accessActive: entitlement.hasAccess,
    state: entitlement.hasAccess ? "access_active"
      : entitlement.paymentPending ? "payment_pending"
        : entitlement.reason.includes("expired") || entitlement.reason.includes("cancelled") ? "access_expired"
          : entitlement.reason.includes("refunded") ? "access_refunded"
            : entitlement.reason.includes("revoked") ? "access_revoked"
          : "access_missing",
    entitlement,
  };
}
