import { expect, test } from "@playwright/test";
import {
  NON_ADMIN_TEST_EMAIL,
  clearUserBills,
  clearUserIncomeEvents,
  clearUserLargeCosts,
  clearUserPrimaryIncome,
  grantTestAccess,
  mintCustomToken,
  seedDashboardState,
  seedTestUsers,
  seedUserBill,
} from "./setup/seedTestUsers.mjs";

let uid;

function londonToday() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}-${parts.find((part) => part.type === "day").value}`;
}

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function signIn(page) {
  const token = await mintCustomToken(uid);
  await page.addInitScript(() => localStorage.setItem("ct.setup.completedAt", new Date().toISOString()));
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__cleartillTestSignIn === "function");
  await page.evaluate((customToken) => window.__cleartillTestSignIn(customToken), token);
}

test.beforeAll(async () => {
  const users = await seedTestUsers();
  uid = users.nonAdminUser.uid;
  await grantTestAccess(uid, NON_ADMIN_TEST_EMAIL);
});

test.beforeEach(async () => {
  await clearUserBills(uid);
  await clearUserIncomeEvents(uid);
  await clearUserLargeCosts(uid);
  await clearUserPrimaryIncome(uid);
  await seedUserBill(uid, { id: "runway-rent", name: "Rent", amount: 450, dueDay: 20 });
});

test("Overview renders six rows, routes and focus-safe drawers at desktop and mobile widths", async ({ page }) => {
  const nextIncome = addDays(londonToday(), 10);
  await seedDashboardState(uid, { currentBalance: 1200, payDay: Number(nextIncome.slice(8, 10)), payAmount: 2200 });
  await signIn(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /left until your next income/i })).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".money-runway-row")).toHaveCount(6);
  await expect(page.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const testSpend = page.getByRole("button", { name: "Test a spend" });
  await testSpend.focus();
  await testSpend.click();
  await expect(page.getByRole("dialog", { name: "Test a spend" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Test a spend" })).toBeHidden();
  await expect(testSpend).toBeFocused();

  await page.locator(".money-runway-row").first().click();
  await expect(page.getByRole("dialog", { name: /This week:/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Bills & income" }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/bills-income$/);
  await expect(page.getByRole("heading", { name: "Bills & income", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Household utilities tracker", exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Large costs & savings" }).click();
  await expect(page).toHaveURL(/\/dashboard\/large-costs-savings$/);
  await expect(page.getByRole("heading", { name: "Large costs & savings", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Recent reminders" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Household utilities tracker", exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.locator(".money-runway-row")).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("Overview states that no upcoming income is confirmed", async ({ page }) => {
  await seedDashboardState(uid, { currentBalance: 600 });
  await signIn(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "No upcoming income confirmed" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("link", { name: "Manage income" })).toHaveAttribute("href", "/dashboard/bills-income");
});
