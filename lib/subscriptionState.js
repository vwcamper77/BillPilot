export const ENTITLED_SUBSCRIPTION_STATUSES = new Set(["trialing", "active"]);
export const RECOVERABLE_SUBSCRIPTION_STATUSES = new Set(["past_due"]);
export const BLOCKING_SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due", "unpaid", "paused", "incomplete"]);

export function isSubscriptionEntitled(status) {
  return ENTITLED_SUBSCRIPTION_STATUSES.has(String(status || ""));
}

export function stripeId(value) {
  return typeof value === "string" ? value : value?.id ? String(value.id) : null;
}

export function stripeDate(seconds) {
  return Number.isFinite(Number(seconds)) && Number(seconds) > 0
    ? new Date(Number(seconds) * 1000)
    : null;
}

export function invoiceSubscriptionId(invoice) {
  return stripeId(invoice?.subscription)
    || stripeId(invoice?.parent?.subscription_details?.subscription)
    || null;
}

export function subscriptionAccessStatus(subscriptionStatus) {
  return isSubscriptionEntitled(subscriptionStatus) ? "active" : "inactive";
}

