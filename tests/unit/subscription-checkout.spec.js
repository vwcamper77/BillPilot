import { expect, test } from "@playwright/test";
import { buildSubscriptionCheckoutParams } from "../../lib/subscriptionCheckout.js";
import { invoiceSubscriptionId, isSubscriptionEntitled } from "../../lib/subscriptionState.js";

test("subscription Checkout uses the configured paid Price without a Stripe trial", () => {
  const params = buildSubscriptionCheckoutParams({ uid: "uid_1", email: "member@example.com", priceId: "price_monthly_test", plan: "monthly", origin: "https://example.com" });
  expect(params.mode).toBe("subscription");
  expect(params.payment_method_collection).toBe("always");
  expect(params.line_items).toEqual([{ price: "price_monthly_test", quantity: 1 }]);
  expect(params.subscription_data.trial_period_days).toBeUndefined();
  expect(params.metadata.flow).toBe("paid_upgrade");
  expect(params).not.toHaveProperty("payment_intent_data");
  expect(JSON.stringify(params)).not.toContain("199");
});

test("existing Stripe Customer is reused without sending customer_email", () => {
  const params = buildSubscriptionCheckoutParams({ uid: "uid_1", email: "member@example.com", priceId: "price_1", origin: "https://example.com", stripeCustomerId: "cus_owner" });
  expect(params.customer).toBe("cus_owner");
  expect(params).not.toHaveProperty("customer_email");
});

test("subscription status and modern invoice subscription shapes are handled", () => {
  expect(isSubscriptionEntitled("trialing")).toBe(true);
  expect(isSubscriptionEntitled("active")).toBe(true);
  expect(isSubscriptionEntitled("unpaid")).toBe(false);
  expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_123" } } })).toBe("sub_123");
});
