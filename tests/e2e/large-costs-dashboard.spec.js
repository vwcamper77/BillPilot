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
  seedUserSavings,
} from "./setup/seedTestUsers.mjs";

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function signIn(page) {
  const customToken = await mintCustomToken(billUser.uid);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__cleartillTestSignIn === "function");
  await page.evaluate((token) => window.__cleartillTestSignIn(token), customToken);
  await page.goto("/dashboard");
}

async function openLargeCostsSection(section) {
  const wrapper = section.locator("xpath=ancestor::section[contains(@class,'collapsible-section')][1]");
  const toggle = wrapper.locator(".collapsible-section-header");
  await toggle.waitFor({ state: "visible" });
  await section.page().evaluate(() => {
    window.dispatchEvent(new CustomEvent("ct:open-section", { detail: { key: "largecosts" } }));
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function addCurrentBalanceCost(section, { name, amount, dueDate }) {
  await section.getByRole("button", { name: "Add large cost" }).click();
  await section.locator("#large-cost-name").fill(name);
  await section.locator("#large-cost-amount").fill(String(amount));
  await section.locator("#large-cost-due-date").fill(dueDate);
  await section.getByRole("button", { name: "Add cost" }).click();
  return section.getByTestId("large-cost-card").filter({ hasText: name });
}

let billUser;
let dueDateIso;
let laterDueDateIso;
let payDay;

test.beforeAll(async () => {
  const seeded = await seedTestUsers();
  billUser = seeded.nonAdminUser;

  const now = new Date();
  dueDateIso = formatIsoDate(addDays(now, 20));
  laterDueDateIso = formatIsoDate(addDays(now, 50));
  payDay = Math.min(28, addDays(now, 10).getDate());

  await grantTestAccess(billUser.uid, NON_ADMIN_TEST_EMAIL);
});

test.beforeEach(async () => {
  await clearUserBills(billUser.uid);
  await clearUserLargeCosts(billUser.uid);
  await clearUserIncomeEvents(billUser.uid);
  await seedUserSavings(billUser.uid, 600);
});

test.afterEach(async () => {
  await clearUserLargeCosts(billUser.uid);
});

test("split editor, persistence, due-date maths, hero and forecast update without refresh", async ({ page }) => {
  test.setTimeout(60000);
  await seedDashboardState(billUser.uid, { currentBalance: 140, payDay, payAmount: 300 });
  await seedUserBill(billUser.uid, { amount: 1, dueDay: 5 });
  await signIn(page);

  const payOrIncomeButton = page.getByRole("button", { name: "Update pay or income" });
  await expect(payOrIncomeButton).toBeVisible();
  await payOrIncomeButton.click();
  await expect(page.locator("#payday-amount")).toBeVisible();
  await expect(page.locator("#payday-amount")).toBeFocused();
  await page.locator(".balance-editor").getByRole("button", { name: "Close" }).click();

  const section = page.locator(".forecast-large-costs");
  await expect(section.getByRole("heading", { name: "Large Costs and affordability" })).toBeVisible();
  await openLargeCostsSection(section);
  await section.getByRole("button", { name: "Add large cost" }).click();
  await section.locator("#large-cost-name").fill("Car insurance");
  await section.locator("#large-cost-amount").fill("600");
  await section.locator("#large-cost-due-date").fill(dueDateIso);

  // Split reveals exactly two amount inputs and remains invalid while under-allocated.
  await section.getByRole("button", { name: "Split", exact: true }).click();
  const createSplit = section.getByTestId("split-funding-fields").first();
  await expect(createSplit.getByLabel("From current balance")).toBeVisible();
  await expect(createSplit.getByLabel("From savings")).toBeVisible();
  await expect(createSplit.locator("input")).toHaveCount(2);
  await expect(section.getByRole("button", { name: "Add cost" })).toBeDisabled();

  // Both explicit remaining buttons add the complete remainder and disappear at £0.
  await createSplit.getByRole("button", { name: "Put remaining £600 into current balance" }).click();
  await expect(createSplit.getByLabel("From current balance")).toHaveValue("600");
  await expect(createSplit.getByRole("button", { name: /Put remaining/ })).toHaveCount(0);
  await createSplit.getByLabel("From current balance").fill("0");
  await createSplit.getByRole("button", { name: "Put remaining £600 into savings" }).click();
  await expect(createSplit.getByLabel("From savings")).toHaveValue("600");
  await expect(createSplit.getByRole("button", { name: /Put remaining/ })).toHaveCount(0);

  // Over-allocation is rejected, then an exact £400/£200 split can be saved.
  await createSplit.getByLabel("From current balance").fill("500");
  await createSplit.getByLabel("From savings").fill("200");
  await expect(createSplit).toContainText("exceeds the total cost by £100");
  await expect(section.getByRole("button", { name: "Add cost" })).toBeDisabled();
  await createSplit.getByLabel("From current balance").fill("400");
  await expect(createSplit).toContainText("Allocated £600");
  await expect(createSplit).toContainText("Remaining £0");
  await expect(section.getByRole("button", { name: "Add cost" })).toBeEnabled();
  await section.getByRole("button", { name: "Add cost" }).click();

  const card = section.getByTestId("large-cost-card").filter({ hasText: "Car insurance" });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("affordability-plan")).toHaveAttribute("data-state", "affordable_by_due_date");
  await expect(card).toContainText("Affordable by due date");
  await expect(card).not.toContainText("Affordable this period");
  await expect(card).toContainText("Before");
  await expect(card).toContainText("£101");
  await expect(card).toContainText("£299");
  await expect(section.getByTestId("large-cost-dashboard-summary")).toContainText("1 planned cost · £600 due next · £0 funding shortfall");
  await card.screenshot({ path: "output/playwright/large-cost-card.png" });

  // The exact saved split survives a reload and is restored in the disclosure editor.
  await page.reload();
  const reloadedSection = page.locator(".forecast-large-costs");
  await openLargeCostsSection(reloadedSection);
  const reloadedCard = reloadedSection.getByTestId("large-cost-card").filter({ hasText: "Car insurance" });
  await reloadedCard.getByRole("button", { name: "Change funding" }).click();
  const editor = reloadedCard.getByTestId("funding-editor");
  const restoredSplit = editor.getByTestId("split-funding-fields");
  await expect(restoredSplit.getByLabel("From current balance")).toHaveValue("400");
  await expect(restoredSplit.getByLabel("From savings")).toHaveValue("200");
  await editor.screenshot({ path: "output/playwright/large-cost-funding-editor.png" });

  // Edit closes the funding disclosure, reveals the form and moves focus to it.
  await reloadedCard.getByRole("button", { name: "Edit cost or date" }).click();
  await expect(reloadedCard.getByTestId("funding-editor")).toHaveCount(0);
  await expect(reloadedSection.locator(".large-cost-form")).toBeVisible();
  await expect(reloadedSection.locator("#large-cost-name")).toBeFocused();

  // Moving the due date into another pay cycle recalculates immediately.
  await reloadedSection.locator("#large-cost-due-date").fill(laterDueDateIso);
  await reloadedSection.getByRole("button", { name: "Save changes" }).click();
  await expect(reloadedCard.getByTestId("affordability-plan")).toHaveAttribute("data-state", "wait_until_payday");
  await expect(reloadedCard).toContainText("You do not need to take money from your current balance yet");
  await expect(reloadedCard).toContainText("Before");
  await expect(reloadedCard).toContainText("£0");

  // Return it after payday, then move all funding to savings without refreshing.
  await reloadedCard.getByRole("button", { name: "Edit cost or date" }).click();
  await reloadedSection.locator("#large-cost-due-date").fill(dueDateIso);
  await reloadedSection.getByRole("button", { name: "Save changes" }).click();
  await expect(reloadedCard).toContainText("Affordable by due date");
  await expect(page.locator(".hero-daily")).toContainText("£3.90/day");
  await expect(page.getByTestId("weekly-outflow").filter({ hasText: "-£101" })).toHaveCount(1);
  await expect(page.getByTestId("weekly-outflow").filter({ hasText: "-£299" })).toHaveCount(1);

  await reloadedCard.getByRole("button", { name: "Change funding" }).click();
  await reloadedCard.getByTestId("funding-editor").getByRole("button", { name: "Savings", exact: true }).click();
  await reloadedCard.getByTestId("funding-editor").getByRole("button", { name: "Save" }).click();
  await expect(reloadedCard.getByTestId("funding-editor")).toHaveCount(0);
  await expect(reloadedCard).toContainText("Affordable now");
  await expect(page.locator(".hero-daily")).toContainText("£14/day");
  await expect(page.getByTestId("weekly-outflow").filter({ hasText: /-£(101|299)/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Savings £0/ })).toBeVisible();
});

test("a zero-current-period plan says Wait until payday", async ({ page }) => {
  await seedDashboardState(billUser.uid, { currentBalance: 140, payDay, payAmount: 2001 });
  await seedUserBill(billUser.uid, { amount: 1, dueDay: 5 });
  await signIn(page);
  const section = page.locator(".forecast-large-costs");
  await openLargeCostsSection(section);
  const card = await addCurrentBalanceCost(section, { name: "Greece", amount: 2000, dueDate: dueDateIso });
  await expect(card.getByTestId("affordability-plan")).toHaveAttribute("data-state", "wait_until_payday");
  await expect(card).toContainText("Wait until payday");
  await expect(card).toContainText("You do not need to take money from your current balance yet");
  await expect(card).toContainText("Before");
  await expect(card).toContainText("£0");
});

test("an insufficient plan displays the precise shortfall", async ({ page }) => {
  await seedDashboardState(billUser.uid, { currentBalance: 100, payDay, payAmount: 201 });
  await seedUserBill(billUser.uid, { amount: 1, dueDay: 5 });
  await signIn(page);
  const section = page.locator(".forecast-large-costs");
  await openLargeCostsSection(section);
  const card = await addCurrentBalanceCost(section, { name: "Boiler", amount: 600, dueDate: dueDateIso });
  await expect(card.getByTestId("affordability-plan")).toHaveAttribute("data-state", "unaffordable_by_due_date");
  await expect(card).toContainText("Not affordable by due date — short by £300");
  await expect(card).toContainText("This is not affordable");
  await expect(card).toContainText("Still to fund£300");
});
