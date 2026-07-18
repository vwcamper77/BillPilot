import { expect, test } from "@playwright/test";
import { deliveryStage, maskOperationalEmail, meaningfulActivityAfterDelivery, summariseEmailDeliveries } from "../../lib/emailOperations.js";

test("delivery states distinguish firing, provider acceptance and mailbox delivery", () => {
  expect(deliveryStage("claimed")).toBe("fired");
  expect(deliveryStage("sent")).toBe("provider_accepted");
  expect(deliveryStage("delivered")).toBe("delivered");
  expect(deliveryStage("deferred")).toBe("delayed");
  expect(deliveryStage("permanent_failure")).toBe("failed");
});

test("email operations summary counts each durable outcome", () => {
  expect(summariseEmailDeliveries([{ status: "sent" }, { status: "delivered" }, { status: "bounced" }])).toEqual({ total: 3, fired: 0, provider_accepted: 1, delivered: 1, delayed: 0, bounced: 1, complained: 0, failed: 0 });
});

test("recipient email is masked and activity requires a later authenticated event", () => {
  expect(maskOperationalEmail("gavin@example.com")).toBe("ga•••@example.com");
  expect(meaningfulActivityAfterDelivery("2026-07-18T12:00:00Z", "2026-07-18T12:01:00Z")).toBe(true);
  expect(meaningfulActivityAfterDelivery("2026-07-18T12:00:00Z", "2026-07-18T11:59:00Z")).toBe(false);
});
