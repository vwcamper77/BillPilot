const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classifyOneOff, classifyInvoice, containsSensitiveFields } = require("../lib/billing/commercePolicy.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("manual success URL and refresh cannot fulfil or emit Purchase", () => {
  const page = read("app/billing/success/page.jsx");
  assert.doesNotMatch(page, /grantFoundingAccess|createPendingEntitlement|PurchasePixel|track\([^)]*Purchase/);
  assert.match(page, /getPendingEntitlementBySessionId/);
  assert.match(read("app/api/stripe/repair-access/route.js"), /only be fulfilled by a verified Stripe webhook/);
});

test("one-off purchase requires verified positive GBP payment", () => {
  const valid = { id: "cs_1", mode: "payment", status: "complete", payment_status: "paid", amount_total: 500, currency: "gbp" };
  assert.equal(classifyOneOff(valid).paid, true);
  assert.equal(classifyOneOff({ ...valid, mode: "subscription" }).paid, false);
  assert.equal(classifyOneOff({ ...valid, payment_status: "unpaid" }).paid, false);
  assert.equal(classifyOneOff({ ...valid, amount_total: 0 }).paid, false);
  assert.equal(classifyOneOff({ ...valid, amount_total: 501 }).paid, false);
  assert.equal(classifyOneOff({ ...valid, currency: "usd" }).paid, false);
});

test("zero trial invoice is not revenue; positive invoices classify first and renewal", () => {
  assert.equal(classifyInvoice({ id: "in_0", status: "paid", amount_paid: 0, currency: "gbp" }).paid, false);
  assert.equal(classifyInvoice({ id: "in_fail", status: "open", amount_paid: 199, currency: "gbp" }).paid, false);
  assert.deepEqual(classifyInvoice({ id: "in_1", status: "paid", amount_paid: 199, currency: "gbp" }, 0).stage, "first_invoice_paid");
  assert.deepEqual(classifyInvoice({ id: "in_2", status: "paid", amount_paid: 199, currency: "gbp" }, 1).stage, "renewal_invoice_paid");
});

test("webhook outcomes and entitlement are idempotent", () => {
  assert.match(read("lib/billing/commercialOutcomes.server.js"), /commercialOutcomes[\s\S]*invoice_\$\{invoice\.id\}/);
  assert.match(read("lib/entitlements.server.js"), /pendingEntitlements[\s\S]*doc\(sessionId\)/);
  assert.match(read("app/api/stripe/webhook/route.js"), /constructEvent[\s\S]*markStripeEventProcessed/);
});

test("authorised internal mode centrally suppresses GA4, Pixel, CAPI and funnel writes", () => {
  assert.match(read("lib/analytics/internal.server.js"), /timingSafeEqual/);
  assert.match(read("app/api/internal-analytics/route.js"), /verifyRequestUser[\s\S]*isInternalAnalyticsUid/);
  assert.match(read("lib/analytics/ga4.js"), /__CLEARTILL_INTERNAL_ANALYTICS__/);
  assert.match(read("components/MetaPixel.jsx"), /__CLEARTILL_INTERNAL_ANALYTICS__/);
  assert.match(read("app/api/analytics/route.js"), /isInternalAnalyticsRequest/);
  assert.match(read("app/api/track/route.js"), /isInternalAnalyticsRequest/);
  assert.match(read("lib/billing/commercialOutcomes.server.js"), /!internalTest/);
});

test("forged or revoked cookies cannot enable internal mode", () => {
  const source = read("lib/analytics/internal.server.js");
  assert.match(source, /createHmac\("sha256"/);
  assert.match(source, /INTERNAL_ANALYTICS_COOKIE_VERSION/);
  assert.match(source, /Number\(payload\.exp\)/);
  assert.match(read("app/api/internal-analytics/route.js"), /maxAge: 0/);
});

test("UTM attribution is independent from suppression and first touch is immutable", () => {
  const source = read("lib/analytics/attribution.js");
  assert.match(source, /FIRST_KEY/);
  assert.match(source, /LAST_KEY/);
  assert.match(source, /if \(!first\)[\s\S]*setItem\(FIRST_KEY/);
  assert.match(source, /hasCampaignSignal\(touch\)/);
  assert.doesNotMatch(read("lib/analytics/internal.server.js"), /utm_|fbclid|location|city|ip/i);
});

test("Mixpanel emits its first product event only after analytics consent", () => {
  const consent = read("components/AnalyticsConsent.jsx");
  const constants = read("lib/analytics/constants.js");
  assert.match(consent, /grantAnalyticsConsent\(\);[\s\S]*trackEvent\("analytics_consent_granted"\)/);
  assert.match(constants, /"analytics_consent_granted"/);
  const mixpanel = read("lib/analytics/mixpanel.js");
  assert.match(mixpanel, /opt_out_tracking_by_default: !alreadyConsented/);
  assert.match(mixpanel, /https:\/\/api-eu\.mixpanel\.com/);
});

test("sensitive financial fields are rejected from analytics/attribution contracts", () => {
  assert.equal(containsSensitiveFields({ balance: 10 }), true);
  assert.equal(containsSensitiveFields({ nested: { spokenBillText: "rent" } }), true);
  assert.equal(containsSensitiveFields({ utm_source: "meta", campaign: "summer" }), false);
  assert.match(read("lib/customerProfile.server.js"), /BLOCKED_METADATA_KEY_PATTERN/);
  assert.doesNotMatch(read("lib/analytics/attribution.server.js"), /balance|payday|email|spoken/i);
});
