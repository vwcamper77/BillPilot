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
} from "./setup/seedTestUsers.mjs";

let uid;
test.setTimeout(60000);

const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (iso, days) => { const date = new Date(`${iso}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const day = (iso) => Number(iso.slice(8));
const amount = (text) => Number(String(text).replace(/[^0-9.-]/g, ""));
const daysToNextMonday = (iso) => 7 - ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7);

async function signIn(page) {
  const token = await mintCustomToken(uid);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__cleartillTestSignIn === "function");
  await page.evaluate((value) => window.__cleartillTestSignIn(value), token);
  await page.evaluate(() => window.localStorage.setItem("ct.setup.completedAt", new Date().toISOString()));
  await page.goto("/dashboard");
  await page.getByTestId("four-week-forecast").waitFor({ state: "visible", timeout: 20000 });
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

test("£0.63 is spendable rather than the £800 projected balance, and four bars fit", async ({ page }) => {
  const today = todayIso();
  const payday = addDays(today, daysToNextMonday(today));
  await seedDashboardState(uid, { currentBalance: 0.63, payDay: day(payday), payAmount: 800 });
  // Keep the seeded user past onboarding without changing this week's £0.63.
  await seedUserBill(uid, { id: "future-bill", name: "Future bill", amount: 1, dueDay: day(addDays(payday, 20)) });
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);

  const chart = page.getByTestId("four-week-forecast");
  await expect(chart.getByRole("tab", { name: "Weekly spending" })).toHaveAttribute("aria-selected", "true");
  const cards = chart.getByTestId("weekly-spend-card");
  await expect(cards).toHaveCount(4);
  expect(amount(await cards.first().getByTestId("available-to-spend").textContent())).toBeCloseTo(0.63, 2);
  await expect(cards.first().getByTestId("available-to-spend")).not.toContainText("800");
  const fit = await chart.getByTestId("weekly-spend-grid").evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth + 1);

  await cards.nth(2).getByRole("button", { name: "View breakdown" }).click();
  await expect(chart.getByRole("tab", { name: "Cashflow details" })).toHaveAttribute("aria-selected", "true");
  await expect(chart.getByTestId("cashflow-details")).toHaveAttribute("data-week-index", "2");
  await page.screenshot({ path: "output/playwright/four-week-forecast-desktop.png", fullPage: true });
});

test("payday week splits before and after without moving the aligned card content", async ({ page }) => {
  const today = todayIso();
  const monday = addDays(today, daysToNextMonday(today));
  const payday = addDays(monday, 2);
  await seedDashboardState(uid, { currentBalance: 70, payDay: day(payday), payAmount: 700 });
  await seedUserBill(uid, { id: "after-pay", name: "Council Tax", amount: 70, dueDay: day(addDays(payday, 2)) });
  await signIn(page);

  const paydayCard = page.getByTestId("weekly-spend-card").filter({ has: page.getByTestId("payday-split") });
  await expect(paydayCard.getByTestId("available-before-payday")).toBeVisible();
  await expect(paydayCard.getByTestId("available-after-payday")).toBeVisible();
  const tops = await page.getByTestId("available-to-spend").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "output/playwright/four-week-forecast-payday-split.png", fullPage: true });
});

test("a negative week shows a shortfall and no positive bar", async ({ page }) => {
  const today = todayIso();
  const monday = addDays(today, daysToNextMonday(today));
  const payday = addDays(monday, 3);
  await seedDashboardState(uid, { currentBalance: 100, payDay: day(payday), payAmount: 500 });
  await seedUserBill(uid, { id: "shortfall", name: "Urgent bill", amount: 250, dueDay: day(monday) });
  await signIn(page);

  const shortCard = page.locator(".weekly-spend-card.is-short").first();
  await expect(shortCard.getByText(/£150 short/)).toBeVisible();
  await expect(shortCard.getByTestId("weekly-spend-bar")).toHaveCount(0);
  await page.screenshot({ path: "output/playwright/four-week-forecast-shortfall.png", fullPage: true });
});

for (const width of [320, 375, 390, 430]) {
  test(`four forecast cards remain usable at ${width}px`, async ({ page }) => {
    const today = todayIso();
    const payday = addDays(today, Math.max(1, daysToNextMonday(today)));
    await seedDashboardState(uid, { currentBalance: 500, payDay: day(payday), payAmount: 800 });
    await seedUserBill(uid, { id: `mobile-${width}`, name: "Mobile bill", amount: 40, dueDay: day(addDays(today, 4)) });
    await page.setViewportSize({ width, height: 844 });
    await signIn(page);

    const chart = page.getByTestId("four-week-forecast");
    await expect(chart.getByTestId("weekly-spend-card")).toHaveCount(4);
    const cards = chart.getByTestId("weekly-spend-card");
    await expect(cards.first().locator(".weekly-spend-week-label")).toContainText("WC");
    await expect(cards.nth(3).locator(".weekly-spend-week-label")).toContainText("WC");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    if (width === 390) await page.screenshot({ path: "output/playwright/four-week-forecast-390.png", fullPage: true });
  });
}
