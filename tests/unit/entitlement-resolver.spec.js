import { test, expect } from "@playwright/test";
import { toAccountBillingResponse } from "../../lib/entitlementResolver.server.js";

test("paid access is presented as active paid access", () => {
  const result = toAccountBillingResponse({
    status: "active",
    planName: "Founding Member",
    paymentType: "paid",
    amountPaidMinor: 500,
    currency: "gbp",
    accessExpiresAt: "2099-10-09T00:00:00.000Z",
  }, "member@example.com");
  expect(result.status).toBe("active");
  expect(result.accessType).toBe("paid");
  expect(result.amountPaidMinor).toBe(500);
});

test("zero-value promotion remains active access", () => {
  const result = toAccountBillingResponse({
    status: "active",
    isQaPurchase: true,
    amountPaidMinor: 0,
    coupon: "CLEAR100",
    accessExpiresAt: "2099-10-09T00:00:00.000Z",
  });
  expect(result.status).toBe("active");
  expect(result.accessType).toBe("promotional");
  expect(result.paymentStatus).toBe("promotional");
  expect(result.promotionLabel).toBe("CLEAR100");
});

test("expiry, refund and revocation override payment type", () => {
  expect(toAccountBillingResponse({ status: "active", accessExpiresAt: "2020-01-01" }).status).toBe("expired");
  expect(toAccountBillingResponse({ status: "refunded" }).status).toBe("refunded");
  expect(toAccountBillingResponse({ status: "revoked" }).status).toBe("revoked");
});
