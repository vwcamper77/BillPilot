const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
}

test("checkout route uses subscription mode with 7-day trial and payment method collection", () => {
  const source = read("app/api/stripe/checkout/route.js");
  assert.match(source, /mode:\s*"subscription"/);
  assert.match(source, /payment_method_collection:\s*"always"/);
  assert.match(source, /trial_period_days:\s*runtime\.config\.trialLengthDays/);
  assert.match(source, /price:\s*process\.env\.STRIPE_MONTHLY_PRICE_ID/);
});

test("billing config exposes rollback flag and new monthly price env var", () => {
  const source = read("lib/billing/config.js");
  assert.match(source, /SUBSCRIPTION_TRIAL_ENABLED/);
  assert.match(source, /STRIPE_MONTHLY_PRICE_ID/);
  assert.match(source, /£1\.99/);
});

test("portal route requires authenticated ownership before creating a session", () => {
  const source = read("app/api/stripe/portal/route.js");
  assert.match(source, /verifyRequestUser/);
  assert.match(source, /No subscription owner was found for this account/);
  assert.match(source, /billingPortal\.sessions\.create/);
});

test("scheduler route protects optional reminders with idempotent claims and unsubscribe support", () => {
  const source = read("app/api/scheduler/route.js");
  assert.match(source, /claimEmailDelivery/);
  assert.match(source, /shouldSuppressOptionalEmail/);
  assert.match(source, /buildUnsubscribeUrl/);
  assert.match(source, /weekly_planning/);
  assert.match(source, /midweek_balance/);
});

test("analytics sanitiser blocks sensitive fields from event payloads", () => {
  const source = read("lib/analytics.js");
  assert.match(source, /BLOCKED_KEYS/);
  assert.match(source, /"balance"/);
  assert.match(source, /"email"/);
  assert.match(source, /"amount"/);
});

test("dashboard presents the result before the trial CTA copy", () => {
  const source = read("app/dashboard/page.jsx");
  assert.match(source, /You're clear:/);
  assert.match(source, /Start 7-day free trial/);
  assert.match(source, /charges £0 now, bills £1\.99 after the 7-day trial, then charges monthly unless you cancel/);
  assert.match(source, /Save this result with Google or email first/);
});

test("trial signup continues directly from account creation to Stripe", () => {
  const source = read("app/dashboard/page.jsx");
  assert.match(source, /entryIntent === "trial"/);
  assert.match(source, /startTrialCheckoutForUser\(credential\.user\)/);
  assert.match(source, /billing\/subscribe\/success\?session_id=\{CHECKOUT_SESSION_ID\}/);
});

test("subscription success securely confirms Stripe ownership and activates access", () => {
  const source = read("app/api/stripe/confirm-subscription/route.js");
  assert.match(source, /verifyRequestUser/);
  assert.match(source, /session\.metadata\?\.firebaseUid !== user\.uid/);
  assert.match(source, /session\.status !== "complete"/);
  assert.match(source, /syncStripeSubscriptionToFirestore/);
});
