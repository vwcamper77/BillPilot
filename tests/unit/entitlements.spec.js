import { expect, test } from "@playwright/test";
import {
  generateClaimToken,
  hashClaimToken,
  maskEmail,
  getCheckoutFulfillability,
} from "../../lib/entitlements.server.js";
import { buildAccessLinkEmail, formatAccessExpiry } from "../../lib/email/accessLinkTemplate.js";
import { hashForAnalytics } from "../../lib/analytics/ga4.server.js";

process.env.STRIPE_PRICE_ID = "price_founding_test";

test("generateClaimToken produces long, unique, URL-safe tokens", () => {
  const a = generateClaimToken();
  const b = generateClaimToken();
  expect(a).not.toBe(b);
  expect(a.length).toBeGreaterThanOrEqual(40);
  expect(a).toMatch(/^[A-Za-z0-9\-_]+$/);
});

test("hashClaimToken is deterministic and one-way", () => {
  const token = generateClaimToken();
  expect(hashClaimToken(token)).toBe(hashClaimToken(token));
  expect(hashClaimToken(token)).not.toBe(token);
  expect(hashClaimToken(token)).toMatch(/^[0-9a-f]{64}$/);
});

test("maskEmail redacts the local part but keeps the domain", () => {
  expect(maskEmail("gemma@example.com")).toBe("g***@example.com");
  expect(maskEmail("")).toBe("***");
  expect(maskEmail("not-an-email")).toBe("***");
});

test("hashForAnalytics never returns the raw value and is deterministic", () => {
  const sessionId = "cs_live_a1b2c3d4e5f6";
  const hashed = hashForAnalytics(sessionId);
  expect(hashed).not.toBe(sessionId);
  expect(hashed).toBe(hashForAnalytics(sessionId));
  expect(hashed.length).toBe(16);
});

function fixtureSession(overrides = {}) {
  return {
    id: "cs_test_fixture",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    amount_total: 500,
    currency: "gbp",
    created: Math.floor(Date.now() / 1000),
    customer: "cus_fixture",
    customer_details: { email: "buyer@example.com" },
    metadata: {},
    discounts: [],
    line_items: { data: [{ quantity: 1, price: { id: "price_founding_test", product: "prod_founding_test" } }] },
    ...overrides,
  };
}

test("a genuine paid session is fulfillable and not QA", async () => {
  const result = await getCheckoutFulfillability(fixtureSession());
  expect(result.fulfillable).toBe(true);
  expect(result.isQaPurchase).toBe(false);
  expect(result.amountPaid).toBe(500);
});

test("a zero-total promotion is not founding-member fulfilment", async () => {
  const result = await getCheckoutFulfillability(fixtureSession({
    payment_status: "no_payment_required",
    amount_total: 0,
    discounts: [{ promotion_code: { code: "clear100" } }],
  }));
  expect(result.fulfillable).toBe(false);
  expect(result.isQaPurchase).toBe(false);
  expect(result.coupon).toBe("CLEAR100");
});

test("wrong mode, amount, price, quantity, or extra line items are rejected", async () => {
  const invalidSessions = [
    fixtureSession({ mode: "subscription" }),
    fixtureSession({ amount_total: 499 }),
    fixtureSession({ line_items: { data: [{ quantity: 1, price: { id: "price_other" } }] } }),
    fixtureSession({ line_items: { data: [{ quantity: 2, price: { id: "price_founding_test" } }] } }),
    fixtureSession({ line_items: { data: [
      { quantity: 1, price: { id: "price_founding_test" } },
      { quantity: 1, price: { id: "price_other" } },
    ] } }),
  ];
  for (const session of invalidSessions) {
    expect((await getCheckoutFulfillability(session)).fulfillable).toBe(false);
  }
});

test("an unrecognised zero-total session is rejected, not silently treated as QA", async () => {
  const result = await getCheckoutFulfillability(fixtureSession({
    payment_status: "no_payment_required",
    amount_total: 0,
    discounts: [],
  }));
  expect(result.fulfillable).toBe(false);
});

test("a zero-total session with an unconfirmed promo code is rejected", async () => {
  const result = await getCheckoutFulfillability(fixtureSession({
    payment_status: "no_payment_required",
    amount_total: 0,
    discounts: [{ promotion_code: { code: "SOMEOTHERCODE" } }],
  }));
  expect(result.fulfillable).toBe(false);
});

test("an incomplete session is never fulfillable regardless of payment_status", async () => {
  const result = await getCheckoutFulfillability(fixtureSession({ status: "open" }));
  expect(result.fulfillable).toBe(false);
});

test("an unpaid, non-zero-total session is not fulfillable", async () => {
  const result = await getCheckoutFulfillability(fixtureSession({ payment_status: "unpaid" }));
  expect(result.fulfillable).toBe(false);
});

test("the access-link email never mentions Stripe session ids, tokens, or raw amounts", () => {
  const { text, html, subject } = buildAccessLinkEmail({
    signInUrl: "https://cleartill.money/access/claim?ct=abc123&sid=cs_test_456",
    accessExpiresAt: "2026-10-01",
  });

  expect(subject).not.toMatch(/cs_test|£|\$/i);
  for (const body of [text, html]) {
    expect(body).not.toMatch(/oobCode/i);
    expect(body).not.toMatch(/session/i);
    expect(body).toContain("hello@cleartill.money");
  }
});

test("formatAccessExpiry renders a human-readable London date", () => {
  expect(formatAccessExpiry("2026-10-01T00:00:00.000Z")).toMatch(/2026/);
});
