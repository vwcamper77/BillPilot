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
  seedUserSavings,
} from "./setup/seedTestUsers.mjs";

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function signIn(page, uid) {
  const token = await mintCustomToken(uid);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__cleartillTestSignIn === "function");
  await page.evaluate((customToken) => window.__cleartillTestSignIn(customToken), token);
  await page.evaluate(() => window.localStorage.setItem("ct.setup.completedAt", new Date().toISOString()));
  await page.goto("/dashboard");
  await page.locator(".hero-daily").waitFor({ state: "visible", timeout: 20000 });
}

async function openSection(page, key, section) {
  await page.evaluate((sectionKey) => window.dispatchEvent(new CustomEvent("ct:open-section", { detail: { key: sectionKey } })), key);
  await expect(section.locator("xpath=ancestor::section[contains(@class,'collapsible-section')][1]").locator(".collapsible-section-header")).toHaveAttribute("aria-expanded", "true");
}

async function openIncomeSettings(page) {
  const action = page.getByRole("button", { name: "Update pay or income" });
  if (await action.isVisible()) {
    await action.click();
    return;
  }
  const future = page.locator(".after-income-disclosure");
  if (!await future.getAttribute("open")) await future.locator("summary").click();
  await future.getByRole("button", { name: "Manage pay and income" }).click();
}

let user;
let payday;
let incomeDate;
let costDate;
let lateIncomeDate;

test.beforeAll(async () => {
  user = (await seedTestUsers()).nonAdminUser;
  await grantTestAccess(user.uid, NON_ADMIN_TEST_EMAIL);
  const now = new Date();
  payday = Math.min(28, addDays(now, 10).getDate());
  incomeDate = iso(addDays(now, 5));
  costDate = iso(addDays(now, 7));
  lateIncomeDate = iso(addDays(now, 8));
});

test.beforeEach(async () => {
  await clearUserBills(user.uid);
  await clearUserLargeCosts(user.uid);
  await clearUserIncomeEvents(user.uid);
  await seedUserSavings(user.uid, 0);
  await seedDashboardState(user.uid, { currentBalance: 100, payDay: payday, payAmount: 1000 });
  await seedUserBill(user.uid, { amount: 1, dueDay: 5 });
});

test.afterEach(async () => {
  await clearUserLargeCosts(user.uid);
  await clearUserIncomeEvents(user.uid);
});

test("secondary income updates safe daily, graph and Large Cost chronology without refresh", async ({ page }) => {
  test.setTimeout(60000);
  await signIn(page, user.uid);

  await expect(page.locator(".hero-daily")).toContainText("£10");
  await openIncomeSettings(page);
  const editor = page.getByTestId("additional-income-editor");
  await expect(editor.getByRole("button", { name: /Add another income/ })).toBeVisible();
  await editor.getByRole("button", { name: /Add another income/ }).click();
  await editor.getByRole("button", { name: "Add income", exact: true }).click();
  await editor.getByLabel("Name").fill("Freelance payment");
  await editor.getByLabel("Amount").fill("100");
  await editor.getByLabel("First payment date").fill(incomeDate);
  await editor.getByLabel("Repeats").selectOption("one_off");
  await editor.getByLabel("Confidence").selectOption("confirmed");
  await editor.getByRole("button", { name: "Add income", exact: true }).click();

  await expect(editor).toContainText("2 active income schedules");
  await expect(page.locator(".hero-daily")).toContainText("£20");
  await page.locator(".balance-editor").getByRole("button", { name: "Close" }).click();
  const futureIncome = page.locator(".after-income-disclosure");
  if (!await futureIncome.getAttribute("open")) await futureIncome.locator("summary").click();
  await expect(futureIncome).toContainText("Freelance payment");
  await expect(futureIncome).toContainText("£100");

  const largeCosts = page.locator(".forecast-large-costs");
  await openSection(page, "largecosts", largeCosts);
  await largeCosts.getByRole("button", { name: "Add large cost" }).click();
  await largeCosts.locator("#large-cost-name").fill("Car repair");
  await largeCosts.locator("#large-cost-amount").fill("150");
  await largeCosts.locator("#large-cost-due-date").fill(costDate);
  await largeCosts.getByRole("button", { name: "Add cost" }).click();
  const card = largeCosts.getByTestId("large-cost-card").filter({ hasText: "Car repair" });
  await expect(card).toContainText("Affordable by due date");
  await expect(card).toContainText("From Freelance payment");
  await expect(card).toContainText("£100");

  await openIncomeSettings(page);
  const reopenedEditor = page.getByTestId("additional-income-editor");
  const freelanceRow = reopenedEditor.locator("li").filter({ hasText: "Freelance payment" });
  const editIncomeButton = freelanceRow.getByRole("button", { name: "Edit", exact: true });
  if (!await editIncomeButton.isVisible()) {
    await reopenedEditor.getByRole("button", { name: /Add another income/ }).click();
  }
  await editIncomeButton.click();
  await reopenedEditor.getByLabel("First payment date").fill(lateIncomeDate);
  await reopenedEditor.getByRole("button", { name: "Save changes" }).click();

  await expect(card).toContainText("Not affordable by due date — short by £50");
  await expect(page.locator(".hero-daily")).toContainText("£0");
  await page.reload();
  await openIncomeSettings(page);
  const persistedEditor = page.getByTestId("additional-income-editor");
  await expect(persistedEditor).toContainText("2 active income schedules");
  await persistedEditor.getByRole("button", { name: /Add another income/ }).click();
  await expect(persistedEditor).toContainText("Freelance payment");
  await persistedEditor.screenshot({ path: "output/playwright/additional-income-editor.png" });
  page.once("dialog", (dialog) => dialog.accept());
  await persistedEditor.locator("li").filter({ hasText: "Freelance payment" }).getByRole("button", { name: "Remove" }).click();
  await expect(persistedEditor).toContainText("1 active income schedule");
  await page.reload();
  await openIncomeSettings(page);
  await expect(page.getByTestId("additional-income-editor")).toContainText("1 active income schedule");
});
