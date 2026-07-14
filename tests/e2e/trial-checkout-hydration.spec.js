import { test, expect } from "@playwright/test";

const trialPaths = [
  "/dashboard?intent=trial",
  "/dashboard?auth=signup&intent=trial",
];

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function anonymousIdToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  return [
    encodeJwtPart({ alg: "none", typ: "JWT" }),
    encodeJwtPart({
      aud: "cleartill-hydration-test",
      auth_time: now,
      exp: now + 3600,
      firebase: { identities: {}, sign_in_provider: "anonymous" },
      iat: now,
      iss: "https://securetoken.google.com/cleartill-hydration-test",
      sub: uid,
      user_id: uid,
    }),
    "test-signature",
  ].join(".");
}

for (const trialPath of trialPaths) {
  test(`${trialPath} hydrates and opens email-first card Checkout once`, async ({ page }) => {
    const failures = [];
    const checkoutRequests = [];
    let releaseCheckoutResponse;
    const checkoutResponseGate = new Promise((resolve) => { releaseCheckoutResponse = resolve; });
    const uid = `anonymous-${trialPaths.indexOf(trialPath) + 1}`;

    page.on("console", (message) => {
      if (message.type() === "error" && /Hydration|Minified React error #418|react\.dev\/errors\/418/i.test(message.text())) {
        failures.push(`console: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

    await page.route("https://identitytoolkit.googleapis.com/**", async (route) => {
      const request = route.request();
      const corsHeaders = {
        "access-control-allow-headers": "content-type,x-client-version,x-firebase-gmpid",
        "access-control-allow-methods": "POST,OPTIONS",
        "access-control-allow-origin": "*",
      };

      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }

      const isSignup = request.url().includes("accounts:signUp");
      const isLookup = request.url().includes("accounts:lookup");
      if (!isSignup && !isLookup) {
        await route.abort();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify(isSignup
          ? {
              expiresIn: "3600",
              idToken: anonymousIdToken(uid),
              kind: "identitytoolkit#SignupNewUserResponse",
              localId: uid,
              refreshToken: `refresh-${uid}`,
            }
          : {
              kind: "identitytoolkit#GetAccountInfoResponse",
              users: [{
                createdAt: String(Date.now()),
                lastLoginAt: String(Date.now()),
                lastRefreshAt: new Date().toISOString(),
                localId: uid,
                providerUserInfo: [],
              }],
            }),
      });
    });

    await page.route("**/api/track", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    }));

    await page.route("**/api/stripe/checkout", async (route) => {
      checkoutRequests.push(route.request());
      await checkoutResponseGate;
      const origin = new URL(route.request().url()).origin;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          url: `${origin}/billing/subscribe/cancel?mock_checkout=opened`,
        }),
      });
    });

    await page.goto(trialPath);
    await expect(page.getByRole("heading", { name: "Start your secure 7-day free trial" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByText("Guest session")).toHaveCount(0);
    await page.getByLabel("Email address").fill("  Trial.User@Example.COM  ");
    await page.getByRole("button", { name: "Continue to secure checkout" }).click();
    // The heading and disclosure are rendered atomically in the transient
    // pre-redirect state. Observe them concurrently so a fast mocked redirect
    // cannot occur between two otherwise equivalent sequential assertions.
    await Promise.all([
      expect(page.getByRole("heading", { name: "Opening your secure 7-day free trial…" })).toBeVisible(),
      expect(page.getByText("Stripe will securely collect your email and card details. £0 is charged today.")).toBeVisible(),
    ]);
    releaseCheckoutResponse();
    await expect(page.getByText("Guest session")).toHaveCount(0);
    await page.waitForURL("**/billing/subscribe/cancel?mock_checkout=opened");
    await page.waitForTimeout(250);

    expect(checkoutRequests).toHaveLength(1);
    expect(checkoutRequests[0].headers().authorization).toMatch(/^Bearer /);
    expect(checkoutRequests[0].postDataJSON().email).toBe("trial.user@example.com");
    expect(failures).toEqual([]);
  });
}
