const TRIAL_LENGTH_DAYS = 7;
const MONTHLY_PRICE_PENCE = 199;

function isEnabledFlag(value) {
  return String(value || "").toLowerCase() === "true";
}

export function getSubscriptionTrialFlag() {
  return isEnabledFlag(process.env.SUBSCRIPTION_TRIAL_ENABLED);
}

export function getAppBaseUrl() {
  return String(
    process.env.NEXT_PUBLIC_APP_URL
    || process.env.APP_URL
    || "http://localhost:3000",
  ).replace(/\/+$/, "");
}

export function getBillingRuntimeConfig() {
  const enabled = getSubscriptionTrialFlag();
  const config = {
    enabled,
    trialLengthDays: TRIAL_LENGTH_DAYS,
    monthlyPricePence: MONTHLY_PRICE_PENCE,
    monthlyPriceDisplay: "£1.99",
    offerHeadline: "Start your 7-day free trial",
    offerCopy: "£0 today. After 7 days, ClearTill bills £1.99, then continues monthly unless you cancel.",
    checkoutCommitmentCopy: "By continuing, you start a 7-day free trial. Stripe collects your payment method today, charges £0 now, bills £1.99 after the 7-day trial, then charges monthly unless you cancel.",
    baseUrl: getAppBaseUrl(),
    hasStripe: Boolean(process.env.STRIPE_SECRET_KEY),
    hasPortal: Boolean(process.env.STRIPE_SECRET_KEY),
    hasMonthlyPrice: Boolean(process.env.STRIPE_MONTHLY_PRICE_ID),
  };

  if (!enabled) {
    return { ok: true, config };
  }

  const missing = [];

  if (!process.env.STRIPE_SECRET_KEY) {
    missing.push("STRIPE_SECRET_KEY");
  }
  if (!process.env.STRIPE_MONTHLY_PRICE_ID) {
    missing.push("STRIPE_MONTHLY_PRICE_ID");
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    missing.push("STRIPE_WEBHOOK_SECRET");
  }

  if (missing.length) {
    return {
      ok: false,
      code: "billing_config_incomplete",
      message: `Billing is not ready yet. Missing: ${missing.join(", ")}.`,
      config,
    };
  }

  return { ok: true, config };
}
