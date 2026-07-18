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

test("Balance save closes, recalculates and returns mobile focus only after success", async ({ page }) => {
  const nextIncome = addDays(londonToday(), 10);
  await seedDashboardState(uid, { currentBalance: 1200, payDay: Number(nextIncome.slice(8, 10)), payAmount: 2200 });
  await page.addInitScript(() => {
    window.__balanceScrollCalls = [];
    Element.prototype.scrollIntoView = function scrollIntoView(options) {
      window.__balanceScrollCalls.push({
        id: this.id,
        className: typeof this.className === "string" ? this.className : "",
        options,
        bodyOverflow: document.body.style.overflow,
      });
    };
  });
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");

  const position = page.locator("#current-position");
  const positionHeading = position.getByRole("heading");
  await expect(positionHeading).toBeVisible({ timeout: 20000 });
  const previousResult = await positionHeading.textContent();
  let mutationCount = 0;
  await page.route("**/api/dashboard/settings", async (route) => {
    const payload = route.request().postDataJSON();
    if (payload?.action !== "save_balance") return route.continue();
    mutationCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 120));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, action: "save_balance" }) });
  });

  const updateBalance = position.getByRole("button", { name: "Update balance" });
  await updateBalance.click();
  const dialog = page.getByRole("dialog", { name: "Update your position" });
  await dialog.locator("#account-balance").fill("2000");
  await dialog.getByRole("button", { name: "Update", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saving..." })).toBeDisabled();
  await expect(dialog).toBeHidden();
  await expect(positionHeading).not.toHaveText(previousResult);
  await expect(page.locator(".page-notice")).toContainText(/Balance updated\. .* left until your next income\./);
  await expect(updateBalance).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__balanceScrollCalls.filter((call) => call.id === "current-position").at(-1))).toMatchObject({
    id: "current-position",
    options: { block: "start", behavior: "auto" },
    bodyOverflow: "",
  });
  expect(mutationCount).toBe(1);

  await page.unroute("**/api/dashboard/settings");
  await page.evaluate(() => { window.__balanceScrollCalls = []; });
  mutationCount = 0;
  await page.route("**/api/dashboard/settings", async (route) => {
    const payload = route.request().postDataJSON();
    if (payload?.action !== "save_balance") return route.continue();
    mutationCount += 1;
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Test balance failure" }) });
  });

  await updateBalance.click();
  await dialog.locator("#account-balance").fill("987");
  await dialog.getByRole("button", { name: "Update", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#account-balance")).toHaveValue("987");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(page.getByText(/^Balance updated\./)).toHaveCount(0);
  expect(await page.evaluate(() => window.__balanceScrollCalls.some((call) => call.id === "current-position"))).toBe(false);
  expect(mutationCount).toBe(1);
});

test("Bills and income uses compact groups, accessible tabs and drawer editing", async ({ page }) => {
  const nextIncome = addDays(londonToday(), 10);
  await seedDashboardState(uid, { currentBalance: 1200, payDay: Number(nextIncome.slice(8, 10)), payAmount: 2200 });
  await seedUserBill(uid, { id: "runway-phone", name: "Mobile", amount: 28, dueDay: 5 });
  await signIn(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard/bills-income");
  await expect(page.getByRole("heading", { name: "Bills & income", exact: true })).toBeVisible({ timeout: 20000 });

  const header = page.locator(".bills-income-header");
  const addBill = header.getByRole("button", { name: "Add bill" });
  const addIncome = header.getByRole("button", { name: "Add income" });
  await expect(addBill).toHaveClass(/primary-button/);
  await expect(addIncome).toHaveClass(/secondary-button/);
  await expect(page.getByRole("tab", { name: /Bills 2/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".compact-bill-row")).toHaveCount(2);
  await expect(page.locator(".compact-bill-grid-urgent .compact-bill-row")).toHaveCount(1);
  await expect(page.getByText(/Page 1 of/i)).toHaveCount(0);
  await expect(page.locator(".compact-bill-row").first().getByRole("button", { name: "Mark paid" })).toBeVisible();
  expect(await page.locator(".compact-bill-grid").last().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);

  const editButton = page.locator(".compact-bill-row").first().getByRole("button", { name: "Edit" });
  await editButton.focus();
  await editButton.click();
  await expect(page.getByRole("dialog", { name: "Edit bill" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Edit bill" })).toBeHidden();
  await expect(editButton).toBeFocused();

  await page.locator(".compact-bill-row").first().locator("summary").click();
  await expect(page.locator(".compact-bill-row").first().getByRole("button", { name: "Remove bill" })).toBeVisible();

  await addBill.click();
  await expect(page.locator("form.chat-form textarea")).toBeFocused();

  await page.evaluate(() => {
    const section = document.querySelector("#income-section");
    const scrollIntoView = section.scrollIntoView.bind(section);
    window.__incomeScrollBehaviors = [];
    section.scrollIntoView = (options) => {
      window.__incomeScrollBehaviors.push(options?.behavior);
      scrollIntoView(options);
    };
  });

  await addIncome.click();
  await expect(page.getByRole("tab", { name: /Income/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#income-pattern")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Income", exact: true })).toBeInViewport();
  await expect.poll(() => page.evaluate(() => window.__incomeScrollBehaviors.at(-1))).toBe("smooth");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await addIncome.click();
  await expect(page.locator("#income-pattern")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Income", exact: true })).toBeInViewport();
  await expect.poll(() => page.evaluate(() => window.__incomeScrollBehaviors.at(-1))).toBe("instant");
  await page.getByRole("tab", { name: /Bills/ }).click();
  expect(await page.locator(".compact-bill-grid").last().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
