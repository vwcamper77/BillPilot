export function isSubscriptionTrialEnabled() {
  return process.env.SUBSCRIPTION_TRIAL_ENABLED === "true";
}

export function getMonthlySubscriptionPriceId() {
  const priceId = String(process.env.STRIPE_MONTHLY_PRICE_ID || "").trim();
  if (!priceId) {
    const error = new Error("Monthly subscription billing is not configured.");
    error.code = "subscription/configuration";
    throw error;
  }
  return priceId;
}

export const SUBSCRIPTION_TRIAL_DAYS = 7;
export const MONTHLY_PRICE_MINOR = 199;

