// e2e coverage for the /admin/analytics feature: access control, the
// aggregation API, event tracking, ad spend entry and the customer drawer.
//
// Requires .env.local to have ADMIN_EMAILS containing
// admin-test@cleartill.test (see tests/e2e/setup/seedTestUsers.mjs) and
// valid Firebase Admin + client credentials, since these tests exercise a
// real (dev) Firestore project via the app's own API routes.

import { test, expect } from "@playwright/test";
import {
  ADMIN_TEST_EMAIL,
  NON_ADMIN_TEST_EMAIL,
  getTestIdToken,
  mintCustomToken,
  seedSampleCustomer,
  seedTestUsers,
} from "./setup/seedTestUsers.mjs";

let adminUser;
let nonAdminUser;
let adminIdToken;
let nonAdminIdToken;

test.beforeAll(async () => {
  const seeded = await seedTestUsers();
  adminUser = seeded.adminUser;
  nonAdminUser = seeded.nonAdminUser;
  [adminIdToken, nonAdminIdToken] = await Promise.all([
    getTestIdToken(adminUser.uid),
    getTestIdToken(nonAdminUser.uid),
  ]);
  await seedSampleCustomer();
});

test.describe("API access control", () => {
  test("GET /api/admin/analytics without a token is rejected", async ({ request }) => {
    const response = await request.get("/api/admin/analytics");
    expect(response.status()).toBe(401);
  });

  test("GET /api/admin/analytics with a non-admin token is forbidden", async ({ request }) => {
    const response = await request.get("/api/admin/analytics", {
      headers: { Authorization: `Bearer ${nonAdminIdToken}` },
    });
    expect(response.status()).toBe(403);
  });

  test("GET /api/admin/analytics with the admin token returns the expected shape", async ({ request }) => {
    const response = await request.get("/api/admin/analytics?rangeDays=30", {
      headers: { Authorization: `Bearer ${adminIdToken}` },
    });
    expect(response.ok()).toBeTruthy();

    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.kpis).toBeTruthy();
    expect(Array.isArray(payload.funnel)).toBe(true);
    expect(Array.isArray(payload.adPerformance)).toBe(true);
    expect(Array.isArray(payload.customers)).toBe(true);
  });
});

test.describe("event tracking", () => {
  test("POST /api/track accepts an unauthenticated landing_page_view", async ({ request }) => {
    const response = await request.post("/api/track", {
      data: {
        eventName: "landing_page_view",
        anonymousSessionId: "e2e-track-session",
        pathname: "/",
      },
    });
    expect(response.ok()).toBeTruthy();

    const payload = await response.json();
    expect(payload.ok).toBe(true);
  });

  test("POST /api/track rejects an unknown event name", async ({ request }) => {
    const response = await request.post("/api/track", {
      data: { eventName: "not_a_real_event" },
    });
    expect(response.status()).toBe(400);
  });
});

test.describe("UI access control and rendering", () => {
  async function signInAsBrowserUser(page, uid) {
    const customToken = await mintCustomToken(uid);
    await page.goto("/");
    await page.waitForFunction(() => typeof window.__cleartillTestSignIn === "function");
    await page.evaluate((token) => window.__cleartillTestSignIn(token), customToken);
  }

  test("non-admin cannot access /admin/analytics", async ({ page }) => {
    await signInAsBrowserUser(page, nonAdminUser.uid);
    await page.goto("/admin/analytics");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  });

  test("signed-out visitor cannot access /admin/analytics", async ({ page }) => {
    await page.goto("/admin/analytics");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  });

  test("admin can access /admin/analytics and sees KPI cards and the sample customer", async ({ page }) => {
    await signInAsBrowserUser(page, adminUser.uid);
    await page.goto("/admin/analytics?rangeDays=all");

    await expect(page.getByRole("heading", { name: "ClearTill analytics" })).toBeVisible();
    await expect(page.getByText("Total signups")).toBeVisible();
    await expect(page.getByText("E2E Sample Customer")).toBeVisible();
  });

  test("admin can add ad spend and see it reflected on reload", async ({ page }) => {
    await signInAsBrowserUser(page, adminUser.uid);
    await page.goto("/admin/analytics?rangeDays=all");

    await page.getByRole("button", { name: "Add ad spend" }).click();
    await page.getByLabel("Campaign").fill("e2e_fixture");
    await page.getByLabel("Spend (£)").fill("12.50");
    await page.getByRole("button", { name: "Add spend" }).click();

    await expect(page.getByText("Ad spend recorded.")).toBeVisible();
  });

  test("clicking the sample customer opens the detail drawer with a timeline", async ({ page }) => {
    await signInAsBrowserUser(page, adminUser.uid);
    await page.goto("/admin/analytics?rangeDays=all");

    await page.getByText("E2E Sample Customer").click();
    await expect(page.getByText("Event timeline")).toBeVisible();
    await expect(page.locator(".admin-timeline").getByText("account created").first()).toBeVisible();
  });
});
