const ACTIVE = new Set(["active"]);
const PENDING = new Set(["incomplete", "past_due", "unpaid", "paused"]);

function decideEntitlement(input = {}) {
  const status = String(input.subscriptionStatus || "none").toLowerCase();
  if (!input.isAuthenticated) return result(false, "none", "not_authenticated", status);
  if (input.isAdminOrTestBypass) return result(true, "admin_test", "server_allowlisted_bypass", status);
  if (input.trialActive) return result(true, "active_trial", "stripe_subscription_trialing", status);
  if (status === "trialing" && input.trialExpired) return result(false, "none", "trial_expired", status);
  if (ACTIVE.has(status)) return result(true, "active_subscription", "stripe_subscription_active", status);
  if (input.canonicalActive) return result(true, input.canonicalKind || "founding_member", `canonical_${input.canonicalKind || "founding_member"}`, status);
  if (input.legacyActive) return result(true, input.legacyKind || "legacy_paid", `legacy_${input.legacyKind || "legacy_paid"}`, status);
  if (PENDING.has(status)) return result(false, "none", `payment_${status}`, status);
  if (["cancelled", "canceled", "incomplete_expired"].includes(status)) return result(false, "none", "subscription_cancelled_or_expired", status);
  return result(false, "none", input.inactiveEntitlementReason || "no_entitlement", status);
}

function result(hasAccess, accessType, reason, subscriptionStatus) {
  const paymentPending = !hasAccess && PENDING.has(subscriptionStatus);
  return {
    hasAccess,
    accessType,
    reason,
    paymentPending,
    preventsDuplicateCheckout: hasAccess || paymentPending,
  };
}

module.exports = { decideEntitlement };
