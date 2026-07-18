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

test("start is account creation only and sends both providers to onboarding", () => {
  const page = read("app/start/page.jsx");
  const auth = read("app/components/AuthJourney.jsx");
  assert.match(page, /mode="signup"/);
  assert.match(auth, /createUserWithEmailAndPassword/);
  assert.match(auth, /signInWithPopup/);
  assert.match(auth, /mode: "onboarding", step: "balance"/);
  assert.match(auth, /router\.replace\(nextAfterSignup\)/);
  assert.match(auth, /currentUser && !currentUser\.isAnonymous[\s\S]*?router\.replace\("\/dashboard"\)/);
  assert.doesNotMatch(`${page}\n${auth}`, /api\/stripe|checkout/i);
});

test("signin is separate, supports reset, and does not create accounts in signin mode", () => {
  const page = read("app/signin/page.jsx");
  const auth = read("app/components/AuthJourney.jsx");
  assert.match(page, /mode="signin"/);
  assert.match(auth, /signInWithEmailAndPassword/);
  assert.match(auth, /sendPasswordResetEmail/);
  assert.match(auth, /New to ClearTill\?/);
  assert.match(auth, /isSignup\s*\? await createUserWithEmailAndPassword[\s\S]*?: await signInWithEmailAndPassword/);
});

test("attribution query data survives the onboarding redirect", () => {
  const auth = read("app/components/AuthJourney.jsx");
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"]) {
    assert.match(auth, new RegExp(`"${key}"`));
  }
  assert.match(auth, /target\.set\(key, value\)/);
});

test("Google auth uses one click-triggered popup and has actionable Firebase errors", () => {
  const flows = [
    ["app/components/AuthJourney.jsx", "async function continueWithGoogle", "async function submitEmail"],
    ["app/billing/BillingAccessGate.jsx", "async function handleGoogleSignIn", "async function handleSubmit"],
    ["app/dashboard/page.jsx", "async function handleGoogleSignIn", "async function handleEmailAuth"],
    ["app/dashboard/HomeDashboard.jsx", "async function handleGoogleSignIn", "async function handleEmailAuth"],
    ["app/dashboard/HomeLegacy.jsx", "async function handleGoogleSignIn", "async function handleEmailAuth"],
  ];

  for (const [file, start, end] of flows) {
    const source = read(file);
    const googleHandler = between(source, start, end);
    assert.equal((googleHandler.match(/signInWithPopup\(auth, googleProvider\)/g) || []).length, 1, file);
    assert.doesNotMatch(googleHandler, /await authPersistenceReady/, file);
    assert.match(source, /onClick=\{(?:continueWithGoogle|handleGoogleSignIn)\}/, file);
  }

  const authSources = flows.map(([file]) => read(file)).join("\n");
  assert.doesNotMatch(authSources, /signInWithRedirect|getRedirectResult|__\/auth\/handler/);

  const errors = read("lib/googleAuthErrors.js");
  for (const code of ["popup-blocked", "popup-closed-by-user", "unauthorized-domain", "operation-not-allowed"]) {
    assert.match(errors, new RegExp(`auth/${code}`));
  }
  assert.match(errors, /console\.error[\s\S]*?code/);
});

test("Firebase browser config is sourced from the documented public environment variables", () => {
  const firebase = read("lib/firebase.js");
  const expected = {
    apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
    authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
    measurementId: "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID",
  };

  for (const [property, envName] of Object.entries(expected)) {
    assert.match(firebase, new RegExp(`${property}: process\\.env\\.${envName}`));
  }
});

test("pricing and mobile acquisition layout match the published offer", () => {
  const pricing = read("app/pricing/page.jsx");
  const pricingAction = read("app/pricing/PricingAction.jsx");
  const css = read("app/globals.css");
  assert.match(pricing, /£3\.99 per month/);
  assert.match(pricing, /£24\.99 per year/);
  assert.match(pricingAction, /window\.location\.assign\("\/start"\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.auth-journey-grid[\s\S]*?flex-direction: column/);
});
