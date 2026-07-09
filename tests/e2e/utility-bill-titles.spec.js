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

function parseMoneyText(value) {
  const match = String(value || "").match(/-?\d[\d,]*(?:\.\d{1,2})?/);
  return match ? Number(match[0].replace(/,/g, "")) : 0;
}

function formatCurrencyText(amount) {
  const value = Number(amount) || 0;

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

async function sumVisibleBillAmounts(page) {
  const amounts = await page.locator(".bill-list li .bill-row-details .bill-meta-pair:first-child strong").allTextContents();
  return amounts.reduce((sum, text) => sum + parseMoneyText(text), 0);
}

async function goToFirstBillPage(page) {
  const pagination = page.locator(".bill-pagination").first();
  if (await pagination.count() === 0) {
    return;
  }

  const previousButton = pagination.getByRole("button", { name: /Previous/ });

  while (!await previousButton.isDisabled()) {
    await previousButton.click();
  }
}

async function sumAllBillAmounts(page) {
  await goToFirstBillPage(page);

  const pagination = page.locator(".bill-pagination").first();
  if (await pagination.count() === 0) {
    return sumVisibleBillAmounts(page);
  }

  const nextButton = pagination.getByRole("button", { name: /Next/ });
  let total = 0;

  while (true) {
    total += await sumVisibleBillAmounts(page);
    if (await nextButton.isDisabled()) {
      break;
    }
    await nextButton.click();
  }

  await goToFirstBillPage(page);
  return total;
}

async function findBillTitle(page, titlePattern) {
  await goToFirstBillPage(page);

  const pagination = page.locator(".bill-pagination").first();
  const nextButton = pagination.getByRole("button", { name: /Next/ });

  while (true) {
    const locator = page.locator(".bill-row-title").filter({ hasText: titlePattern }).last();
    if (await locator.count()) {
      return locator;
    }

    if (await pagination.count() === 0 || await nextButton.isDisabled()) {
      return locator;
    }

    await nextButton.click();
  }
}

async function findBillRow(page, titlePattern) {
  const title = await findBillTitle(page, titlePattern);
  return title.locator("xpath=ancestor::li[1]");
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

    const savedTitle = await findBillTitle(page, buildTitlePattern(billCase.title));
    await expect(savedTitle).toBeVisible({ timeout: 10000 });
    for (const part of billCase.title.split(" - ")) {
      await expect(savedTitle).toContainText(part);
    }

    await expect(savedTitle).not.toContainText(/Pounds|Combined|I Have|Every Month/i);
  }

  const billListSummary = page.locator(".bill-list-summary-chip");
  const billFilterTabs = page.locator(".bill-filter-tabs");

  await billFilterTabs.getByRole("button", { name: "All" }).click();
  await expect(billListSummary).toContainText("total monthly bills");
  await expect(billListSummary).toContainText(formatCurrencyText(await sumAllBillAmounts(page)));

  await billFilterTabs.getByRole("button", { name: "Before you're paid" }).click();
  await expect(billListSummary).toContainText("bills before payday");
  await expect(billListSummary).toContainText(formatCurrencyText(await sumAllBillAmounts(page)));

  await billFilterTabs.getByRole("button", { name: "After you're paid" }).click();
  await expect(billListSummary).toContainText("bills after payday");
  await expect(billListSummary).toContainText(formatCurrencyText(await sumAllBillAmounts(page)));

  await billFilterTabs.getByRole("button", { name: "Recently added" }).click();
  await expect(billListSummary).toContainText("recently added bills");
  await expect(billListSummary).toContainText(formatCurrencyText(await sumAllBillAmounts(page)));

  await billFilterTabs.getByRole("button", { name: "All" }).click();
  const paidRow = await findBillRow(page, /^Affinity Water - Water$/);
  await paidRow.getByRole("button", { name: "Paid" }).click();

  await billFilterTabs.getByRole("button", { name: "Paid", exact: true }).click();
  await expect(billListSummary).toContainText("paid bills");
  await expect(billListSummary).toContainText(formatCurrencyText(await sumAllBillAmounts(page)));

  await billFilterTabs.getByRole("button", { name: "All" }).click();
  await expect(billListSummary).toContainText("total monthly bills");
  await expect(billListSummary).toContainText(formatCurrencyText(await sumAllBillAmounts(page)));

  const knownSupplierRow = await findBillRow(page, /^British Gas - Gas & electricity$/);
  await knownSupplierRow.getByRole("button", { name: "Edit" }).click();
  const editForm = page.locator(".bill-edit-form").last();
  await editForm.locator('input[id^="bill-supplier-"]').fill("Con Edison");
  await editForm.locator('input[id^="bill-name-"]').fill("Electricity");
  await editForm.getByRole("button", { name: "Save" }).click();
  await expect((await findBillTitle(page, /^Con Edison - Electricity$/))).toBeVisible({ timeout: 10000 });

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
  await expect((await findBillTitle(page, /^Toronto Hydro - Electricity$/))).toBeVisible({ timeout: 10000 });
});
