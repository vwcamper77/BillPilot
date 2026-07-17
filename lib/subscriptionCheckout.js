import { attributionMetadata } from "@/lib/analytics/attribution.server";

export function buildSubscriptionCheckoutParams({ uid, email, priceId, plan = "monthly", origin, stripeCustomerId = "", gaClientId = "", internalTest = false, attribution = null }) {
  return {
    mode: "subscription",
    ...(stripeCustomerId ? { customer: stripeCustomerId } : { customer_email: email }),
    client_reference_id: uid,
    success_url: `${origin}/billing/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing/subscribe/cancel`,
    payment_method_collection: "always",
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      metadata: { firebaseUid: uid, planKey: `${plan}_subscription`, flow: "paid_upgrade", internal_test: internalTest ? "1" : "0", ...attributionMetadata(attribution) },
    },
    metadata: { firebaseUid: uid, planKey: `${plan}_subscription`, flow: "paid_upgrade", gaClientId, internal_test: internalTest ? "1" : "0", ...attributionMetadata(attribution) },
  };
}
