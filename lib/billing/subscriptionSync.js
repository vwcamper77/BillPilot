import { trackServerAnalyticsEvent } from "@/lib/analytics";
import { normaliseStripeStatus } from "@/lib/billing/access";
import { syncSubscriptionState, upsertUserProfile } from "@/lib/billing/store";
import { safeInfo } from "@/lib/security/safeLog";

function toMillis(value) {
  if (!value) return null;
  if (typeof value === "number") return value * 1000;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  return null;
}

export function mapStripeSubscription(subscription, extras = {}) {
  const latestInvoiceStatus = typeof subscription.latest_invoice === "object"
    ? subscription.latest_invoice?.status || ""
    : extras.latestInvoiceStatus || "";

  return {
    stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : extras.stripeCustomerId || "",
    stripeSubscriptionId: subscription.id || "",
    stripePriceId: subscription.items?.data?.[0]?.price?.id || extras.stripePriceId || "",
    subscriptionStatus: normaliseStripeStatus(subscription.status),
    trialStart: toMillis(subscription.trial_start),
    trialEnd: toMillis(subscription.trial_end),
    currentPeriodEnd: toMillis(subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: toMillis(subscription.canceled_at),
    firstSuccessfulPaymentAt: extras.firstSuccessfulPaymentAt || null,
    latestInvoiceStatus,
    lastStripeEventAt: extras.lastStripeEventAt || Date.now(),
    lastStripeEventId: extras.lastStripeEventId || "",
    checkoutCompletedAt: extras.checkoutCompletedAt || null,
  };
}

export async function syncStripeSubscriptionToFirestore({ uid, subscription, customerEmail = "", extras = {} }) {
  if (!uid || !subscription) {
    return;
  }

  const mapped = mapStripeSubscription(subscription, extras);
  await upsertUserProfile(uid, {
    email: customerEmail || extras.customerEmail || "",
    stripeCustomerId: mapped.stripeCustomerId || "",
  });
  await syncSubscriptionState(uid, {
    ...mapped,
    customerEmail: customerEmail || extras.customerEmail || "",
  });

  if (mapped.subscriptionStatus === "trialing") {
    await trackServerAnalyticsEvent("trial_started", { uid, source: "stripe_webhook" });
  }

  safeInfo("[billing] synced subscription", {
    uid,
    status: mapped.subscriptionStatus,
    hasCustomer: Boolean(mapped.stripeCustomerId),
  });
}
