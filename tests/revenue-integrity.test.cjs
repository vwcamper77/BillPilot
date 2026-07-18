const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { decideEntitlement } = require("../lib/entitlementRules.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("all valid server-side access types suppress checkout", () => {
  const cases = [
    [{ isAuthenticated: true, subscriptionStatus: "active" }, "active_subscription"],
    [{ isAuthenticated: true, subscriptionStatus: "trialing", trialActive: true }, "active_trial"],
    [{ isAuthenticated: true, canonicalActive: true, canonicalKind: "founding_member" }, "founding_member"],
    [{ isAuthenticated: true, canonicalActive: true, canonicalKind: "manually_granted" }, "manually_granted"],
    [{ isAuthenticated: true, legacyActive: true, legacyKind: "legacy_paid" }, "legacy_paid"],
    [{ isAuthenticated: true, isAdminOrTestBypass: true }, "admin_test"],
  ];
  for (const [input, accessType] of cases) {
    const state = decideEntitlement(input);
    assert.equal(state.hasAccess, true);
    assert.equal(state.accessType, accessType);
    assert.equal(state.preventsDuplicateCheckout, true);
  }
});

test("no entitlement has no access and permits one trial offer", () => {
  const state = decideEntitlement({ isAuthenticated: true, subscriptionStatus: "none" });
  assert.equal(state.hasAccess, false);
  assert.equal(state.preventsDuplicateCheckout, false);
  const dashboard = read("app/dashboard/page.jsx");
  assert.equal((dashboard.match(/\{shouldShowTrialOffer \? \(/g) || []).length, 1);
  assert.match(dashboard, /billingStatusReady[\s\S]*?!hasPremiumAccess[\s\S]*?billingEntitlement\?\.reason === "no_entitlement"/);
});

test("pending payment is distinct and blocks duplicate checkout", () => {
  for (const status of ["incomplete", "past_due", "unpaid", "paused"]) {
    const state = decideEntitlement({ isAuthenticated: true, subscriptionStatus: status });
    assert.equal(state.hasAccess, false);
    assert.equal(state.paymentPending, true);
    assert.equal(state.preventsDuplicateCheckout, true);
    assert.match(state.reason, /^payment_/);
  }
});

test("expired trials and access records never fall through to a new-user trial state", () => {
  const expiredTrial = decideEntitlement({
    isAuthenticated: true,
    subscriptionStatus: "trialing",
    trialActive: false,
    trialExpired: true,
  });
  assert.equal(expiredTrial.hasAccess, false);
  assert.equal(expiredTrial.reason, "trial_expired");
  const resolver = read("lib/entitlementResolver.server.js");
  assert.match(resolver, /entitlement_expired/);
  assert.match(read("app/dashboard/page.jsx"), /expired\|cancelled\|refunded\|revoked/);
});

test("checkout redirect cannot grant access", () => {
  const dashboard = read("app/dashboard/page.jsx");
  const confirmation = read("app/api/stripe/confirm-subscription/route.js");
  const successStatus = read("app/billing/success/AccessStatus.jsx");
  const accessClaim = read("app/api/access/claim/route.js");
  assert.match(dashboard, /waiting for Stripe's signed confirmation before activating access/);
  assert.doesNotMatch(dashboard, /checkout === "success"[\s\S]{0,250}trial has started/);
  assert.match(confirmation, /resolveEntitlementForUid/);
  assert.doesNotMatch(successStatus, /fetch\("\/api\/access\/claim"|setDoc|claimPendingEntitlement/);
  assert.match(accessClaim, /if \(!sessionId \|\| !claimToken\)/);
  assert.match(accessClaim, /hashClaimToken\(claimToken\) !== activeTokenHash/);
});

test("webhooks persist idempotent success and failure without duplicate email", () => {
  const webhook = read("app/api/stripe/webhook/route.js");
  const store = read("lib/billing/store.js");
  const foundingEmail = read("lib/entitlements.server.js");
  const trialEmail = read("lib/billing/trialClaims.server.js");
  assert.match(webhook, /constructEvent[\s\S]*markStripeEventProcessed[\s\S]*completeStripeEvent/);
  assert.match(webhook, /failStripeEvent/);
  assert.match(store, /processingStatus: "succeeded"/);
  assert.match(store, /processingStatus: "failed"/);
  assert.match(store, /if \(existing\.processingStatus === "succeeded"\) return false/);
  assert.match(foundingEmail, /activeSendId/);
  assert.match(foundingEmail, /outbox\.status === "sent"/);
  assert.match(trialEmail, /activeSendId/);
  assert.match(trialEmail, /outbox\.status === "sent"/);
  assert.match(read("lib/billing/commercialOutcomes.server.js"), /transaction\.get\(outcomeRef\)[\s\S]*outcome\.exists/);
});

test("Stripe metadata provisions UID and missing UID is visible", () => {
  const webhook = read("app/api/stripe/webhook/route.js");
  assert.match(webhook, /metadata\?\.firebaseUid/);
  assert.match(webhook, /metadata: \{ firebaseUid: uid \}/);
  assert.match(webhook, /reconciliationWarning: "missing_firebase_uid"/);
  assert.match(read("scripts/reconcile-stripe-entitlements.mjs"), /firebase_uid_missing/);
});

test("homepage dashboard and billing portal remain separate", () => {
  const home = read("components/HomeAuthLink.jsx");
  const account = read("app/account/ManageSubscriptionButton.jsx");
  assert.match(home, /href="\/dashboard">Dashboard/);
  assert.doesNotMatch(home, /stripe\/portal/);
  assert.match(account, /api\/stripe\/portal/);
});

test("signed-in refreshes enter the modular dashboard before legacy billing resolves", () => {
  const dashboard = read("app/dashboard/page.jsx");
  assert.match(
    dashboard,
    /if \(user && !user\.isAnonymous\) \{\s*return <HomeDashboard \/>;\s*\}/,
  );
  assert.doesNotMatch(
    dashboard,
    /if \(user && !user\.isAnonymous && billingStatusReady\)/,
  );
  assert.match(dashboard, /if \(user && !user\.isAnonymous\) \{[\s\S]*?setBillingStatusReady\(true\);[\s\S]*?return undefined;/);
  assert.match(dashboard, /entryIntent === "trial" \|\| !user\.isAnonymous/);
});

test("Firestore quota exhaustion is exposed as a temporary outage", () => {
  const accessRoute = read("app/api/access/route.js");
  const dashboard = read("app/dashboard/HomeDashboard.jsx");
  assert.match(accessRoute, /isFirestoreQuotaError\(error\)/);
  assert.match(accessRoute, /state: "service_unavailable"/);
  assert.match(accessRoute, /status: 503/);
  assert.match(accessRoute, /"Retry-After": "300"/);
  assert.match(dashboard, /accessCheck\.state === "service_unavailable"/);
  assert.match(dashboard, /Your sign-in worked, but we cannot load account data right now/);
});

test("balance update recalculates, announces, focuses and highlights the result", () => {
  const dashboard = read("app/dashboard/page.jsx");
  assert.match(dashboard, /postDashboardSettingsAction\("save_balance"/);
  assert.match(dashboard, /Balance updated from/);
  assert.match(dashboard, /Your shortfall reduced by/);
  assert.match(dashboard, /Your safe-to-spend amount increased by/);
  assert.match(dashboard, /primaryResultRef\.current\?\.scrollIntoView/);
  assert.match(dashboard, /aria-live="polite"/);
  assert.match(dashboard, /primary-result-highlight/);
});

test("balance entry is not reselected while the user is typing", () => {
  const editor = read("app/dashboard/components/BalanceEditor.jsx");
  const legacy = read("app/dashboard/HomeLegacy.jsx");
  const dashboard = read("app/dashboard/page.jsx");

  for (const source of [editor, legacy, dashboard]) {
    assert.match(source, /id="account-balance"[\s\S]*?autoComplete="off"/);
  }
  assert.doesNotMatch(editor, /handleBalanceInputFocus|onClick=\{handleBalanceInputFocus\}|onFocus=\{handleBalanceInputFocus\}/);
  assert.doesNotMatch(legacy, /handleBalanceInputFocus|onClick=\{handleBalanceInputFocus\}|onFocus=\{handleBalanceInputFocus\}/);
  assert.doesNotMatch(editor, /setTimeout\([\s\S]{0,120}balanceInputRef\.current/);
  assert.doesNotMatch(legacy, /setTimeout\([\s\S]{0,120}balanceInputRef\.current/);
  assert.doesNotMatch(dashboard, /setTimeout\([\s\S]{0,120}balanceInputRef\.current/);
});

test("admin includes paid unclaimed founding members and reconciliation status", () => {
  const admin = read("app/api/admin/analytics/route.js");
  assert.match(admin, /pendingEntitlementsSnapshot/);
  assert.match(admin, /customerIndexByUid/);
  assert.match(admin, /paid_access_not_claimed_no_firebase_uid/);
  assert.match(admin, /emailNotificationStatus/);
  assert.match(read("app/admin/analytics/CustomerTable.jsx"), /Payment email[\s\S]*Firebase UID[\s\S]*Warning/);
});

test("trial claim migrates the admin customer record to the permanent Firebase UID", () => {
  const claim = read("lib/billing/trialClaims.server.js");
  assert.match(claim, /sourceCustomer[\s\S]*targetCustomer/);
  assert.match(claim, /transaction\.delete\(sourceCustomer\)/);
  assert.match(claim, /authenticatedEmail: verifiedEmail/);
});

test("mobile dashboard has compact two-column figures and overflow protection", () => {
  const css = read("app/globals.css");
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.stat-chip-row/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /overflow-x: clip/);
});
