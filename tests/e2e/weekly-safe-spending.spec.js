// Reproduces the reported bug: a user with only £7/day safe to spend was
// shown big weekly figures (a growing projected bank balance) as if they were
// spendable money. Verifies, in a real browser, that "available to spend"
// never mirrors the projected closing balance, that bills/commitments are
// shown separately, and that a same-named incoming payment (e.g. "Rent")
// is never confused with an outgoing bill.

import { test, expect } from "@playwright/test";
import {
  NON_ADMIN_TEST_EMAIL,
  clearUserBills,
  clearUserIncomeEvents,
  clearUserLargeCosts,
  grantTestAccess,
  mintCustomToken,
  seedDashboardState,
  seedTestUsers,
  seedUserBill,
  seedUserIncomeEvent,
} from "./setup/seedTestUsers.mjs";

let uid;

function todayIsoLondon() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year").value;
  const month = parts.find((part) => part.type === "month").value;
  const day = parts.find((part) => part.type === "day").value;
  return `${year}-${month}-${day}`;
}

function addDaysIso(iso, days) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfMonth(iso) {
  return Number(iso.slice(8, 10));
}

function amountOf(text) {
  return Number(String(text).replace(/[^0-9.-]/g, ""));
}

async function signInAsBrowserUser(page, userUid) {
  const customToken = await mintCustomToken(userUid);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__cleartillTestSignIn === "function");
  await page.evaluate((token) => window.__cleartillTestSignIn(token), customToken);
}

async function gotoDashboardChart(page) {
  await page.goto("/dashboard");
  const chart = page.locator(".spend-curve-card");
  await chart.waitFor({ state: "visible", timeout: 20000 });
  return chart;
}

test.beforeAll(async () => {
  const { nonAdminUser } = await seedTestUsers();
  uid = nonAdminUser.uid;
  await grantTestAccess(uid, NON_ADMIN_TEST_EMAIL);
});

test.beforeEach(async () => {
  await clearUserBills(uid);
  await clearUserLargeCosts(uid);
  await clearUserIncomeEvents(uid);
});

test.describe("what you can safely spend each week", () => {
  test("a £7/day user never sees the growing projected balance labelled as available to spend", async ({ page }) => {
    const today = todayIsoLondon();
    const paydayDate = addDaysIso(today, 10); // £70 / 10 days = £7/day
    const rentIncomeDate = addDaysIso(paydayDate, 3);

    await seedDashboardState(uid, { currentBalance: 70, payDay: dayOfMonth(paydayDate), payAmount: 630 });
    // A confirmed incoming payment named "Rent" (e.g. a lodger's rent) — this
    // must add to the balance, never be confused with an outgoing Rent bill.
    await seedUserIncomeEvent(uid, { id: "rent-income", name: "Rent", amount: 400, expectedDate: rentIncomeDate });

    await signInAsBrowserUser(page, uid);
    const chart = await gotoDashboardChart(page);
    await expect(page.getByRole("heading", { name: "What you can safely spend each week" })).toBeVisible();
    await chart.screenshot({ path: "output/playwright/weekly-safe-spending-7-per-day.png" });

    // Renamed section, and the three required summary lines.
    await expect(page.locator(".curve-stat-label", { hasText: "In your account" })).toBeVisible();
    await expect(page.locator(".curve-stat-label", { hasText: "Safe to spend before payday" })).toBeVisible();
    await expect(page.locator(".curve-stat-label", { hasText: "Per day until" })).toBeVisible();
    await expect(page.locator(".spend-curve-summary")).toContainText("£70");
    await expect(page.locator(".spend-curve-summary")).toContainText("£7.00/day");

    const cards = page.locator('[data-testid="weekly-spend-card"]');
    await expect(cards).toHaveCount(4);

    // No week's "available to spend" figure may equal its own projected
    // closing balance once that balance has grown past the daily rate's
    // reach — that would mean a balance is being shown as spendable money.
    const count = await cards.count();
    for (let i = 0; i < count; i += 1) {
      const card = cards.nth(i);
      const closing = amountOf(await card.locator('[data-testid="projected-closing-balance"]').first().textContent());
      const availableEls = card.locator('[data-testid="available-to-spend"]');
      const availableCount = await availableEls.count();
      let totalAvailable = 0;
      for (let j = 0; j < availableCount; j += 1) {
        totalAvailable += amountOf(await availableEls.nth(j).textContent());
      }
      if (closing > 100) {
        expect(totalAvailable).toBeLessThan(closing);
      }
    }

    // The last week's balance has grown to £1,100 (£70 + £630 pay + £400
    // rent income) — that figure must appear ONLY as the projected closing
    // balance, never as an "available to spend" amount anywhere on the page.
    const lastCard = cards.last();
    expect(amountOf(await lastCard.locator('[data-testid="projected-closing-balance"]').textContent())).toBe(1100);
    const allAvailableText = await page.locator('[data-testid="available-to-spend"]').allTextContents();
    expect(allAvailableText.some((text) => amountOf(text) === 1100)).toBe(false);
  });
});
