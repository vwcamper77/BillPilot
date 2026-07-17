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

export function getSubscriptionPriceId(plan) {
  if (plan === "monthly") return getMonthlySubscriptionPriceId();
  if (plan === "annual") {
    const priceId = String(process.env.STRIPE_ANNUAL_PRICE_ID || "").trim();
    if (!priceId) {
      const error = new Error("Annual subscription billing is not configured.");
      error.code = "subscription/configuration";
      throw error;
    }
    return priceId;
  }
  const error = new Error("Choose either the monthly or annual plan.");
  error.code = "subscription/invalid-plan";
  throw error;
}

export const SUBSCRIPTION_TRIAL_DAYS = 7;
export const MONTHLY_PRICE_MINOR = 199;
export const CURRENT_MONTHLY_PRICE_MINOR = 399;
export const CURRENT_ANNUAL_PRICE_MINOR = 2499;
