import { test, expect } from "@playwright/test";
import {
  NON_ADMIN_TEST_EMAIL,
  clearUserBills,
  clearUserLargeCosts,
  grantTestAccess,
  seedDashboardState,
  seedTestUsers,
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

let billUser;
let dueDateIso;
let payDay;

test.beforeAll(async () => {
  const seeded = await seedTestUsers();
  billUser = seeded.nonAdminUser;

  const now = new Date();
  dueDateIso = formatIsoDate(addDays(now, 3));
  payDay = Math.min(28, addDays(now, 10).getDate());

  await grantTestAccess(billUser.uid, NON_ADMIN_TEST_EMAIL);
  await clearUserBills(billUser.uid);
  await clearUserLargeCosts(billUser.uid);
  await seedDashboardState(billUser.uid, { currentBalance: 1000, payDay, payAmount: 2000 });
});

test("large costs update immediately on the dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByPlaceholder("Email").fill(NON_ADMIN_TEST_EMAIL);
  await page.getByPlaceholder("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  const section = page.locator(".forecast-large-costs");
  const statChips = page.locator(".stat-chip-row");
  await expect(section.getByRole("heading", { name: "Large costs before payday" })).toBeVisible();

  await section.getByRole("button", { name: "Add large cost" }).click();
  await section.locator("#large-cost-name").fill("Car insurance");
  await section.locator("#large-cost-amount").fill("600");
  await section.locator("#large-cost-saved").fill("100");
  await section.locator("#large-cost-due-date").fill(dueDateIso);
  await section.getByRole("button", { name: "Save" }).click();

  const row = section.locator("li").filter({ hasText: "Car insurance" }).last();
  await expect(row).toBeVisible();
  await expect(row).toContainText("£600");
  await expect(page.getByText("Large cost added.")).toBeVisible();

  await row.getByRole("button", { name: "Edit" }).click();
  await section.locator("#large-cost-amount").fill("650");
  await section.getByRole("button", { name: "Save changes" }).click();
  await expect(row).toContainText("£650");
  await expect(page.getByText("Large cost updated.")).toBeVisible();

  await row.getByRole("button", { name: "Choose funding" }).click();
  await row.getByRole("button", { name: "Split" }).click();
  await row.locator('input[id^="funding-savings-"]').fill("250");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("£400 hits current account");
  await expect(page.getByText("Large cost funding updated.")).toBeVisible();
  await expect(statChips).toContainText(/-£400\s+big costs before payday/);

  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(section.locator("li").filter({ hasText: "Car insurance" })).toHaveCount(0);
  await expect(page.getByText("Large cost removed.")).toBeVisible();
});
