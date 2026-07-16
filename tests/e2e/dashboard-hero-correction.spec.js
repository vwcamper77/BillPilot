import { expect, test } from "@playwright/test";
import {
  ADMIN_TEST_EMAIL,
  clearUserBills,
  clearUserIncomeEvents,
  clearUserLargeCosts,
  clearUserPrimaryIncome,
  grantTestAccess,
  mintCustomToken,
  seedDashboardState,
  seedTestUsers,
  seedUserBill,
  seedUserIncomeEvent,
  seedUserLargeCost,
  seedUserSavings,
} from "./setup/seedTestUsers.mjs";

let uid;
test.setTimeout(60000);

const todayIso = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function signIn(page) {
  const token = await mintCustomToken(uid);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__cleartillTestSignIn === "function");
  await page.evaluate((value) => window.__cleartillTestSignIn(value), token);
  await page.evaluate(() => window.localStorage.setItem("ct.setup.completedAt", new Date().toISOString()));
  await page.goto("/dashboard");
  await page.getByRole("heading", { name: /available until your next income/i }).waitFor({ state: "visible", timeout: 20000 });
}

async function seedCanonicalScenario() {
  const today = todayIso();
  await Promise.all([
    clearUserBills(uid),
    clearUserLargeCosts(uid),
    clearUserIncomeEvents(uid),
    clearUserPrimaryIncome(uid),
  ]);
  await seedUserSavings(uid, 0);
  await seedDashboardState(uid, { currentBalance: 2000 });
  await seedUserLargeCost(uid, {
    id: "greece",
    name: "Greece funding",
    amount: 471,
    dueDate: today,
    fundingStatus: "current_account",
    currentBalanceContribution: 471,
  });
  await seedUserIncomeEvent(uid, {
    id: "salary",
    name: "Salary",
    amount: 4400,
    expectedDate: addDays(today, 4),
    frequency: "one_off",
    confidence: "confirmed",
  });
  await seedUserBill(uid, {
    id: "later-bill",
    name: "Later bill",
    amount: 400,
    dueDay: Number(addDays(today, 10).slice(8)),
  });
}

test.beforeAll(async () => {
  const { adminUser } = await seedTestUsers();
  uid = adminUser.uid;
  await grantTestAccess(uid, ADMIN_TEST_EMAIL);
});

test.beforeEach(async () => {
  await seedCanonicalScenario();
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Review bills opens, scrolls to and focuses the existing section on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    await page.evaluate(() => window.localStorage.setItem("ct.ui.sections.bills", "closed"));
    await page.reload();

    const billsSection = page.locator('[data-section-key="bills"]');
    const billsHeading = billsSection.getByRole("button", { name: /Bills and regular income/ });
    await expect(billsHeading).toHaveAttribute("aria-expanded", "false");

    await page.getByRole("button", { name: "Review bills" }).click();

    await expect(billsHeading).toHaveAttribute("aria-expanded", "true");
    await expect(billsHeading).toBeFocused();
    await expect(billsSection).toHaveClass(/is-targeted/);
    await expect(billsSection.getByRole("status")).toHaveText("Bills and regular income opened.");
  });
}

test("the immediate hero reconciles canonical commitments and defers the future projection", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);

  const hero = page.locator(".hero-card");
  await expect(hero.getByTestId("hero-available-now")).toContainText("Available now");
  await expect(hero.getByTestId("hero-available-now")).toContainText("£2,000");
  await expect(hero.getByTestId("hero-committed")).toContainText("Committed before next income");
  await expect(hero.getByTestId("hero-committed")).toContainText("£471");
  await expect(hero.getByTestId("hero-safe")).toContainText("Safe until your next income");
  await expect(hero.getByTestId("hero-safe")).toContainText("£1,529");
  await expect(hero).toContainText("Based on your £2,000 balance and £471 committed before then.");
  await expect(hero).not.toContainText("£5,529");
  await expect(hero).not.toContainText("Confirmed income coming");
  await expect(hero).not.toContainText("Forecast left by");

  await hero.getByRole("button", { name: "See full calculation" }).click();
  await expect(hero.getByTestId("hero-bills")).toContainText("Bills before next income");
  await expect(hero.getByTestId("hero-bills")).toContainText("£0");
  await expect(hero.getByTestId("hero-large-costs")).toContainText("Protected commitments");
  await expect(hero.getByTestId("hero-large-costs")).toContainText("£471");
  await expect(hero.getByTestId("hero-total-committed")).toContainText("£471");
  await expect(hero.locator(".hero-calculation")).toContainText("Safe until next income");
  await expect(hero.locator(".hero-calculation")).toContainText("£1,529");
  await expect(hero.locator(".next-commitments")).toContainText("Protected contribution");
  await expect(hero.locator(".next-commitments")).toContainText("Greece funding");
  await expect(hero.locator(".next-commitments")).not.toContainText("Bill");

  const future = page.locator(".after-income-disclosure");
  await expect(future).not.toHaveAttribute("open", "");
  await expect(future.getByText("£4,400 confirmed income is scheduled")).toBeVisible();
  await expect(future.getByTestId("projected-balance")).toBeHidden();
  await future.getByText("After your next income").click();
  await expect(future.getByTestId("projected-balance")).toBeVisible();
  await expect(future.getByTestId("projected-balance")).toContainText("Projected balance on");
  await expect(future.getByTestId("projected-balance")).toContainText("£5,529");

  // Expanding future information is presentational only; today's result remains unchanged.
  await expect(hero.getByTestId("hero-safe")).toContainText("£1,529");
});
