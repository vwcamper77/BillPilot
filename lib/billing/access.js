export const ENTITLED_SUBSCRIPTION_STATUSES = new Set(["trialing", "active"]);
export const BLOCKED_SUBSCRIPTION_STATUSES = new Set([
  "canceled",
  "cancelled",
  "unpaid",
  "incomplete_expired",
]);
export const DUPLICATE_SUBSCRIPTION_STATUSES = new Set([
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
]);

export function normaliseStripeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "canceled") return "cancelled";
  return value || "none";
}

export function isEntitledSubscriptionStatus(status) {
  return ENTITLED_SUBSCRIPTION_STATUSES.has(normaliseStripeStatus(status));
}

export function preventsDuplicateSubscription(status) {
  return DUPLICATE_SUBSCRIPTION_STATUSES.has(normaliseStripeStatus(status));
}

export function computeEntitlementState(subscription = {}) {
  const normalisedStatus = normaliseStripeStatus(subscription.subscriptionStatus);
  const legacyAccess = Boolean(subscription.legacyAccess);
  const entitled = legacyAccess || isEntitledSubscriptionStatus(normalisedStatus);
  const accessStatus = legacyAccess
    ? "legacy"
    : entitled
      ? normalisedStatus
      : BLOCKED_SUBSCRIPTION_STATUSES.has(normalisedStatus)
        ? "blocked"
        : "limited";

  return {
    hasFullAccess: entitled,
    canManageSubscription: Boolean(subscription.stripeCustomerId),
    entitlementStatus: accessStatus,
    subscriptionStatus: normalisedStatus,
    accessSource: legacyAccess ? "legacy" : "subscription",
  };
}

export function shouldApplySubscriptionSnapshot(current = {}, incoming = {}) {
  const currentEventAt = Number(current.lastStripeEventAt || 0);
  const incomingEventAt = Number(incoming.lastStripeEventAt || 0);

  if (!currentEventAt) return true;
  if (!incomingEventAt) return true;
  return incomingEventAt >= currentEventAt;
}
