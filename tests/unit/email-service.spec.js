import { test, expect } from "@playwright/test";
import {
  CANONICAL_EMAIL_SENDER,
  getMockEmailDeliveries,
  resetMockEmailDeliveries,
  sendEmail,
} from "../../lib/email/emailService.server.js";

test.beforeEach(() => resetMockEmailDeliveries());

test("test mode records email in the mock and uses the canonical sender", async () => {
  const result = await sendEmail({
    from: "Unexpected Sender <old-sender@example.com>",
    to: "customer@example.com",
    subject: "Mock delivery",
    text: "Test",
  });

  expect(result.mocked).toBe(true);
  expect(getMockEmailDeliveries()).toEqual([
    expect.objectContaining({
      from: CANONICAL_EMAIL_SENDER,
      to: "customer@example.com",
      subject: "Mock delivery",
    }),
  ]);
});

test("cleartill.test addresses are blocked before even the mock provider", async () => {
  const result = await sendEmail({
    to: "automated-checkout@cleartill.test",
    subject: "Must not send",
    text: "Test",
  });

  expect(result).toEqual({ providerId: null, skipped: true, reason: "blocked_test_address" });
  expect(getMockEmailDeliveries()).toEqual([]);
});
