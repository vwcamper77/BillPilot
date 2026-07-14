import { test, expect } from "@playwright/test";
import { normalizeEntitlementState } from "../../lib/entitlementResolver.server.js";

const NOW = new Date("2026-07-14T12:00:00.000Z");

function resolve(input = {}) {
  return normalizeEntitlementState({
    uid: "firebase-user-1",
    accountEmail: "member@example.com",
    now: NOW,
    ...input,
  });
}

test("paid founding access is normalized as active access", () => {
  const result = resolve({
    canonicalEntitlements: [{
      id: "cs_paid",
      status: "active",
      paymentType: "paid",
      accessSource: "stripe_paid",
      amountPaidMinor: 500,
      currency: "gbp",
      accessExpiresAt: "2026-10-09T00:00:00.000Z",
    }],
  });

  expect(result.hasAccess).toBe(true);
  expect(result.accessType).toBe("founding_member");
  expect(result.reason).toBe("canonical_founding_member");
});

test("zero-value founding promotion remains active access", () => {
  const result = resolve({
    canonicalEntitlements: [{
      id: "cs_qa",
      status: "active",
      paymentType: "promotional",
      accessSource: "stripe_promotion",
      amountPaidMinor: 0,
      coupon: "CLEAR100",
      accessExpiresAt: "2026-10-09T00:00:00.000Z",
    }],
  });

  expect(result.hasAccess).toBe(true);
  expect(result.accessType).toBe("founding_member");
});

test("expiry, refund and revocation override payment type", () => {
  for (const record of [
    { status: "active", accessExpiresAt: "2020-01-01T00:00:00.000Z" },
    { status: "refunded", accessExpiresAt: "2026-10-09T00:00:00.000Z" },
    { status: "revoked", accessExpiresAt: "2026-10-09T00:00:00.000Z" },
  ]) {
    expect(resolve({ canonicalEntitlements: [record] }).hasAccess).toBe(false);
  }
});

test("trialing and active subscriptions grant access", () => {
  const trial = resolve({
    subscription: {
      subscriptionStatus: "trialing",
      trialStart: "2026-07-13T00:00:00.000Z",
      trialEnd: "2026-07-20T00:00:00.000Z",
    },
  });
  expect(trial.hasAccess).toBe(true);
  expect(trial.accessType).toBe("active_trial");

  const active = resolve({ subscription: { subscriptionStatus: "active" } });
  expect(active.hasAccess).toBe(true);
  expect(active.accessType).toBe("active_subscription");
});

test("an expired trial cannot fall through as an active subscription", () => {
  const result = resolve({
    subscription: {
      subscriptionStatus: "trialing",
      trialStart: "2026-07-01T00:00:00.000Z",
      trialEnd: "2026-07-08T00:00:00.000Z",
    },
  });
  expect(result.hasAccess).toBe(false);
  expect(result.trialStatus).toBe("expired");
  expect(result.reason).toBe("trial_expired");
});

test("pending subscription states block access and duplicate checkout", () => {
  for (const subscriptionStatus of ["past_due", "unpaid", "paused", "incomplete"]) {
    const result = resolve({ subscription: { subscriptionStatus } });
    expect(result.hasAccess).toBe(false);
    expect(result.paymentPending).toBe(true);
    expect(result.preventsDuplicateCheckout).toBe(true);
  }
});

test("cancelled and incomplete-expired subscriptions are expired, not trial-not-started", () => {
  for (const subscriptionStatus of ["canceled", "cancelled", "incomplete_expired"]) {
    const result = resolve({ subscription: { subscriptionStatus } });
    expect(result.hasAccess).toBe(false);
    expect(result.reason).toBe("subscription_cancelled_or_expired");
    expect(result.paymentPending).toBe(false);
  }
});
