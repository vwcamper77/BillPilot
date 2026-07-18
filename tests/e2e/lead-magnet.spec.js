import { expect, test } from "@playwright/test";
import { mintCustomToken, seedTestUsers } from "./setup/seedTestUsers.mjs";

const OFFER_NAME = "Before you go, work out what your balance still has to cover.";
let signedInToken;
const uiOnly = process.env.LEAD_MAGNET_UI_ONLY === "1";

test.beforeAll(async () => {
  if (uiOnly) return;
  const { nonAdminUser } = await seedTestUsers();
  signedInToken = await mintCustomToken(nonAdminUser.uid);
});

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/[^/]*tawk\.to\//, (route) => route.abort("blockedbyclient"));
  await page.route("**/api/track", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{\"ok\":true}" }));
  await page.addInitScript(() => localStorage.setItem("ct_analytics_consent", "denied"));
});

async function triggerDesktopExit(page, elapsed = 20_001) {
  await page.clock.fastForward(elapsed);
  await page.evaluate(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => query === "(pointer: fine)"
      ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} }
      : original(query);
    document.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, clientY: -1, relatedTarget: null }));
  });
}

async function installClockAndOpenLanding(page, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.clock.install();
  await page.goto("/free-cash-position-sheet");
}

test("landing page has canonical metadata, downloads, trust copy and responsive layout", async ({ page }) => {
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto("/free-cash-position-sheet");
    expect(response.ok()).toBe(true);
    await expect(page).toHaveTitle(/Free Cash-Position Spreadsheet/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.cleartill.money/free-cash-position-sheet");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Work out what your bank balance still has to cover before payday");
    await expect(page.getByText("No bank login", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download Excel worksheet" })).toHaveAttribute("href", "/downloads/cleartill-free-cash-position-sheet.xlsx");
    await expect(page.getByRole("link", { name: "Read the PDF guide" })).toHaveAttribute("href", "/guides/cleartill-bank-balance-reset-guide.pdf");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("XLSX and PDF assets are served directly with the expected content types", async ({ request }) => {
  const [xlsx, pdf] = await Promise.all([
    request.get("/downloads/cleartill-free-cash-position-sheet.xlsx"),
    request.get("/guides/cleartill-bank-balance-reset-guide.pdf"),
  ]);
  expect(xlsx.ok()).toBe(true);
  expect(xlsx.headers()["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect((await xlsx.body()).length).toBeGreaterThan(10_000);
  expect(pdf.ok()).toBe(true);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).length).toBeGreaterThan(100_000);
});

test("desktop offer requires 20 seconds and a genuine top-boundary mouse exit", async ({ page }) => {
  await installClockAndOpenLanding(page);
  await triggerDesktopExit(page, 19_000);
  await expect(page.getByRole("dialog", { name: OFFER_NAME })).toHaveCount(0);
  await page.clock.fastForward(1_100);
  await page.evaluate(() => document.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, clientY: 100, relatedTarget: null })));
  await expect(page.getByRole("dialog", { name: OFFER_NAME })).toHaveCount(0);
  await triggerDesktopExit(page, 0);
  await expect(page.getByRole("dialog", { name: OFFER_NAME })).toBeVisible();
});

test("logged-in users never see the offer", async ({ page }) => {
  test.skip(uiOnly, "Requires the dedicated E2E Firebase project configured by the standard Playwright suite.");
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__cleartillTestSignIn === "function");
  await page.evaluate((token) => window.__cleartillTestSignIn(token), signedInToken);
  await page.waitForFunction(() => document.body.textContent.includes("Know what's really left"));
  await page.clock.install();
  await page.goto("/free-cash-position-sheet");
  await triggerDesktopExit(page);
  await expect(page.getByRole("dialog", { name: OFFER_NAME })).toHaveCount(0);
});

test("excluded routes never install a visible offer", async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install();
  for (const route of ["/signin", "/dashboard", "/privacy", "/billing"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await triggerDesktopExit(page, 46_000);
    await expect(page.getByRole("dialog", { name: OFFER_NAME }), route).toHaveCount(0);
  }
});

test("dismissal is once per session and suppressed for fourteen days", async ({ page }) => {
  await installClockAndOpenLanding(page);
  await triggerDesktopExit(page);
  await expect(page.getByRole("dialog", { name: OFFER_NAME })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => localStorage.removeItem("ct_cash_position_offer_dismissed_at"));
  await page.reload();
  await triggerDesktopExit(page);
  await expect(page.getByRole("dialog", { name: OFFER_NAME })).toHaveCount(0);

  await page.evaluate(() => {
    sessionStorage.removeItem("ct_cash_position_offer_shown");
    localStorage.setItem("ct_cash_position_offer_dismissed_at", String(Date.now()));
  });
  await page.reload();
  await triggerDesktopExit(page);
  await expect(page.getByRole("dialog", { name: OFFER_NAME })).toHaveCount(0);
});

test("mobile bottom sheet needs 45 seconds and 60 percent scroll", async ({ page }) => {
  await installClockAndOpenLanding(page, 390);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.clock.fastForward(44_000);
  await expect(page.getByRole("dialog", { name: OFFER_NAME })).toHaveCount(0);
  await page.clock.fastForward(1_100);
  await expect(page.getByRole("dialog", { name: OFFER_NAME })).toBeVisible();
});

test("using the primary CTA suppresses the offer", async ({ page }) => {
  await installClockAndOpenLanding(page);
  await page.getByRole("link", { name: "Check my position free" }).click();
  await expect(page).toHaveURL(/\/start$/);
  await page.goto("/free-cash-position-sheet");
  await triggerDesktopExit(page);
  await expect(page.getByRole("dialog", { name: OFFER_NAME })).toHaveCount(0);
});

test("dialog traps focus, closes with Escape and restores focus", async ({ page }) => {
  await installClockAndOpenLanding(page);
  const trigger = page.getByRole("link", { name: "Download Excel worksheet" });
  await trigger.focus();
  await triggerDesktopExit(page);
  const dialog = page.getByRole("dialog", { name: OFFER_NAME });
  await expect(dialog.getByLabel("Email address")).toBeFocused();
  await dialog.getByRole("link", { name: "Privacy Policy" }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close free guide offer" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("email is required, marketing stays optional, delivery succeeds without consent and immediate actions appear", async ({ page }) => {
  let submission;
  await page.route("**/api/lead-magnet", async (route) => {
    submission = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await installClockAndOpenLanding(page);
  await triggerDesktopExit(page);
  const dialog = page.getByRole("dialog", { name: OFFER_NAME });
  const email = dialog.getByLabel("Email address");
  const consent = dialog.getByRole("checkbox");
  await expect(consent).not.toBeChecked();
  await dialog.getByRole("button", { name: "Send the free guide" }).click();
  expect(await email.evaluate((element) => element.validity.valueMissing)).toBe(true);
  await email.fill("reader@example.com");
  await dialog.getByRole("button", { name: "Send the free guide" }).click();
  await expect(dialog.getByText("Check your inbox. Your guide and spreadsheet link are on their way.")).toBeVisible();
  expect(submission.marketingConsent).toBe(false);
  await expect(dialog.getByRole("link", { name: "Download the spreadsheet" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Read the guide" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Check my position free" })).toBeVisible();
  await expect(dialog.getByText("Google Sheets copy unavailable")).toBeVisible();
});

test("completion is permanent and analytics requests never contain the email", async ({ page }) => {
  const analyticsBodies = [];
  await page.route("**/api/track", async (route) => {
    analyticsBodies.push(route.request().postData() || "");
    await route.fulfill({ status: 200, contentType: "application/json", body: "{\"ok\":true}" });
  });
  await page.route("**/api/lead-magnet", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{\"ok\":true}" }));
  await installClockAndOpenLanding(page);
  await triggerDesktopExit(page);
  const dialog = page.getByRole("dialog", { name: OFFER_NAME });
  await dialog.getByLabel("Email address").fill("private@example.com");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Send the free guide" }).click();
  await expect(dialog.getByRole("status")).toBeVisible();
  await page.waitForTimeout(50);
  expect(analyticsBodies.join("\n")).not.toContain("private@example.com");
  expect(analyticsBodies.join("\n")).toContain("lead_magnet_submitted");
  expect(analyticsBodies.join("\n")).toContain("lead_magnet_marketing_opt_in");
  await page.evaluate(() => sessionStorage.removeItem("ct_cash_position_offer_shown"));
  await page.reload();
  await triggerDesktopExit(page);
  await expect(page.getByRole("dialog", { name: OFFER_NAME })).toHaveCount(0);
});
