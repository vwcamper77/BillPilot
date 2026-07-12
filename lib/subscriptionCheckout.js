import { SUBSCRIPTION_TRIAL_DAYS } from "@/lib/subscriptionFlags";

export function buildSubscriptionCheckoutParams({ uid, email, priceId, origin, stripeCustomerId = "", gaClientId = "" }) {
  return {
    mode: "subscription",
    ...(stripeCustomerId ? { customer: stripeCustomerId } : { customer_email: email }),
    client_reference_id: uid,
    success_url: `${origin}/billing/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing/subscribe/cancel`,
    payment_method_collection: "always",
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: SUBSCRIPTION_TRIAL_DAYS,
      metadata: { firebase_uid: uid, planKey: "monthly_subscription" },
    },
    metadata: { firebase_uid: uid, planKey: "monthly_subscription", flow: "subscription_trial", gaClientId },
  };
}

