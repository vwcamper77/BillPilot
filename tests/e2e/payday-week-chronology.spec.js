// UI coverage for the payday-week chronology fix: a bill due before payday,
// income landing on payday, and a bill due after payday but in the same
// calendar week must all be reflected correctly in the hero numbers and the
// four-week chart — never conflated, never pushed into the wrong week.

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
    await chart.screenshot({ path: "output/playwright/payday-week-split-chart.png" });

    // Hero: both "you're clear" and the daily allowance must reflect the £17
    // bill due before payday — £2,483, not the raw £2,500 balance.
    await expect(page.locator(".hero-value")).toContainText("£2,483");
    const expectedDaily = (2483 / paydayOffset).toFixed(2);
    await expect(page.locator(".hero-daily")).toContainText(`£${expectedDaily}/day`);

    // No income — and no bill due next week — shown as available/deducted this week.
    const paydayWeekBar = page.locator('[data-testid="waterfall-bar"][data-week-index="1"]');
    const weekZeroBar = page.locator('[data-testid="waterfall-bar"][data-week-index="0"]');
    expect(await weekZeroBar.getAttribute("data-closing-balance")).toBe("2500");

    // The payday week (WC containing payday) must show every transaction that
    // occurs within it — including the rent that falls after payday — and must
    // not push that rent into the following week.
    expect(await paydayWeekBar.getAttribute("data-closing-balance")).toBe("5383");
    expect(await paydayWeekBar.getAttribute("data-weekly-outflow")).toBe("1117");
    const weekTwoBar = page.locator('[data-testid="waterfall-bar"][data-week-index="2"]');
    expect(await weekTwoBar.getAttribute("data-weekly-outflow")).toBe("0");
    expect(await weekTwoBar.getAttribute("data-closing-balance")).toBe("5383");

    // The payday week is visually split into a pre-payday and post-payday state.
    const preSegment = page.locator('[data-testid="waterfall-bar-pre-payday"][data-week-index="1"]');
    await expect(preSegment).toBeVisible();
    expect(Number(await preSegment.getAttribute("data-value"))).toBe(2483);

    // The full chronological bridge is available for the payday week: opening,
    // the £17 bill, the £4,000 pay, then the £1,100 rent — applied once, in order.
    const bridgeSteps = page.locator('[data-testid="payday-week-bridge-step"]');
    await expect(bridgeSteps).toHaveCount(4);
    const stepTypes = await bridgeSteps.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-step")));
    expect(stepTypes).toEqual(["opening", "bill", "primary_pay", "bill"]);
    const balancesAfter = await bridgeSteps.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-balance-after")));
    expect(balancesAfter.slice(1)).toEqual(["2483", "6483", "5383"]);
  });

  test("multiple transactions on payday itself are all applied, income first", async ({ page }) => {
    const today = todayIsoLondon();
    const { paydayOffset } = nextWeekOffsets();
    const paydayDate = addDaysIso(today, paydayOffset);

    await seedDashboardState(uid, { currentBalance: 1000, payDay: dayOfMonth(paydayDate), payAmount: 3000 });
    await seedUserBill(uid, { id: "same-day-bill", name: "Subscription", amount: 200, dueDay: dayOfMonth(paydayDate) });

    await signInAsBrowserUser(page, uid);
    await gotoDashboardChart(page);

    const bridgeSteps = page.locator('[data-testid="payday-week-bridge-step"]');
    await expect(bridgeSteps).toHaveCount(3);
    const stepTypes = await bridgeSteps.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-step")));
    // Income clears before a same-day bill, so the bill never appears to be
    // paid from money that hasn't landed yet.
    expect(stepTypes).toEqual(["opening", "primary_pay", "bill"]);
    const balancesAfter = await bridgeSteps.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-balance-after")));
    expect(balancesAfter.slice(1)).toEqual(["4000", "3800"]);

    const paydayWeekBar = page.locator('[data-testid="waterfall-bar"][data-week-index="1"]');
    expect(await paydayWeekBar.getAttribute("data-closing-balance")).toBe("3800");
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

    // The chart must not claim a "safe daily" allowance while short.
    await expect(page.locator(".spend-curve-warning")).toBeVisible();
    await expect(page.locator(".curve-stat-label", { hasText: "Safe daily" })).toHaveCount(0);
  });
});
