import { test, expect } from "@playwright/test";
import {
  NON_ADMIN_TEST_EMAIL,
  clearUserBills,
  grantTestAccess,
  seedDashboardState,
  seedTestUsers,
} from "./setup/seedTestUsers.mjs";

const CASES = [
  {
    input: "I have gas and electric combined and £45 a month on the 24th",
    title: "Gas & electricity",
    amount: "£45",
    dueText: "24th of each month",
  },
  {
    input: "British Gas £45 on the 24th every month",
    title: "British Gas - Gas & electricity",
    amount: "£45",
    dueText: "24th of each month",
  },
  {
    input: "Affinity Water £35 per month on the 15th",
    title: "Affinity Water - Water",
    amount: "£35",
    dueText: "15th of each month",
  },
  {
    input: "my water is £35 on 15th",
    title: "Water",
    amount: "£35",
    dueText: "15th of each month",
  },
  {
    input: "electricity is £80 on the 10th",
    title: "Electricity",
    amount: "£80",
    dueText: "10th of each month",
  },
  {
    input: "council tax £181 on the 1st every month",
    title: "Council Tax",
    amount: "£181",
    dueText: "1st of each month",
  },
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTitlePattern(title) {
  const parts = title.split(" - ");

  if (parts.length === 2) {
    return new RegExp(`^${escapeRegex(parts[0])}\\s+-\\s+${escapeRegex(parts[1])}$`);
  }

  return new RegExp(`^${escapeRegex(title)}$`);
}

let billUser;
const TEST_PASSWORD = "cleartill-e2e-test-password";

test.beforeAll(async () => {
  const seeded = await seedTestUsers();
  billUser = seeded.nonAdminUser;
  await grantTestAccess(billUser.uid, NON_ADMIN_TEST_EMAIL);
  await clearUserBills(billUser.uid);
  await seedDashboardState(billUser.uid, { currentBalance: 1000, payDay: 20, payAmount: 2000 });
});

test("utility bill titles stay clean in review and after save", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByPlaceholder("Email").fill(NON_ADMIN_TEST_EMAIL);
  await page.getByPlaceholder("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Add bills" })).toBeVisible();
  await expect(page.getByText(/You're clear -|Almost clear -|You're short -/)).toHaveCount(0);

  const balanceInput = page.locator("#account-balance");
  await balanceInput.click();
  await balanceInput.fill("2500");
  await expect(balanceInput).toHaveValue("2500");

  const composer = page.locator("form.chat-form textarea");

  for (const billCase of CASES) {
    await composer.fill(billCase.input);
    await page.getByRole("button", { name: "Review bill" }).click();

    const reviewCard = page.locator(".bill-review-card").last();
    await expect(reviewCard).toBeVisible({ timeout: 15000 });
    const reviewHeading = reviewCard.getByRole("heading").first();
    await expect(reviewHeading).toBeVisible();
    for (const part of billCase.title.split(" - ")) {
      await expect(reviewHeading).toContainText(part);
    }
    await expect(reviewCard).toContainText(String(billCase.amount).replace(/[^\d.]/g, ""));
    await expect(reviewCard).toContainText(billCase.dueText);
    await expect(reviewCard).not.toContainText(/Pounds|Combined|Per|I Have|Every Month/i);

    await reviewCard.getByRole("button", { name: "Add bill" }).click();

    const savedTitle = page.locator(".bill-row-title").filter({
      hasText: buildTitlePattern(billCase.title),
    }).last();
    await expect(savedTitle).toBeVisible({ timeout: 10000 });
    for (const part of billCase.title.split(" - ")) {
      await expect(savedTitle).toContainText(part);
    }

    await expect(savedTitle).not.toContainText(/Pounds|Combined|I Have|Every Month/i);
  }

  const knownSupplierRow = page.locator("li").filter({
    has: page.locator(".bill-row-title", { hasText: /^British Gas - Gas & electricity$/ }),
  }).last();
  await knownSupplierRow.getByRole("button", { name: "Edit" }).click();
  const editForm = page.locator(".bill-edit-form").last();
  await editForm.locator('input[id^="bill-supplier-"]').fill("Con Edison");
  await editForm.locator('input[id^="bill-name-"]').fill("Electricity");
  await editForm.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".bill-row-title").filter({ hasText: /^Con Edison - Electricity$/ }).last()).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "Add manually" }).click();
  await page.locator('input[id^="review-supplier-"]').fill("Toronto Hydro");
  await page.locator('input[id^="review-name-"]').fill("Electricity");
  await page.locator('input[id^="review-amount-"]').fill("95");
  await page.locator('input[id^="review-dueDay-"]').fill("11");
  await page.getByRole("button", { name: "Save details" }).click();

  const manualReviewCard = page.locator(".bill-review-card").last();
  await expect(manualReviewCard).toContainText("Toronto Hydro");
  await expect(manualReviewCard).toContainText("Electricity");
  await manualReviewCard.getByRole("button", { name: "Add bill" }).click();
  await expect(page.locator(".bill-row-title").filter({ hasText: /^Toronto Hydro - Electricity$/ }).last()).toBeVisible({ timeout: 10000 });
});
