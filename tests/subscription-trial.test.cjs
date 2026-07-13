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
  const directAuthDeclaration = source.indexOf("const shouldUseDirectAuthEntry");
  const directAuthEffect = source.indexOf("if (shouldUseDirectAuthEntry)");
  assert.ok(directAuthDeclaration > -1 && directAuthDeclaration < directAuthEffect);
  assert.match(source, /entryIntent === "trial"/);
  assert.match(source, /startTrialCheckoutForUser\(credential\.user\)/);
  assert.match(source, /billing\/subscribe\/success\?session_id=\{CHECKOUT_SESSION_ID\}/);
});

test("existing anonymous users see direct signup instead of the dashboard", () => {
  const source = read("app/dashboard/page.jsx");
  assert.match(source, /const shouldShowDirectAuth = shouldUseDirectAuthEntry && \(!user \|\| user\.isAnonymous\)/);
  assert.match(source, /if \(!user \|\| shouldShowDirectAuth\)/);
  assert.match(source, /Create your ClearTill account/);
  assert.match(source, /Continue with Google/);
  assert.match(source, /You pay £0 today, then £1\.99 after 7 days and monthly after that/);
});

test("direct-auth anonymous users do not start Firestore snapshot listeners", () => {
  const source = read("app/dashboard/page.jsx");
  const guard = source.indexOf("if (!user || !db || (shouldUseDirectAuthEntry && user.isAnonymous))");
  const firstSnapshot = source.indexOf("const unsubscribeBills = onSnapshot", guard);
  assert.ok(guard > -1 && firstSnapshot > guard);
  assert.match(source.slice(guard, firstSnapshot), /setBills\(\[\]\)/);
  assert.match(source.slice(guard, firstSnapshot), /setIncome\(null\)/);
  assert.match(source.slice(guard, firstSnapshot), /setAccount\(null\)/);
  assert.match(source, /\}, \[shouldUseDirectAuthEntry, user\]\);/);
});

test("linking Google starts trial checkout once through the guarded helper", () => {
  const source = read("app/dashboard/page.jsx");
  const googleStart = source.indexOf("async function handleGoogleSignIn");
  const googleEnd = source.indexOf("async function handleEmailAuth", googleStart);
  const googleHandler = source.slice(googleStart, googleEnd);
  const anonymousBranch = googleHandler.slice(
    googleHandler.indexOf("if (auth.currentUser?.isAnonymous)"),
    googleHandler.indexOf("const credential = await signInWithPopup"),
  );
  assert.match(googleHandler, /linkWithPopup\(auth\.currentUser, googleProvider\)/);
  assert.equal((anonymousBranch.match(/startTrialCheckoutForUser\(credential\.user\)/g) || []).length, 1);
  assert.doesNotMatch(googleHandler, /signOut\(|auth\.currentUser\.delete/);
  assert.match(source, /if \(checkoutStartedRef\.current\) \{\s*return;\s*\}/);
  assert.match(source, /checkoutStartedRef\.current = true/);
});

test("linking email starts trial checkout once through the guarded helper", () => {
  const source = read("app/dashboard/page.jsx");
  const emailStart = source.indexOf("async function handleEmailAuth");
  const emailEnd = source.indexOf("async function startTrialCheckoutForUser", emailStart);
  const emailHandler = source.slice(emailStart, emailEnd);
  assert.match(emailHandler, /linkWithCredential\(auth\.currentUser, emailCredential\)/);
  assert.equal((emailHandler.match(/startTrialCheckoutForUser\(credential\.user\)/g) || []).length, 1);
});

test("plain dashboard visits retain anonymous guest access", () => {
  const source = read("app/dashboard/page.jsx");
  const guestEffect = source.slice(
    source.indexOf("if (!authReady || user || !auth)"),
    source.indexOf("if (!shouldUseDirectAuthEntry)", source.indexOf("if (!authReady || user || !auth)")),
  );
  assert.match(guestEffect, /if \(shouldUseDirectAuthEntry\) \{\s*return;\s*\}/);
  assert.match(guestEffect, /signInAnonymously\(auth\)/);
});

test("subscription success securely confirms Stripe ownership and activates access", () => {
  const source = read("app/api/stripe/confirm-subscription/route.js");
  assert.match(source, /verifyRequestUser/);
  assert.match(source, /session\.metadata\?\.firebaseUid !== user\.uid/);
  assert.match(source, /session\.status !== "complete"/);
  assert.match(source, /syncStripeSubscriptionToFirestore/);
});
