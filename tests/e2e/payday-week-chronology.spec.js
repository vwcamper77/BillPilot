// UI coverage for the "What you can safely spend each week" chart: a bill due
// before payday, income landing on payday, and a bill due after payday but in
// the same calendar week must all be reflected correctly — and the chart must
// show safe-to-spend amounts, never a raw projected bank balance, as the
// headline figure for a week.

import { test, expect } from "@playwright/test";
import {
  NON_ADMIN_TEST_EMAIL,
  clearUserBills,
  clearUserLargeCosts,
  clearUserIncomeEvents,
  grantTestAccess,
  mintCustomToken,
  seedDashboardState,
  seedTestUsers,
  seedUserBill,
} from "./setup/seedTestUsers.mjs";

let uid;

function todayIsoLondon() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year").value;
  const month = parts.find((part) => part.type === "month").value;
  const day = parts.find((part) => part.type === "day").value;
  return `${year}-${month}-${day}`;
}

function addDaysIso(iso, days) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfMonth(iso) {
  return Number(iso.slice(8, 10));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Always land in "next week" (never today's own week), so the three dates —
// bill before payday, payday itself, bill after payday — sit in one
// unambiguous WC bucket (index 1) no matter what day the suite runs on.
function nextWeekOffsets() {
  const today = todayIsoLondon();
  const dow = new Date(`${today}T12:00:00.000Z`).getUTCDay();
  const mondayOffset = (dow + 6) % 7;
  const toNextMonday = 7 - mondayOffset;
  return {
    billBeforeOffset: toNextMonday, // Monday
    paydayOffset: toNextMonday + 2, // Wednesday
    rentAfterOffset: toNextMonday + 4, // Friday
  };
}

async function signInAsBrowserUser(page, userUid) {
  const customToken = await mintCustomToken(userUid);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__cleartillTestSignIn === "function");
  await page.evaluate((token) => window.__cleartillTestSignIn(token), customToken);
}

async function gotoDashboardChart(page) {
  await page.goto("/dashboard");
  const chart = page.locator(".spend-curve-card");
  await chart.waitFor({ state: "visible", timeout: 20000 });
  return chart;
}

function amountOf(text) {
  return Number(String(text).replace(/[^0-9.-]/g, ""));
}

test.beforeAll(async () => {
  const { nonAdminUser } = await seedTestUsers();
  uid = nonAdminUser.uid;
  await grantTestAccess(uid, NON_ADMIN_TEST_EMAIL);
});

test.beforeEach(async () => {
  await clearUserBills(uid);
  await clearUserLargeCosts(uid);
  await clearUserIncomeEvents(uid);
});

test.describe("payday week chronology", () => {
  test("a bill before payday and rent after payday, in the same week, both land correctly", async ({ page }) => {
    const today = todayIsoLondon();
    const { billBeforeOffset, paydayOffset, rentAfterOffset } = nextWeekOffsets();
    const billBeforeDate = addDaysIso(today, billBeforeOffset);
    const paydayDate = addDaysIso(today, paydayOffset);
    const rentAfterDate = addDaysIso(today, rentAfterOffset);

    await seedDashboardState(uid, { currentBalance: 2500, payDay: dayOfMonth(paydayDate), payAmount: 4000 });
    await seedUserBill(uid, { id: "small-bill", name: "Small bill", amount: 17, dueDay: dayOfMonth(billBeforeDate) });
    await seedUserBill(uid, { id: "rent", name: "Rent", amount: 1100, dueDay: dayOfMonth(rentAfterDate) });

    await signInAsBrowserUser(page, uid);
    const chart = await gotoDashboardChart(page);
    await chart.screenshot({ path: "output/playwright/weekly-safe-spend-chart.png" });

    // Hero: both "you're clear" and the daily allowance must reflect the £17
    // bill due before payday — £2,483, not the raw £2,500 balance.
    await expect(page.locator(".hero-value")).toContainText("£2,483");
    const expectedDaily = round2(2483 / paydayOffset);
    await expect(page.locator(".hero-daily")).toContainText(`£${expectedDaily.toFixed(2)}/day`);

    const paydayWeekCard = page.locator('[data-testid="weekly-spend-card"][data-week-index="1"]');
    await expect(paydayWeekCard).toContainText("WC");

    // The payday week must show every transaction that occurs within it —
    // including the rent that falls after payday — and must not push it into
    // the following week's card.
    const billsDue = paydayWeekCard.locator('[data-testid="bills-due"]');
    expect(amountOf(await billsDue.textContent())).toBe(1117);
    const projectedClosing = paydayWeekCard.locator('[data-testid="projected-closing-balance"]');
    expect(amountOf(await projectedClosing.textContent())).toBe(5383);

    const nextWeekCard = page.locator('[data-testid="weekly-spend-card"][data-week-index="2"]');
    expect(amountOf(await nextWeekCard.locator('[data-testid="bills-due"]').textContent())).toBe(0);
    expect(amountOf(await nextWeekCard.locator('[data-testid="projected-closing-balance"]').textContent())).toBe(5383);

    // The payday week is split into a "before payday" and "after payday" card
    // row — not one flat balance figure.
    const preAvailable = paydayWeekCard.locator('[data-testid="available-to-spend"][data-segment="pre"]');
    const postAvailable = paydayWeekCard.locator('[data-testid="available-to-spend"][data-segment="post"]');
    await expect(preAvailable).toBeVisible();
    await expect(postAvailable).toBeVisible();
    expect(amountOf(await preAvailable.textContent())).toBe(round2(expectedDaily * 3));

    // Available-to-spend must never equal the raw projected balance — it is a
    // safe daily rate, not a bank balance.
    expect(amountOf(await postAvailable.textContent())).toBeLessThan(5383);
    expect(amountOf(await preAvailable.textContent())).toBeLessThan(2483);
  });

  test("multiple transactions on payday itself are all applied, income first", async ({ page }) => {
    const today = todayIsoLondon();
    const { paydayOffset } = nextWeekOffsets();
    const paydayDate = addDaysIso(today, paydayOffset);

    await seedDashboardState(uid, { currentBalance: 1000, payDay: dayOfMonth(paydayDate), payAmount: 3000 });
    await seedUserBill(uid, { id: "same-day-bill", name: "Subscription", amount: 200, dueDay: dayOfMonth(paydayDate) });

    await signInAsBrowserUser(page, uid);
    await gotoDashboardChart(page);

    const paydayWeekCard = page.locator('[data-testid="weekly-spend-card"][data-week-index="1"]');
    // Income clears before a same-day bill, so the £200 subscription is billed
    // and the closing balance reflects it — 1000 + 3000 - 200 = 3800.
    expect(amountOf(await paydayWeekCard.locator('[data-testid="projected-closing-balance"]').textContent())).toBe(3800);
    expect(amountOf(await paydayWeekCard.locator('[data-testid="bills-due"]').textContent())).toBe(200);
  });

  test("a genuine shortfall before payday shows the real amount needed, not a misleading £0", async ({ page }) => {
    const today = todayIsoLondon();
    const { billBeforeOffset, paydayOffset } = nextWeekOffsets();
    const billBeforeDate = addDaysIso(today, billBeforeOffset);
    const paydayDate = addDaysIso(today, paydayOffset);

    // £500 balance, an £800 bill due before payday: a genuine £300 shortfall.
    await seedDashboardState(uid, { currentBalance: 500, payDay: dayOfMonth(paydayDate), payAmount: 1000 });
    await seedUserBill(uid, { id: "big-bill", name: "Big bill", amount: 800, dueDay: dayOfMonth(billBeforeDate) });

    await signInAsBrowserUser(page, uid);
    await gotoDashboardChart(page);

    await expect(page.locator(".hero-value")).toContainText("£300");
    await expect(page.locator(".hero-value")).not.toContainText("£0");
    await expect(page.getByRole("button", { name: "How it's worked out" })).toBeVisible();
    await page.getByRole("button", { name: "How it's worked out" }).click();
    await expect(page.locator(".forecast-breakdown-row.total")).toContainText("£300 needed before payday");

    // The chart must not claim a "per day" allowance while short, and the
    // affected week's card must show the shortfall, not a false £0.
    await expect(page.locator(".spend-curve-warning")).toBeVisible();
    await expect(page.locator(".curve-stat-label", { hasText: "Per day" })).toHaveCount(0);
    const shortWeek = page.locator('[data-testid="weekly-spend-card"]').filter({ hasText: "May go below £0" }).first();
    await expect(shortWeek).toBeVisible();
  });
});
