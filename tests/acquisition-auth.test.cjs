const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
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

test("pricing and mobile acquisition layout match the published offer", () => {
  const pricing = read("app/pricing/page.jsx");
  const pricingAction = read("app/pricing/PricingAction.jsx");
  const css = read("app/globals.css");
  assert.match(pricing, /£3\.99 per month/);
  assert.match(pricing, /£24\.99 per year/);
  assert.match(pricingAction, /window\.location\.assign\("\/start"\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.auth-journey-grid[\s\S]*?flex-direction: column/);
});
