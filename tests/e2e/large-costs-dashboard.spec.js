import { test, expect } from "@playwright/test";
import {
  NON_ADMIN_TEST_EMAIL,
  clearUserBills,
  clearUserLargeCosts,
  grantTestAccess,
  seedDashboardState,
  seedTestUsers,
  seedUserBill,
  seedUserSavings,
} from "./setup/seedTestUsers.mjs";

const TEST_PASSWORD = "cleartill-e2e-test-password";

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

async function openLargeCostsSection(section) {
  const wrapper = section
    .locator("xpath=ancestor::section[contains(@class,'collapsible-section')][1]")
  const toggle = wrapper.locator(".collapsible-section-header");
  await toggle.waitFor({ state: "visible" });
  await section.page().evaluate(() => {
    window.dispatchEvent(new CustomEvent("ct:open-section", { detail: { key: "largecosts" } }));
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

let billUser;
let dueDateIso;
let payDay;

test.beforeAll(async () => {
  const seeded = await seedTestUsers();
  billUser = seeded.nonAdminUser;

  const now = new Date();
  dueDateIso = formatIsoDate(addDays(now, 20));
  payDay = Math.min(28, addDays(now, 10).getDate());

  await grantTestAccess(billUser.uid, NON_ADMIN_TEST_EMAIL);
  await clearUserBills(billUser.uid);
  await clearUserLargeCosts(billUser.uid);
  await seedDashboardState(billUser.uid, { currentBalance: 140, payDay, payAmount: 2000 });
  await seedUserBill(billUser.uid, { dueDay: 5 });
  await seedUserSavings(billUser.uid, 200);
});

test.afterEach(async () => {
  await clearUserLargeCosts(billUser.uid);
  await seedUserSavings(billUser.uid, 200);
});

test("split funding, affordability, dashboard and chart react without refresh", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByPlaceholder("Email").fill(NON_ADMIN_TEST_EMAIL);
  await page.getByPlaceholder("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  const section = page.locator(".forecast-large-costs");
  await expect(section.getByRole("heading", { name: "Large Costs and affordability" })).toBeVisible();
  await openLargeCostsSection(section);
  await section.getByRole("button", { name: "Add large cost" }).click();
  await section.locator("#large-cost-name").fill("Car insurance");
  await section.locator("#large-cost-amount").fill("600");
  await section.locator("#large-cost-due-date").fill(dueDateIso);

  await section.getByRole("button", { name: "Split", exact: true }).click();
  const split = section.getByTestId("split-funding-fields").first();
  await expect(split.getByLabel("From current balance")).toHaveValue("0");
  await expect(split.getByLabel("From savings")).toHaveValue("0");
  await expect(section.getByRole("button", { name: "Add cost" })).toBeDisabled();

  await split.getByLabel("From current balance").fill("300");
  await split.getByLabel("From savings").fill("200");
  await expect(split).toContainText("Remaining to allocate £100");
  await expect(section.getByRole("button", { name: "Add cost" })).toBeDisabled();

  await split.getByLabel("From current balance").fill("400");
  await expect(split).toContainText("Amount allocated £600");
  await expect(split).toContainText("Remaining to allocate £0");
  await expect(section.getByRole("button", { name: "Add cost" })).toBeEnabled();
  await section.getByRole("button", { name: "Add cost" }).click();

  const row = section.locator("li").filter({ hasText: "Car insurance" }).last();
  await expect(row).toBeVisible();
  await expect(row).toContainText("£400 from current balance · £200 from savings");
  await expect(page.getByText("Large cost added.")).toBeVisible();
  await expect(section.locator(".large-cost-confirmation").getByTestId("affordability-plan")).toBeVisible();
  await expect(row.getByTestId("affordability-plan")).toHaveAttribute("data-state", "spread_across_pay_periods");
  await expect(row.getByTestId("affordability-plan")).toContainText("£140");
  await expect(row.getByTestId("affordability-plan")).toContainText("£260");

  const summary = section.getByTestId("large-cost-dashboard-summary");
  await expect(summary).toContainText("Protected this period£140");
  await expect(summary).toContainText("Planned from future pay£260");
  await expect(summary).toContainText("Savings being used£200");
  await expect(page.getByRole("button", { name: /Savings £0/ })).toBeVisible();

  const outflows = page.getByTestId("weekly-outflow");
  await expect(outflows.filter({ hasText: "-£140" })).toHaveCount(1);
  await expect(outflows.filter({ hasText: "-£260" })).toHaveCount(1);

  await page.reload();
  const reloadedSection = page.locator(".forecast-large-costs");
  await openLargeCostsSection(reloadedSection);
  const reloadedRow = reloadedSection.locator("li").filter({ hasText: "Car insurance" }).last();
  await expect(reloadedRow).toBeVisible();
  await reloadedRow.getByRole("button", { name: "Change funding" }).click();
  const restoredSplit = reloadedRow.getByTestId("split-funding-fields");
  await expect(restoredSplit.getByLabel("From current balance")).toHaveValue("400");
  await expect(restoredSplit.getByLabel("From savings")).toHaveValue("200");
  await reloadedRow.getByRole("button", { name: "Cancel" }).click();

  await reloadedRow.getByRole("button", { name: "Edit" }).click();
  await reloadedSection.locator("#large-cost-amount").fill("700");
  const editSplit = reloadedSection.getByTestId("split-funding-fields").first();
  await expect(reloadedSection.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await editSplit.getByLabel("From current balance").fill("500");
  await reloadedSection.getByRole("button", { name: "Save changes" }).click();
  await expect(reloadedRow).toContainText("£700");
  await expect(reloadedRow.getByTestId("affordability-plan")).toContainText("£360");
  await expect(reloadedSection.getByTestId("large-cost-dashboard-summary")).toContainText("Planned from future pay£360");

  page.once("dialog", (dialog) => dialog.accept());
  await reloadedRow.getByRole("button", { name: "Remove" }).click();
  await expect(reloadedSection.locator("li").filter({ hasText: "Car insurance" })).toHaveCount(0);
  await expect(reloadedSection.getByTestId("large-cost-dashboard-summary")).toHaveCount(0);
  await expect(page.getByTestId("weekly-outflow").filter({ hasText: /£(140|360)/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Savings £200/ })).toBeVisible();
});
