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
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}-${parts.find((p) => p.type === "day").value}`;
}

function addDaysIso(iso, days) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfMonth(iso) { return Number(iso.slice(8, 10)); }
function amountOf(text) { return Number(String(text).replace(/[^0-9.-]/g, "")); }

async function signIn(page) {
  const token = await mintCustomToken(uid);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__cleartillTestSignIn === "function");
  await page.evaluate((value) => window.__cleartillTestSignIn(value), token);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "How it's worked out" }).waitFor({ state: "visible", timeout: 20000 });
}

test.beforeAll(async () => {
  const { nonAdminUser } = await seedTestUsers();
  uid = nonAdminUser.uid;
  await grantTestAccess(uid, NON_ADMIN_TEST_EMAIL);
});

test.beforeEach(async () => {
  await clearUserBills(uid);
  await clearUserIncomeEvents(uid);
  await clearUserLargeCosts(uid);
  const today = todayIsoLondon();
  const payday = addDaysIso(today, 10);
  await seedDashboardState(uid, { currentBalance: 3000, payDay: dayOfMonth(payday), payAmount: 5000 });
  await seedUserBill(uid, { id: "rent", name: "Rent", amount: 900, dueDay: dayOfMonth(addDaysIso(today, 3)) });
  await seedUserBill(uid, { id: "internet", name: "Internet", amount: 50, dueDay: dayOfMonth(addDaysIso(today, 6)) });
  await seedUserIncomeEvent(uid, { id: "refund", name: "Refund", amount: 125, expectedDate: addDaysIso(today, 15) });
  await seedUserIncomeEvent(uid, { id: "bonus", name: "Bonus", amount: 1000, expectedDate: addDaysIso(today, 5) });
});

test("disclosures are exact, accessible, period-correct and mobile-safe", async ({ page }) => {
  await signIn(page);

  const heroBreakdown = page.getByRole("button", { name: "How it's worked out" });
  await expect(heroBreakdown).toHaveAttribute("aria-expanded", "false");
  await heroBreakdown.click();
  await expect(heroBreakdown).toHaveAttribute("aria-expanded", "true");

  const heroIncome = page.locator('[data-testid="hero-income"]');
  await expect(heroIncome).toContainText("£1,000");
  await heroIncome.getByRole("button").click();
  await expect(heroIncome).toContainText("Bonus");
  await expect(heroBreakdown).toHaveCount(1);
  await expect(page.locator('[data-testid="next-money-in"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="income-schedule-card"]')).toContainText("Other scheduled income");
  await page.reload();
  await heroBreakdown.click();
  await expect(heroIncome).toContainText("£1,000");

  const heroBills = page.locator('[data-testid="hero-bills"]');
  const toggle = heroBills.getByRole("button");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(heroBills).toContainText("Rent");
  await expect(heroBills).toContainText("Internet");
  const itemAmounts = await heroBills.locator(".financial-detail-row:not(.total) strong").allTextContents();
  const total = amountOf(await heroBills.locator(".financial-detail-row.total strong").textContent());
  expect(itemAmounts.reduce((sum, value) => sum + amountOf(value), 0)).toBe(total);
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  const zeroLargeCosts = page.locator('[data-testid="hero-large-costs"]');
  await expect(zeroLargeCosts.getByRole("button")).toHaveCount(0);

  const payPeriods = page.getByRole("button", { name: /Pay periods/ });
  await expect(payPeriods).toHaveAttribute("aria-expanded", "false");
  await payPeriods.click();
  await expect(payPeriods).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('[data-testid="current-pay-period"]')).toContainText("Rent");
  const nextIncome = page.locator('[data-testid="next-period-income"]');
  await nextIncome.getByRole("button").click();
  await expect(nextIncome).toContainText("Monthly pay");
  await expect(nextIncome).toContainText("Refund");

  const weeklyCosts = page.locator('[data-testid^="weekly-costs-"]').filter({ hasText: "£950" });
  await expect(weeklyCosts).toHaveCount(1);
  await weeklyCosts.getByRole("button").click();
  await expect(weeklyCosts).toContainText("Rent");
  await expect(weeklyCosts).toContainText("Internet");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "output/playwright/financial-disclosures-mobile.png", fullPage: true });
});
