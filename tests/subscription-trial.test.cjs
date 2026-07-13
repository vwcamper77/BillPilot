const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
}

test("homepage trial CTAs enter the card-first trial flow without requesting signup", () => {
  const interactiveCta = read("app/HomeTryNow.jsx");
  const homepage = read("app/page.jsx");
  assert.match(interactiveCta, /TRIAL_CHECKOUT_PATH = "\/dashboard\?intent=trial"/);
  assert.match(homepage, /TRIAL_CHECKOUT_HREF = "\/dashboard\?intent=trial"/);
  assert.doesNotMatch(`${interactiveCta}\n${homepage}`, /auth=signup/);
});

test("dashboard URL state is hydration-stable and parsed only after mount", () => {
  const source = read("app/dashboard/page.jsx");
  const stateSection = source.slice(
    source.indexOf('const [entryAuthMode'),
    source.indexOf('const [emailForm'),
  );
  assert.match(stateSection, /const \[entryAuthMode, setEntryAuthMode\] = useState\(""\)/);
  assert.match(stateSection, /const \[entryIntent, setEntryIntent\] = useState\(""\)/);
  assert.match(stateSection, /const \[entryParamsReady, setEntryParamsReady\] = useState\(false\)/);
  assert.doesNotMatch(stateSection, /typeof window|window\.location/);

  const parseEffect = source.slice(
    source.indexOf("const params = new URLSearchParams(window.location.search)"),
    source.indexOf("}, []);", source.indexOf("const params = new URLSearchParams(window.location.search)")) + 7,
  );
  assert.match(parseEffect, /setEntryAuthMode/);
  assert.match(parseEffect, /setEntryIntent\(requestedIntent\)/);
  assert.match(parseEffect, /setEntryParamsReady\(true\)/);

  const stableRender = source.indexOf("if (!entryParamsReady)");
  const trialRender = source.indexOf('if (entryIntent === "trial")', stableRender);
  assert.ok(stableRender > -1 && trialRender > stableRender);
  assert.match(source.slice(stableRender, trialRender), /Preparing your secure ClearTill session…/);
});

test("trial intent overrides legacy signup and silently starts anonymous card-first checkout", () => {
  const source = read("app/dashboard/page.jsx");
  assert.match(source, /const shouldUseDirectAuthEntry = entryIntent !== "trial"\s*&& \(entryAuthMode === "signup" \|\| entryAuthMode === "signin"\)/);
  assert.match(source, /if \(!entryParamsReady \|\| !authReady \|\| user \|\| !auth\)/);
  assert.match(source, /signInAnonymously\(auth\)/);
  assert.match(source, /entryIntent !== "trial"[\s\S]*?!entryParamsReady[\s\S]*?!authReady[\s\S]*?!user[\s\S]*?checkoutStartedRef\.current/);
  assert.match(source, /void startTrialCheckoutForUser\(user\)/);
  assert.match(source, /\}, \[authReady, entryIntent, entryParamsReady, user\]\);/);
});

test("anonymous users are accepted by the guarded checkout helper exactly once", () => {
  const source = read("app/dashboard/page.jsx");
  const helper = source.slice(
    source.indexOf("async function startTrialCheckoutForUser"),
    source.indexOf("async function handleStartTrialCheckout"),
  );
  assert.doesNotMatch(helper, /accountUser\.isAnonymous/);
  assert.match(helper, /if \(checkoutStartedRef\.current\) \{\s*return;\s*\}/);
  assert.equal((helper.match(/checkoutStartedRef\.current = true/g) || []).length, 1);
  assert.match(helper, /Authorization: `Bearer \$\{await accountUser\.getIdToken\(\)\}`/);
  assert.match(helper, /fetch\("\/api\/stripe\/checkout"/);
});

test("trial transition hides the dashboard and offers retry without falling through", () => {
  const source = read("app/dashboard/page.jsx");
  const transitionStart = source.indexOf('  if (entryIntent === "trial") {\n    return (');
  const transition = source.slice(transitionStart, source.indexOf("if (!authReady)", transitionStart));
  const normalDashboard = source.indexOf('  return (\n    <main className="dashboard-shell">', source.indexOf("if (!user || shouldShowDirectAuth)"));
  assert.ok(transitionStart > -1);
  assert.match(transition, /Opening your secure 7-day free trial…/);
  assert.match(transition, /Try opening checkout again/);
  assert.match(transition, /Return to homepage/);
  assert.doesNotMatch(transition, /Guest session|Add your current available money/);
  assert.ok(normalDashboard > source.indexOf("if (!authReady)", transitionStart));
});

test("trial transition prevents Firestore dashboard snapshot listeners", () => {
  const source = read("app/dashboard/page.jsx");
  const guard = source.indexOf('if (!entryParamsReady || !user || !db || entryIntent === "trial"');
  const firstSnapshot = source.indexOf("const unsubscribeBills = onSnapshot", guard);
  assert.ok(guard > -1 && firstSnapshot > guard);
  assert.match(source.slice(guard, firstSnapshot), /setBills\(\[\]\)/);
  assert.match(source, /\}, \[entryIntent, entryParamsReady, shouldUseDirectAuthEntry, user\]\);/);
});

test("plain dashboard visits retain normal anonymous guest access", () => {
  const source = read("app/dashboard/page.jsx");
  const anonymousEffect = source.slice(
    source.indexOf("if (!entryParamsReady || !authReady || user || !auth)"),
    source.indexOf("}, [authReady, entryParamsReady, shouldUseDirectAuthEntry, user]") + 67,
  );
  assert.match(anonymousEffect, /signInAnonymously\(auth\)/);
  assert.match(source, /Guest session/);
  assert.match(source, /Add your current available money/);
});

test("checkout route uses card collection, seven-day subscription trial, and recurring monthly price", () => {
  const source = read("app/api/stripe/checkout/route.js");
  const config = read("lib/billing/config.js");
  assert.match(source, /verifyRequestUser/);
  assert.match(source, /mode:\s*"subscription"/);
  assert.match(source, /payment_method_collection:\s*"always"/);
  assert.match(source, /trial_period_days:\s*runtime\.config\.trialLengthDays/);
  assert.match(source, /price:\s*process\.env\.STRIPE_MONTHLY_PRICE_ID/);
  assert.match(source, /successPath[\s\S]*?\{CHECKOUT_SESSION_ID\}/);
  assert.match(config, /const TRIAL_LENGTH_DAYS = 7/);
  assert.match(config, /const MONTHLY_PRICE_PENCE = 199/);
  assert.match(config, /trialLengthDays:\s*TRIAL_LENGTH_DAYS/);
  assert.match(config, /offerCopy: "£0 today\./);
  assert.match(config, /£1\.99/);
});

test("checkout lets Stripe create an emailed customer for anonymous users", () => {
  const source = read("app/api/stripe/checkout/route.js");
  assert.doesNotMatch(source, /decodedToken\.email[^|]*\)\s*\{?\s*return/);
  assert.doesNotMatch(source, /stripe\.customers\.create/);
  assert.match(source, /stripeCustomerId[\s\S]*?\{ customer: stripeCustomerId \}[\s\S]*?email[\s\S]*?\{ customer_email: email \}[\s\S]*?: \{\}/);
  assert.equal((source.match(/firebaseUid: decodedToken\.uid/g) || []).length, 2);
});

test("checkout completion stores Stripe customer identity against the Firebase UID", () => {
  const source = read("app/api/stripe/webhook/route.js");
  assert.match(source, /case "checkout\.session\.completed"/);
  assert.match(source, /const uid = object\.metadata\?\.firebaseUid/);
  assert.match(source, /object\.customer_details\?\.email/);
  assert.match(source, /upsertUserProfile\(uid/);
  assert.match(source, /syncSubscriptionState\(uid/);
});

test("anonymous success confirmation verifies Stripe ownership before granting trial access", () => {
  const activation = read("app/billing/subscribe/success/SubscriptionActivation.jsx");
  const endpoint = read("app/api/stripe/confirm-subscription/route.js");
  assert.match(activation, /if \(!active \|\| !user \|\| confirmationStartedRef\.current\) return/);
  assert.doesNotMatch(activation, /user\.isAnonymous/);
  assert.match(endpoint, /session\.metadata\?\.firebaseUid !== user\.uid/);
  assert.match(endpoint, /session\.status !== "complete" \|\| session\.mode !== "subscription"/);
  assert.match(endpoint, /syncStripeSubscriptionToFirestore/);
  assert.match(activation, /Your 7-day free trial is active/);
  assert.match(activation, /£0 was charged today\. Your first £1\.99 payment is due after seven days, then monthly unless you cancel\./);
});

test("success URL alone cannot grant entitlement without verified Stripe state", () => {
  const endpoint = read("app/api/stripe/confirm-subscription/route.js");
  const statusCheck = endpoint.indexOf('session.status !== "complete"');
  const ownershipCheck = endpoint.indexOf("session.metadata?.firebaseUid !== user.uid");
  const subscriptionCheck = endpoint.indexOf("if (!session.subscription)");
  const entitlementSync = endpoint.indexOf("await syncStripeSubscriptionToFirestore");
  assert.ok(statusCheck > -1 && ownershipCheck > statusCheck);
  assert.ok(subscriptionCheck > ownershipCheck && entitlementSync > subscriptionCheck);
});

test("post-checkout access can be opened immediately or saved by linking credentials", () => {
  const activation = read("app/billing/subscribe/success/SubscriptionActivation.jsx");
  const source = read("app/dashboard/page.jsx");
  assert.match(activation, />Open ClearTill</);
  assert.match(activation, />Save my access</);
  assert.match(source, /Save your access so you can return on another device\./);
  assert.match(source, /Continue with Google/);
  const googleStart = source.indexOf("async function handleGoogleSignIn");
  const googleEnd = source.indexOf("async function handleEmailAuth", googleStart);
  const googleHandler = source.slice(googleStart, googleEnd);
  const googleAnonymousBranch = googleHandler.slice(
    googleHandler.indexOf("if (auth.currentUser?.isAnonymous)"),
    googleHandler.indexOf("const credential = await signInWithPopup"),
  );
  assert.match(googleAnonymousBranch, /linkWithPopup\(auth\.currentUser, googleProvider\)/);
  assert.doesNotMatch(googleAnonymousBranch, /signOut\(|delete\(|signInWithPopup/);
  const emailStart = source.indexOf("async function handleEmailAuth");
  const emailEnd = source.indexOf("async function startTrialCheckoutForUser", emailStart);
  const emailHandler = source.slice(emailStart, emailEnd);
  const emailAnonymousBranch = emailHandler.slice(
    emailHandler.indexOf("if (auth.currentUser?.isAnonymous)"),
    emailHandler.indexOf("} else if", emailHandler.indexOf("if (auth.currentUser?.isAnonymous)")),
  );
  assert.match(emailAnonymousBranch, /linkWithCredential\(auth\.currentUser, emailCredential\)/);
  assert.doesNotMatch(emailAnonymousBranch, /createUserWithEmailAndPassword|signInWithEmailAndPassword|signOut\(|delete\(/);
});
