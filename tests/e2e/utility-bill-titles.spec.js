import { test, expect } from "@playwright/test";
import { NON_ADMIN_TEST_EMAIL, grantTestAccess, seedTestUsers } from "./setup/seedTestUsers.mjs";

const CASES = [
  {
    input: "I have gas and electric combined and £45 a month on the 24th",
    title: "Gas & electricity",
    amount: "£45",
    dueText: "24th of each month",
  },
  {
    input: "British Gas £45 on the 24th every month",
    title: "British Gas — Gas & electricity",
    amount: "£45",
    dueText: "24th of each month",
  },
  {
    input: "Affinity Water £35 per month on the 15th",
    title: "Affinity Water — Water",
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
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let billUser;
const TEST_PASSWORD = "cleartill-e2e-test-password";

test.beforeAll(async () => {
  const seeded = await seedTestUsers();
  billUser = seeded.nonAdminUser;
  await grantTestAccess(billUser.uid, NON_ADMIN_TEST_EMAIL);
});

test("utility bill titles stay clean in review and after save", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByPlaceholder("Email").fill(NON_ADMIN_TEST_EMAIL);
  await page.getByPlaceholder("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Add bills" })).toBeVisible();

  const composer = page.locator("form.chat-form textarea");

  for (const billCase of CASES) {
    await composer.fill(billCase.input);
    await page.getByRole("button", { name: "Review bill" }).click();

    const reviewCard = page.locator(".bill-review-card").last();
    await expect(reviewCard.getByRole("heading", { name: billCase.title })).toBeVisible();
    await expect(reviewCard).toContainText(billCase.amount);
    await expect(reviewCard).toContainText(billCase.dueText);
    await expect(reviewCard).not.toContainText(/Pounds|Combined|Per|I Have|Every Month/i);

    await reviewCard.getByRole("button", { name: "Add bill" }).click();

    const savedTitle = page.locator(".bill-row-title").filter({
      hasText: new RegExp(`^${escapeRegex(billCase.title)}$`),
    }).last();
    await expect(savedTitle).toBeVisible();
    await expect(savedTitle).toHaveText(billCase.title);

    await expect(savedTitle).not.toContainText(/Pounds|Combined|I Have|Every Month/i);
  }
});
