// Coverage for the post-payment-auth founding-member checkout redesign.
//
// Split deliberately into two kinds of coverage:
//  - Firestore-logic tests that call lib/entitlements.server.js directly
//    (real Firestore Admin SDK against the configured project, no Stripe
//    network calls) — these run regardless of whether real Stripe test-mode
//    credentials are configured, and cover fulfilment, CLEAR100, duplicate
//    delivery, claim variations, expiry, and resend.
//  - A small number of real browser tests that need CHECKOUT_AUTH_REQUIRED
//    set to the literal string "false" for the dev server under test — they
//    skip with a clear reason if that isn't configured, rather than
//    silently no-op or mutate the environment themselves.
//
// A genuinely-paid £5 session and a real hosted-Checkout CLEAR100 run are
// NOT exercised here — see the plan's "Tests" section. STRIPE_SECRET_KEY in
// this environment is a *live* key; nothing in this suite calls Stripe's
// real checkout/payment APIs in a way that could move real money.

import { test, expect } from "@playwright/test";
import { getFirestore } from "firebase-admin/firestore";
// seedTestUsers.mjs loads .env.local as a side effect of import, and its own
// Admin SDK app initialisation is reused by lib/firebaseAdmin.js (both check
// getApps() before creating a new one) — importing both here is safe.
import {
  ADMIN_TEST_EMAIL,
  NON_ADMIN_TEST_EMAIL,
  seedTestUsers,
} from "./setup/seedTestUsers.mjs";
import {
  claimPendingEntitlement,
  createPendingEntitlementFromCheckoutSession,
  EmailMismatchError,
  EntitlementClaimedError,
  EntitlementExpiredError,
  resendAccessEmail,
} from "../../lib/entitlements.server.js";

function fixtureSession(sessionId, overrides = {}) {
  return {
    id: sessionId,
    status: "complete",
    payment_status: "paid",
    amount_total: 500,
    currency: "gbp",
    created: Math.floor(Date.now() / 1000),
    customer: `cus_${sessionId}`,
    customer_details: { email: `${sessionId}@cleartill.test` },
    metadata: { planKey: "founding_member" },
    discounts: [],
    ...overrides,
  };
}

async function getEntitlement(sessionId) {
  const snapshot = await getFirestore().collection("pendingEntitlements").doc(sessionId).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function getCustomer(uidOrPendingId) {
  const snapshot = await getFirestore().collection("customers").doc(uidOrPendingId).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function cleanupSession(sessionId) {
  const db = getFirestore();
  await Promise.all([
    db.collection("pendingEntitlements").doc(sessionId).delete(),
    db.collection("customers").doc(`pending_${sessionId}`).delete(),
    db.collection("stripeEvents").doc(sessionId).delete(),
  ]);
}

test.beforeAll(async () => {
  await seedTestUsers();
});

test.describe("Phase A — fulfilment", () => {
  test("a genuine paid session creates one pending entitlement and one paid placeholder customer", async () => {
    const sessionId = `cs_test_paid_${Date.now()}`;
    try {
      await createPendingEntitlementFromCheckoutSession(fixtureSession(sessionId));

      const entitlement = await getEntitlement(sessionId);
      expect(entitlement).toBeTruthy();
      expect(entitlement.status).toBe("pending_claim");
      expect(entitlement.isQaPurchase).toBe(false);

      const customer = await getCustomer(`pending_${sessionId}`);
      expect(customer.paymentStatus).toBe("paid");
      expect(customer.totalPaid).toBe(500);
    } finally {
      await cleanupSession(sessionId);
    }
  });

  test("a confirmed CLEAR100 zero-total session grants QA access with no revenue", async () => {
    const sessionId = `cs_test_clear100_${Date.now()}`;
    try {
      await createPendingEntitlementFromCheckoutSession(fixtureSession(sessionId, {
        payment_status: "no_payment_required",
        amount_total: 0,
        discounts: [{ promotion_code: { code: "CLEAR100" } }],
      }));

      const entitlement = await getEntitlement(sessionId);
      expect(entitlement.isQaPurchase).toBe(true);

      const customer = await getCustomer(`pending_${sessionId}`);
      expect(customer.paymentStatus).toBe("qa");
      expect(customer.totalPaid).toBe(0);
    } finally {
      await cleanupSession(sessionId);
    }
  });

  test("an unrecognised zero-total session is rejected outright, not treated as QA", async () => {
    const sessionId = `cs_test_unknown_zero_${Date.now()}`;
    try {
      await expect(createPendingEntitlementFromCheckoutSession(fixtureSession(sessionId, {
        payment_status: "no_payment_required",
        amount_total: 0,
        discounts: [],
      }))).rejects.toThrow();

      expect(await getEntitlement(sessionId)).toBeNull();
    } finally {
      await cleanupSession(sessionId);
    }
  });

  test("duplicate webhook delivery for the same session does not duplicate the entitlement or revenue", async () => {
    const sessionId = `cs_test_dup_${Date.now()}`;
    try {
      const session = fixtureSession(sessionId);
      await createPendingEntitlementFromCheckoutSession(session);
      await createPendingEntitlementFromCheckoutSession(session);
      await createPendingEntitlementFromCheckoutSession(session);

      const customer = await getCustomer(`pending_${sessionId}`);
      expect(customer.totalPaid).toBe(500); // not 1500
    } finally {
      await cleanupSession(sessionId);
    }
  });
});

test.describe("Phase B — claim", () => {
  let claimUid;
  let claimEmail;
  let otherUid;
  let otherEmail;

  test.beforeAll(async () => {
    const users = await seedTestUsers();
    claimUid = users.nonAdminUser.uid;
    claimEmail = NON_ADMIN_TEST_EMAIL;
    otherUid = users.adminUser.uid;
    otherEmail = ADMIN_TEST_EMAIL;
  });

  test("claiming with the matching email creates access and merges revenue without overwriting existing data", async () => {
    const sessionId = `cs_test_claim_${Date.now()}`;
    try {
      await createPendingEntitlementFromCheckoutSession(fixtureSession(sessionId, {
        customer_details: { email: claimEmail },
      }));

      // Pre-existing revenue on the account must survive an additive merge.
      await getFirestore().collection("customers").doc(claimUid).set({ totalPaid: 1000 }, { merge: true });

      const result = await claimPendingEntitlement({ sessionId, uid: claimUid, verifiedEmail: claimEmail });
      expect(result.alreadyClaimed).toBe(false);

      const customer = await getCustomer(claimUid);
      expect(customer.totalPaid).toBe(1500); // 1000 existing + 500 from this entitlement

      const user = (await getFirestore().collection("users").doc(claimUid).get()).data();
      expect(user.accessPlan).toBe("founding");

      expect(await getCustomer(`pending_${sessionId}`)).toBeNull();

      // Re-claiming with the same uid is idempotent, not an error.
      const again = await claimPendingEntitlement({ sessionId, uid: claimUid, verifiedEmail: claimEmail });
      expect(again.alreadyClaimed).toBe(true);
    } finally {
      await cleanupSession(sessionId);
    }
  });

  test("claiming with a different uid than the one that already claimed is rejected", async () => {
    const sessionId = `cs_test_wronguid_${Date.now()}`;
    try {
      await createPendingEntitlementFromCheckoutSession(fixtureSession(sessionId, {
        customer_details: { email: claimEmail },
      }));
      await claimPendingEntitlement({ sessionId, uid: claimUid, verifiedEmail: claimEmail });

      await expect(
        claimPendingEntitlement({ sessionId, uid: otherUid, verifiedEmail: otherEmail }),
      ).rejects.toBeInstanceOf(EntitlementClaimedError);
    } finally {
      await cleanupSession(sessionId);
    }
  });

  test("claiming with a non-matching email is rejected and leaves the entitlement pending", async () => {
    const sessionId = `cs_test_mismatch_${Date.now()}`;
    try {
      await createPendingEntitlementFromCheckoutSession(fixtureSession(sessionId, {
        customer_details: { email: claimEmail },
      }));

      await expect(
        claimPendingEntitlement({ sessionId, uid: otherUid, verifiedEmail: otherEmail }),
      ).rejects.toBeInstanceOf(EmailMismatchError);

      expect((await getEntitlement(sessionId)).status).toBe("pending_claim");
    } finally {
      await cleanupSession(sessionId);
    }
  });

  test("an expired claim window is rejected, and resend revives it without duplicating the entitlement", async () => {
    const sessionId = `cs_test_expired_${Date.now()}`;
    try {
      await createPendingEntitlementFromCheckoutSession(fixtureSession(sessionId, {
        customer_details: { email: claimEmail },
      }));

      // Force expiry directly, as if 30 days had passed.
      await getFirestore().collection("pendingEntitlements").doc(sessionId).set(
        { claimTokenExpiresAt: new Date(Date.now() - 1000) },
        { merge: true },
      );

      await expect(
        claimPendingEntitlement({ sessionId, uid: claimUid, verifiedEmail: claimEmail }),
      ).rejects.toBeInstanceOf(EntitlementExpiredError);

      await resendAccessEmail({ sessionId });

      const entitlement = await getEntitlement(sessionId);
      expect(entitlement.claimTokenExpiresAt.toDate().getTime()).toBeGreaterThan(Date.now());

      // Reviving via resend didn't create a second entitlement doc for this session.
      const result = await claimPendingEntitlement({ sessionId, uid: claimUid, verifiedEmail: claimEmail });
      expect(result.alreadyClaimed).toBe(false);
    } finally {
      await cleanupSession(sessionId);
    }
  });

  test("resend refuses once an entitlement is already claimed", async () => {
    const sessionId = `cs_test_resend_claimed_${Date.now()}`;
    try {
      await createPendingEntitlementFromCheckoutSession(fixtureSession(sessionId, {
        customer_details: { email: claimEmail },
      }));
      await claimPendingEntitlement({ sessionId, uid: claimUid, verifiedEmail: claimEmail });

      await expect(resendAccessEmail({ sessionId })).rejects.toBeInstanceOf(EntitlementClaimedError);
    } finally {
      await cleanupSession(sessionId);
    }
  });

  test("webhook-only fulfilment (no success-page visit) still lets the emailed link claim access", async () => {
    // "No success-page visit" just means nothing besides
    // createPendingEntitlementFromCheckoutSession ever ran for this session —
    // exactly what the real webhook route does. Claim must work from that
    // alone, with no other code path having touched this session.
    const sessionId = `cs_test_webhook_only_${Date.now()}`;
    try {
      await createPendingEntitlementFromCheckoutSession(fixtureSession(sessionId, {
        customer_details: { email: claimEmail },
      }));

      const result = await claimPendingEntitlement({ sessionId, uid: claimUid, verifiedEmail: claimEmail });
      expect(result.alreadyClaimed).toBe(false);
    } finally {
      await cleanupSession(sessionId);
    }
  });
});

test.describe("Browser journey", () => {
  test("account billing API rejects an unauthenticated request", async ({ request }) => {
    const response = await request.get("/api/account");
    expect(response.status()).toBe(401);
  });

  test.skip(
    process.env.CHECKOUT_AUTH_REQUIRED !== "false",
    "Requires CHECKOUT_AUTH_REQUIRED=false in .env.local to exercise the new checkout UI.",
  );

  test("a signed-out visitor reaches Stripe Checkout with no Firebase auth prompt", async ({ page }) => {
    await page.goto("/billing");
    await expect(page.getByRole("button", { name: "Continue to secure checkout" })).toBeVisible();
    await expect(page.getByText("Save your access first")).toHaveCount(0);

    await page.getByRole("button", { name: "Continue to secure checkout" }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
  });

  test("a real completed Stripe test-mode payment triggers the real webhook and creates a paid entitlement", async ({ page }) => {
    test.setTimeout(60000);

    await page.goto("/billing");
    await page.getByRole("button", { name: "Continue to secure checkout" }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });

    await page.getByRole("textbox", { name: "Email" }).fill(`real-checkout-${Date.now()}@cleartill.test`);

    // This is a real Playwright-driven browser completing a real Stripe
    // test-mode checkout as part of automated test coverage, using only
    // Stripe's public test card — never a real payment credential. Disclose
    // that honestly via the checkbox rather than skip past it. Not using
    // Link CLI (the page's suggested tool for shielding a *real* buyer's
    // real card from the agent) — irrelevant for a published test card, and
    // installing unverified third-party tooling on the page's own say-so is
    // a prompt-injection-shaped risk not worth taking here. Following the
    // instructions' own fallback instead: decline any Link auth prompt.
    // Both checkboxes sit outside Playwright's notion of the viewport, so
    // drive them via the DOM directly rather than a simulated pointer click.
    await page.getByRole("checkbox", { name: "I am an AI agent acting on behalf of someone else" })
      .evaluate((el) => el.click());
    await page.getByRole("checkbox", { name: "I am an AI agent and have followed the instructions above" })
      .evaluate((el) => el.click());

    // "Pay with card" is a quick-submit affordance for Link-saved details,
    // not an accordion expander — selecting the "Card" radio is what
    // reveals the card-number/expiry/CVC fields. A native .click() didn't
    // trigger Stripe's handler (likely bound to pointerdown/up rather than
    // a plain click event), so force a real pointer click through the
    // intercepting button overlay instead.
    await page.getByRole("radio", { name: "Card" }).click({ force: true });

    await page.locator('input[autocomplete="cc-number"], input[name="cardnumber"], input[placeholder="Card number"]').first().fill("4242424242424242");
    await page.locator('input[autocomplete="cc-exp"], input[name="exp-date"], input[placeholder="MM / YY"]').first().fill("12/34");
    await page.locator('input[autocomplete="cc-csc"], input[name="cvc"], input[placeholder="CVC"]').first().fill("123");

    const nameField = page.locator('input[autocomplete="cc-name"], input[id="billingName"]').first();
    if (await nameField.isVisible().catch(() => false)) {
      await nameField.fill("Test Buyer");
    }

    await page.getByTestId("hosted-payment-submit-button").click();

    // If Stripe offers to save/authenticate with Link after submitting,
    // decline it — per the page's own instructions for agents not using
    // Link CLI.
    const payWithoutLink = page.getByRole("button", { name: /pay without link/i });
    if (await payWithoutLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await payWithoutLink.click();
    }

    await page.waitForURL(/\/billing\/success\?session_id=/, { timeout: 30000 });
    const sessionId = new URL(page.url()).searchParams.get("session_id");
    expect(sessionId).toMatch(/^cs_test_/);

    // Real webhook delivery (via `stripe listen`) is async relative to the
    // success-page redirect — poll rather than assume it's already landed.
    let entitlement = null;
    for (let attempt = 0; attempt < 10 && !entitlement; attempt += 1) {
      entitlement = await getEntitlement(sessionId);
      if (!entitlement) await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    try {
      expect(entitlement).toBeTruthy();
      expect(entitlement.status).toBe("pending_claim");
      expect(entitlement.isQaPurchase).toBe(false);
      expect(entitlement.amountPaid).toBe(500);

      const customer = await getCustomer(`pending_${sessionId}`);
      expect(customer?.paymentStatus).toBe("paid");
    } finally {
      await cleanupSession(sessionId);
    }
  });

  test("a real completed CLEAR100 checkout triggers the real webhook and creates QA access with no revenue", async ({ page }) => {
    test.setTimeout(60000);

    await page.goto("/billing");
    await page.getByRole("button", { name: "Continue to secure checkout" }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });

    await page.getByRole("textbox", { name: "Email" }).fill(`real-clear100-${Date.now()}@cleartill.test`);

    await page.getByRole("checkbox", { name: "I am an AI agent acting on behalf of someone else" })
      .evaluate((el) => el.click());
    await page.getByRole("checkbox", { name: "I am an AI agent and have followed the instructions above" })
      .evaluate((el) => el.click());

    await page.getByPlaceholder("Add promotion code").fill("CLEAR100");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("£0.00")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("hosted-payment-submit-button").click();

    const payWithoutLink = page.getByRole("button", { name: /pay without link/i });
    if (await payWithoutLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await payWithoutLink.click();
    }

    await page.waitForURL(/\/billing\/success\?session_id=/, { timeout: 30000 });
    const sessionId = new URL(page.url()).searchParams.get("session_id");
    expect(sessionId).toMatch(/^cs_test_/);

    let entitlement = null;
    for (let attempt = 0; attempt < 10 && !entitlement; attempt += 1) {
      entitlement = await getEntitlement(sessionId);
      if (!entitlement) await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    try {
      expect(entitlement).toBeTruthy();
      expect(entitlement.status).toBe("pending_claim");
      expect(entitlement.isQaPurchase).toBe(true);
      expect(entitlement.amountPaid).toBe(0);
      expect(String(entitlement.coupon || "").toUpperCase()).toBe("CLEAR100");

      const customer = await getCustomer(`pending_${sessionId}`);
      expect(customer?.paymentStatus).toBe("qa");
      expect(customer?.totalPaid).toBe(0);
    } finally {
      await cleanupSession(sessionId);
    }
  });

  test("a claim link signs the visitor in and redirects to onboarding", async ({ page }) => {
    const testSecret = process.env.E2E_TEST_SECRET;
    test.skip(!testSecret, "Requires E2E_TEST_SECRET in .env.local.");

    const sessionId = `cs_test_browser_claim_${Date.now()}`;
    const email = `${sessionId}@cleartill.test`;

    try {
      await createPendingEntitlementFromCheckoutSession(fixtureSession(sessionId, {
        customer_details: { email },
      }));

      const linkResponse = await fetch("http://localhost:3000/api/test-only/access-link", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-e2e-test-secret": testSecret },
        body: JSON.stringify({ sessionId }),
      });
      const { signInUrl } = await linkResponse.json();
      expect(signInUrl).toContain("/access/claim");

      await page.goto(signInUrl);
      await page.waitForURL(/\/dashboard/, { timeout: 15000 });

      const entitlement = await getEntitlement(sessionId);
      expect(entitlement.status).toBe("active");
    } finally {
      await cleanupSession(sessionId);
    }
  });
});
