import { expect, test } from "@playwright/test";
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
  seedUserLargeCost,
} from "./setup/seedTestUsers.mjs";

let user;

function isoAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function signIn(page) {
  const token = await mintCustomToken(user.uid);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__cleartillTestSignIn === "function");
  await page.evaluate((customToken) => window.__cleartillTestSignIn(customToken), token);
  await page.evaluate(() => window.localStorage.setItem("ct.setup.completedAt", new Date().toISOString()));
}

test.beforeAll(async () => {
  user = (await seedTestUsers()).nonAdminUser;
  await grantTestAccess(user.uid, NON_ADMIN_TEST_EMAIL);
});

test.beforeEach(async () => {
  await clearUserBills(user.uid);
  await clearUserIncomeEvents(user.uid);
  await clearUserLargeCosts(user.uid);
  await seedDashboardState(user.uid, { currentBalance: 1000, payDay: 28, payAmount: 2000 });
  await seedUserBill(user.uid, { id: "form-control-bill", name: "Form control bill", amount: 40, dueDay: 12 });
  await seedUserLargeCost(user.uid, { id: "form-control-cost", name: "Form control cost", amount: 100, dueDate: isoAfter(20) });
});

test("day selects and date fields keep native semantics on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/dashboard/bills-income");
  await expect(page.getByRole("heading", { name: "Bills & income", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const dueDay = page.getByLabel("Day of month");
  await expect(dueDay).toHaveJSProperty("tagName", "SELECT");
  await expect(dueDay.locator("option")).toHaveCount(32);
  await expect(dueDay.locator("option").nth(1)).toHaveText("1st");
  await expect(dueDay.locator("option").nth(2)).toHaveText("2nd");
  await expect(dueDay.locator("option").nth(3)).toHaveText("3rd");
  await expect(dueDay.locator("option").nth(11)).toHaveText("11th");
  await expect(dueDay.locator("option").nth(31)).toHaveText("31st");
  await dueDay.selectOption("31");
  await expect(dueDay).toHaveValue("31");
  expect(await dueDay.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

  const incomeEditor = page.getByTestId("additional-income-editor");
  await incomeEditor.getByRole("button", { name: "Add income", exact: true }).click();
  const firstPaymentDate = incomeEditor.getByLabel("First payment date");
  await expect(firstPaymentDate).toHaveAttribute("type", "date");
  await firstPaymentDate.click({ position: { x: 8, y: 20 } });
  await page.keyboard.press("Escape");
  await expect(firstPaymentDate).toBeFocused();
  expect(await firstPaymentDate.evaluate((element) => getComputedStyle(element).fontFamily)).toBe(
    await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily),
  );
  expect(await incomeEditor.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);

  await page.goto("/dashboard/large-costs-savings");
  const costCard = page.getByTestId("large-cost-card").filter({ hasText: "Form control cost" });
  await costCard.getByRole("button", { name: "Edit cost or date" }).click();
  const editDialog = page.getByRole("dialog", { name: /Edit Form control cost/ });
  const dueDate = editDialog.getByLabel("Due date");
  await expect(dueDate).toHaveAttribute("type", "date");
  await expect(dueDate).toHaveValue(isoAfter(20));
  expect(await dueDate.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
});
