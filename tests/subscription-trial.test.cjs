const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
}

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("homepage CTAs enter the auth-first free preview", () => {
  const homepage = read("app/page.jsx");
  assert.match(homepage, /PREVIEW_HREF = "\/start"/);
  assert.match(homepage, /Check my position free/);
  assert.match(homepage, /No card required/);
  assert.match(homepage, /href="\/signin"/);
});

test("dashboard URL state remains hydration-stable", () => {
  const source = read("app/dashboard/page.jsx");
  const stateSection = between(source, "const [entryAuthMode", "const shouldUseDirectAuthEntry");
  assert.match(stateSection, /useState\(""\)/);
  assert.match(stateSection, /entryParamsReady, setEntryParamsReady\] = useState\(false\)/);
  assert.doesNotMatch(stateSection, /typeof window|window\.location/);
  const stableRender = source.indexOf("if (!entryParamsReady)");
  const trialRender = source.indexOf('if (entryIntent === "trial")', stableRender);
  assert.ok(stableRender > -1 && trialRender > stableRender);
});

test("trial route shows an email-only screen before Checkout", () => {
  const source = read("app/dashboard/page.jsx");
  const trialRender = between(source, 'if (entryIntent === "trial")', "if (!authReady)");
  const emailScreen = between(trialRender, "if (!trialCheckoutRequested)", "Opening your secure 7-day free trial");
  assert.match(emailScreen, /Email address/);
  assert.match(emailScreen, /Continue to secure checkout/);
  assert.match(emailScreen, /£0 today\. £1\.99 after 7 days, then monthly\. We&apos;ll email your secure ClearTill access link\./);
  assert.doesNotMatch(emailScreen, /password|Google|Guest session/i);
  assert.match(source, /const normalizedEmail = trialCheckoutEmail\.trim\(\)\.toLowerCase\(\)/);
  assert.match(source, /\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$/);
});

test("dashboard acquisition no longer creates an anonymous Firebase session", () => {
  const acquisitionSources = [
    "app/dashboard/page.jsx",
    "app/dashboard/HomeDashboard.jsx",
    "app/dashboard/HomeLegacy.jsx",
    "app/components/AuthJourney.jsx",
  ].map(read).join("\n");
  assert.doesNotMatch(acquisitionSources, /signInAnonymously/);
  assert.doesNotMatch(acquisitionSources, /Preparing your free pay-date forecast|private guest session|Try guest access again|Guest access is unavailable/i);
  assert.match(read("app/dashboard/page.jsx"), /href="\/signin"/);
});

test("returning sign-in does not link a persisted anonymous trial session", () => {
  const source = read("app/dashboard/page.jsx");
  const googleAuth = between(source, "async function handleGoogleSignIn", "async function handleEmailAuth");
  const emailAuth = between(source, "async function handleEmailAuth", "function completeAnonymousAccountLink");

  assert.match(googleAuth, /auth\.currentUser\?\.isAnonymous && authMode === "signup"/);
  assert.match(googleAuth, /if \(linkingAnonymousAccount\) \{[\s\S]*?linkWithPopup/);
  assert.match(googleAuth, /const credential = await signInWithPopup/);
  assert.match(emailAuth, /auth\.currentUser\?\.isAnonymous && authMode === "signup"/);
  assert.match(emailAuth, /if \(linkingAnonymousAccount\) \{[\s\S]*?linkWithCredential/);
  assert.match(emailAuth, /else if \(authMode === "signup"\)[\s\S]*?createUserWithEmailAndPassword/);
  assert.match(emailAuth, /else \{[\s\S]*?signInWithEmailAndPassword/);
  assert.match(source, /directAuthIsSignIn \? "Sign in to ClearTill"/);
});

test("validated email and anonymous ID token start Checkout exactly once", () => {
  const source = read("app/dashboard/page.jsx");
  const helper = between(source, "async function startTrialCheckoutForUser", "function handleStartTrialCheckout");
  assert.doesNotMatch(helper, /accountUser\.isAnonymous/);
  assert.match(helper, /if \(checkoutStartedRef\.current\) \{\s*return;\s*\}/);
  assert.equal((helper.match(/checkoutStartedRef\.current = true/g) || []).length, 1);
  assert.match(helper, /Authorization: `Bearer \$\{await accountUser\.getIdToken\(\)\}`/);
  assert.match(helper, /email: checkoutEmail/);
  assert.match(source, /startTrialCheckoutForUser\(auth\.currentUser, normalizedEmail\)/);
});

test("legacy card-based trial checkout is retained but cannot create new trials", () => {
  const route = read("app/api/stripe/checkout/route.js");
  const claims = read("lib/billing/trialClaims.server.js");
  assert.match(route, /legacy_trial_checkout_retired/);
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /checkout\.sessions\.create|trial_period_days/);
  assert.match(claims, /randomUUID\(\)/);
  assert.match(claims, /status: "checkout_started"/);
  assert.match(claims, /anonymousUid/);
  assert.match(claims, /expiresAt/);
});

test("Stripe-confirmed subscription creates one pending claim and grants provisional access", () => {
  const webhook = read("app/api/stripe/webhook/route.js");
  const claims = read("lib/billing/trialClaims.server.js");
  const completed = between(webhook, 'case "checkout.session.completed"', 'case "customer.subscription.created"');
  assert.match(completed, /object\.mode !== "subscription"/);
  assert.match(completed, /stripe\.subscriptions\.retrieve/);
  assert.match(completed, /createPendingTrialClaim/);
  assert.match(completed, /syncStripeSubscriptionToFirestore/);
  assert.match(claims, /session\.customer_details\?\.email/);
  assert.match(claims, /intent\.normalizedEmail\) !== confirmedEmail/);
  assert.match(claims, /intent\.checkoutSessionId !== session\.id/);
  assert.match(claims, /subscription\.metadata\?\.firebaseUid/);
  assert.match(claims, /subscription\.metadata\?\.checkoutIntentId/);
  assert.match(claims, /\["trialing", "active"\]\.includes\(subscription\.status\)/);
  assert.match(claims, /claimStatus: "pending"/);
  assert.match(claims, /trialEndAt/);
  assert.match(claims, /transaction\.create\(pendingRef, data\)/);
});

test("welcome email uses a hashed, expiring, single-use token and deduplicated outbox", () => {
  const claims = read("lib/billing/trialClaims.server.js");
  assert.match(claims, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(claims, /createHash\("sha256"\)/);
  assert.match(claims, /claimTokenHash/);
  assert.doesNotMatch(claims, /claimToken:\s*rawToken/);
  assert.match(claims, /claimExpiresAt/);
  assert.match(claims, /if \(!allowSent && \(outbox\.status === "sent" \|\| outbox\.sentAt\)\) return false/);
  assert.match(claims, /subject = "Your ClearTill trial is active"/);
  assert.match(claims, /Your 7-day free trial has started\. £0 was charged today\./);
  assert.match(claims, /Open ClearTill securely/);
  assert.doesNotMatch(between(claims, "function buildWelcomeEmail", "async function buildClaimLink"), /balance|bill amount|financial/i);
});

test("same-device claim links the email credential and preserves the anonymous UID", () => {
  const page = read("app/trial/claim/page.jsx");
  assert.match(page, /EmailAuthProvider\.credentialWithLink\(emailPayload\.email, claimRef\.current\.href\)/);
  assert.match(page, /linkWithCredential\(auth\.currentUser, emailCredential\)/);
  assert.doesNotMatch(page, /createUserWithEmailAndPassword|password/);
  const claims = read("lib/billing/trialClaims.server.js");
  assert.match(claims, /if \(anonymousUid !== authenticatedUid\)/);
  assert.match(claims, /else \{[\s\S]*?transaction\.set\(sourceSubscription/);
});

test("existing-email and different-device claims sign in passwordlessly and merge server-side", () => {
  const page = read("app/trial/claim/page.jsx");
  assert.match(page, /LINK_CONFLICT_CODES/);
  assert.match(page, /signInWithEmailLink\(auth, emailPayload\.email, claimRef\.current\.href\)/);
  assert.doesNotMatch(page, /email already registered|user-not-found/i);
  const claims = read("lib/billing/trialClaims.server.js");
  assert.match(claims, /const COPY_COLLECTIONS = \["settings", "income", "bills", "incomeEvents", "largeCosts", "reminders"\]/);
  assert.match(claims, /targetProfile = targetUserSnapshot\.exists \? targetUserSnapshot\.data\(\) : \{\}/);
  assert.match(claims, /\.\.\.sourceProfile,\s*\.\.\.targetProfile/);
  assert.match(claims, /if \(!targetSnapshot\.exists\) transaction\.set/);
  assert.match(claims, /transaction\.delete\(sourceSubscription\)/);
  assert.match(claims, /subscriptionClaimedToUid: authenticatedUid/);
});

test("protected claim derives target UID and email only from verified Firebase auth", () => {
  const route = read("app/api/trial-claim/claim/route.js");
  assert.match(route, /verifyRequestUser\(request\)/);
  assert.match(route, /authenticatedUser\.email_verified !== true/);
  assert.match(route, /authenticatedUid: authenticatedUser\.uid/);
  assert.match(route, /authenticatedEmail: authenticatedUser\.email/);
  assert.doesNotMatch(route, /body\?\.(uid|targetUid)|body\.(uid|targetUid)/);
  const claims = read("lib/billing/trialClaims.server.js");
  assert.match(claims, /initial\.email !== verifiedEmail/);
  assert.match(claims, /claim\.normalizedEmail !== verifiedEmail/);
  assert.match(claims, /claim\.claimTokenHash/);
  assert.match(claims, /claimTokenHash: null/);
});

test("claim reuse is idempotent for its owner while expired and stolen tokens are rejected", () => {
  const claims = read("lib/billing/trialClaims.server.js");
  assert.match(claims, /existing\.claimStatus === "claimed" && existing\.claimedUid === authenticatedUid/);
  assert.match(claims, /return \{[\s\S]*?alreadyClaimed: true/);
  assert.match(claims, /hashToken\(claimToken\) !== claim\.claimTokenHash/);
  assert.match(claims, /asDate\(claim\.claimExpiresAt\)[\s\S]*?< Date\.now\(\)/);
  assert.match(claims, /claim\.claimedUid === authenticatedUid/);
  assert.match(claims, /throw new TrialClaimError\("already_claimed"/);
});

test("subscription ownership and later Stripe events move to the permanent UID", () => {
  const route = read("app/api/trial-claim/claim/route.js");
  assert.match(route, /stripe\.subscriptions\.update\(result\.stripeSubscriptionId/);
  assert.match(route, /metadata: \{ firebaseUid: authenticatedUser\.uid \}/);
  assert.match(route, /stripe\.customers\.update\(result\.stripeCustomerId/);
  const claims = read("lib/billing/trialClaims.server.js");
  assert.match(claims, /migratedFromAnonymousUid: anonymousUid/);
  assert.match(claims, /audit: \{\s*anonymousUid,\s*permanentUid: authenticatedUid,\s*stripeSubscriptionId/);
});

test("trialing anonymous customers see a compact, non-blocking secure-link banner", () => {
  const source = read("app/dashboard/page.jsx");
  assert.match(source, /!billingStatusReady \? "Checking access…" : hasActiveSubscription \? "Trial active" : "Guest session"/);
  assert.match(source, /className="page-notice"[\s\S]*?Your trial is active/);
  assert.match(source, /We emailed a secure sign-in link to \{billingClaim\.maskedEmail\}[\s\S]*?You can continue setting up now/);
  assert.match(source, /Didn’t receive it\? Resend/);
  assert.match(source, /user\?\.isAnonymous && billingStatusReady && !hasActiveSubscription && !accountSecured/);
  const subscribedBanner = between(source, 'id="secure-access"', "user?.isAnonymous && billingStatusReady");
  assert.doesNotMatch(subscribedBanner, /password|Google/i);
  const resendRoute = read("app/api/trial-claim/resend/route.js");
  assert.match(resendRoute, /checkRateLimit\("trial-claim-resend"/);
  assert.match(resendRoute, /anonymousUid: authenticatedUser\.uid/);
});

test("pending claim banner keeps onboarding dominant and Continue setup focuses Step 1", () => {
  const source = read("app/dashboard/page.jsx");
  const banner = between(source, 'className="page-notice"', "user?.isAnonymous && billingStatusReady");
  assert.match(banner, /className="primary-button"[\s\S]*?onClick=\{focusBalanceSnapshotForm\}[\s\S]*?Continue setup/);
  assert.match(source, /function focusBalanceSnapshotForm\(\) \{[\s\S]*?balanceSectionRef\.current\?\.scrollIntoView[\s\S]*?balanceInputRef\.current\?\.focus\(\)/);
  assert.match(source, /\{showSetupCard \? \([\s\S]*?Step 1/);
  assert.doesNotMatch(source, /billingClaim\?\.claimStatus === "pending"[\s\S]{0,300}return \(/);
});

test("claim banner dismissal is session-only and never changes claim status", () => {
  const source = read("app/dashboard/page.jsx");
  const dismissHandler = between(source, "function handleDismissTrialClaimBanner", "async function handleManageSubscription");
  assert.match(dismissHandler, /window\.sessionStorage\.setItem/);
  assert.match(dismissHandler, /setTrialClaimBannerState/);
  assert.doesNotMatch(dismissHandler, /setBillingClaim|fetch\(|claimStatus/);
  assert.match(source, /billingClaim\?\.claimStatus === "pending"/);
  assert.match(source, /trialClaimBannerState\.dismissedId !== billingClaim\.checkoutIntentId/);
  assert.doesNotMatch(source, /claimStatus === "claimed"[\s\S]{0,200}id="secure-access"/);
});

test("trial access and subscription management remain independent of claim-banner state", () => {
  const source = read("app/dashboard/page.jsx");
  assert.match(source, /const hasActiveSubscription = subscriptionStatus === "trialing" \|\| subscriptionStatus === "active"/);
  assert.match(source, /const hasPremiumAccess = !trialEnabled \|\| Boolean\(billingEntitlement\?\.hasAccess\)/);
  assert.match(source, /billingEntitlement\?\.canManageSubscription[\s\S]*?Manage subscription/);
  assert.doesNotMatch(source, /hasPremiumAccess\s*=.*trialClaimBannerState/);
});

test("Account page reads current billing status and keeps account actions POST-only", () => {
  const source = read("app/account/page.jsx");
  assert.match(source, /fetch\("\/api\/billing\/status", \{\s*headers: \{ Authorization: `Bearer \$\{idToken\}` \}/);
  assert.doesNotMatch(source, /fetch\("\/api\/account", \{\s*headers:/);
  assert.equal((source.match(/fetch\("\/api\/account"/g) || []).length, 2);
  assert.equal((source.match(/fetch\("\/api\/account", \{\s*method: "POST"/g) || []).length, 2);
  assert.match(source, /setSubscription\(payload\.subscription \|\| null\)/);
  assert.match(source, /setEntitlement\(payload\.entitlement \|\| null\)/);
  assert.match(source, /setClaim\(payload\.claim \|\| null\)/);
  assert.match(source, /const billingReady = Boolean\(user && billingResolvedUid === user\.uid\)/);
  assert.match(source, /!billingReady \|\| billingLoading[\s\S]*?Loading billing status…/);
});

test("Account page presents a pending secure link without internal identity language", () => {
  const source = read("app/account/page.jsx");
  assert.doesNotMatch(source, /Temporary guest profile|Guest session|Verified Firebase email|>Firebase|Current-browser access|Account security pending|ClearTill entitlement|Access source|Signed in as/);
  assert.match(source, /Secure access link sent/);
  assert.match(source, /Your ClearTill trial is active and your information is available on this device/);
  assert.match(source, /We sent a secure sign-in link to:/);
  assert.match(source, /claim\?\.maskedEmail \|\| subscription\?\.customerEmail/);
  assert.match(source, /Use the link to access ClearTill on another device/);
  assert.match(source, /Resend secure link/);
  assert.match(source, /fetch\("\/api\/trial-claim\/resend"/);
  assert.match(source, /body: JSON\.stringify\(\{ checkoutIntentId: claim\.checkoutIntentId \}\)/);
});

test("Account page shows a compact trial summary and retains subscription management", () => {
  const source = read("app/account/page.jsx");
  const trialSummary = between(
    source,
    'billingReady && !billingLoading && !billingError && subscriptionStatus === "trialing"',
    'billingReady && !billingLoading && !billingError && subscriptionStatus === "active"',
  );
  assert.match(trialSummary, /7-day free trial/);
  assert.match(trialSummary, /£0 charged today/);
  assert.match(trialSummary, /£1\.99 on \{formatDate\(subscription\?\.trialEnd\)\}/);
  assert.match(trialSummary, /Then £1\.99 monthly/);
  assert.match(trialSummary, /Billing email: \{subscription\?\.customerEmail/);
  assert.match(trialSummary, /entitlement\?\.canManageSubscription[\s\S]*?<ManageSubscriptionButton/);
  assert.doesNotMatch(trialSummary, /<strong>Plan|<strong>Status|Latest invoice|Access source|account-row/);
  assert.doesNotMatch(source, /Latest invoice: Paid/);
});

test("Account page shows secured identity and a compact active subscription renewal", () => {
  const source = read("app/account/page.jsx");
  assert.match(source, /claim\?\.claimStatus === "claimed"/);
  assert.match(source, /<h2 className="account-heading">Account secured<\/h2>/);
  assert.match(source, /Signed in with \{user\.email/);
  assert.match(source, /<h2 className="account-heading">ClearTill monthly<\/h2>/);
  assert.match(source, /£1\.99 per month/);
  assert.match(source, /subscription\?\.cancelAtPeriodEnd \? "Access ends" : "Next payment"/);
  assert.match(source, /formatDate\(subscription\?\.currentPeriodEnd\)/);
  assert.match(source, /Billing email: \{subscription\?\.customerEmail/);
  assert.match(source, /entitlement\?\.canManageSubscription[\s\S]*?<ManageSubscriptionButton/);
});

test("founding-member entitlement flow stays isolated and email enumeration copy is removed", () => {
  const claims = read("lib/billing/trialClaims.server.js");
  assert.match(claims, /pendingTrialClaims/);
  assert.doesNotMatch(claims, /pendingEntitlements|FOUNDING_PLAN|FOUNDING_ACCESS/);
  const dashboard = read("app/dashboard/page.jsx");
  const claimPage = read("app/trial/claim/page.jsx");
  assert.doesNotMatch(`${dashboard}\n${claimPage}`, /This email is already registered|fetchSignInMethodsForEmail/);
  const founding = read("lib/entitlements.server.js");
  assert.match(founding, /pendingEntitlements/);
  assert.match(founding, /FOUNDING_PLAN/);
});

test("Firebase deployment config points at checked-in Firestore rules and functions", () => {
  const config = JSON.parse(read("firebase.json"));
  assert.deepEqual(config.firestore, {
    rules: "firestore.rules",
    indexes: "firestore.indexes.json",
  });
  assert.deepEqual(config.functions, { source: "functions", runtime: "nodejs22" });
});

test("Firestore rules enforce server-owned preview and access-aware financial writes", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /function isOwner\(userId\)[\s\S]*?request\.auth != null && request\.auth\.uid == userId/);
  assert.match(rules, /function canWriteFinancialData[\s\S]*?previewIsActive[\s\S]*?!previewExists/);
  assert.match(rules, /match \/users\/\{userId\}\/access\/\{documentId\}[\s\S]*?allow write: if false/);
  for (const collectionName of ["income", "incomeEvents", "bills", "largeCosts"]) {
    assert.match(rules, new RegExp(`match \\/users\\/\\{userId\\}\\/${collectionName}\\/\\{[^}]+\\} \\{[\\s\\S]*?allow write: if canWriteFinancialData\\(userId\\)`));
  }
  assert.match(rules, /subscriptionStatus in \["active", "trialing"\]/);
  assert.match(rules, /match \/stripeEvents\/\{eventId\}[\s\S]*?allow read, write: if false/);
});

test("balance saves use the authenticated UID only after auth identity is stable", () => {
  const source = read("app/dashboard/page.jsx");
  const balanceFlow = between(source, "function getAuthenticatedWriteUid", "function startBillEdit");
  assert.match(balanceFlow, /const authenticatedUid = auth\?\.currentUser\?\.uid/);
  assert.match(balanceFlow, /authStateChanging[\s\S]*?authenticatedUid !== user\.uid/);
  assert.match(balanceFlow, /return auth\.currentUser\.uid/);
  assert.equal((balanceFlow.match(/doc\(db, "users", authenticatedUid, "settings", "balance"\)/g) || []).length, 2);
  assert.match(balanceFlow, /postDashboardSettingsAction\("save_balance"/);
  assert.doesNotMatch(balanceFlow, /doc\(db, "users", user\.uid, "settings", "balance"\)/);
  assert.match(source, /beforeAuthStateChanged\(auth,[\s\S]*?setAuthStateChanging\(true\)/);
});

test("permission-denied balance failures show only customer-friendly copy", () => {
  const source = read("app/dashboard/page.jsx");
  const balanceFlow = between(source, "function getAuthenticatedWriteUid", "function startBillEdit");
  assert.match(source, /ClearTill could not save this yet\. Refresh the page and try again\./);
  assert.match(source, /error\?\.code === "permission-denied" \|\| error\?\.code === "firestore\/permission-denied"/);
  assert.match(balanceFlow, /customerSafeFirestoreError\(saveError, "Current available money could not be saved\."\)/);
  assert.doesNotMatch(balanceFlow, /saveError\.message|Missing or insufficient permissions/);
});

test("dashboard snapshot listener errors are handled and safely diagnosed", () => {
  const source = read("app/dashboard/page.jsx");
  const listeners = between(source, "const handleSnapshotError", "return () => {");
  for (const listenerName of ["bills", "income", "balance", "large-costs", "savings", "reminders", "preferences"]) {
    assert.match(listeners, new RegExp(`handleSnapshotError\\("${listenerName}"`));
  }
  assert.match(source, /safeError\(context, \{ code \}\)/);
  assert.match(source, /process\.env\.NODE_ENV !== "production"/);
  assert.match(source, /"user\.uid": userUid \|\| null/);
  assert.match(source, /"auth\.currentUser\.uid": auth\?\.currentUser\?\.uid \|\| null/);
  assert.match(source, /projectId: firebaseApp\?\.options\?\.projectId \|\| null/);
});
