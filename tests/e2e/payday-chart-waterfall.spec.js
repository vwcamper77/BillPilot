// Visual/DOM coverage for the "Your next 4 weeks until pay day" waterfall chart
// on the dashboard. Seeds a real (dev) Firestore user via the Admin SDK, signs
// into a real browser session via the dev-only __cleartillTestSignIn hook (see
// components/TestAuthBridge.jsx), and asserts on the chart's rendered SVG —
// bar heights, the £0 line position, marker placement, and label overlap.

import { test, expect } from "@playwright/test";
import { getApps } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  NON_ADMIN_TEST_EMAIL,
  clearUserBills,
  grantTestAccess,
  mintCustomToken,
  seedDashboardState,
  seedTestUsers,
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

// Independent mirror of lib/billMath.js's Monday-alignment, used to cross-check
// which week index a given offset should land in without trusting the app's own code.
function weekIndexForOffset(offsetDays) {
  const today = todayIsoLondon();
  const targetIso = addDaysIso(today, offsetDays);
  const dow = new Date(`${today}T12:00:00.000Z`).getUTCDay();
  const mondayOffset = (dow + 6) % 7;
  const firstWeekStart = addDaysIso(today, -mondayOffset);
  const daysFromFirstWeekStart = Math.round(
    (new Date(`${targetIso}T12:00:00.000Z`) - new Date(`${firstWeekStart}T12:00:00.000Z`)) / (24 * 60 * 60 * 1000),
  );
  return Math.min(3, Math.floor(daysFromFirstWeekStart / 7));
}

async function setBills(bills) {
  await clearUserBills(uid);
  const db = getFirestore(getApps()[0]);
  const batch = db.batch();
  for (const bill of bills) {
    const ref = db.collection("users").doc(uid).collection("bills").doc();
    batch.set(ref, {
      type: "bill",
      name: bill.name,
      amount: bill.amount,
      currency: "GBP",
      frequency: "monthly",
      dueDay: bill.dueDay,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
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

test.describe("payday chart waterfall", () => {
  test("normal positive weeks: bars are grounded at £0, and closing balances are correct", async ({ page }) => {
    const payDay = dayOfMonth(addDaysIso(todayIsoLondon(), 16)); // lands in week 3 (index 2)
    await seedDashboardState(uid, { currentBalance: 1500, payDay, payAmount: 2200 });
    await setBills([
      { name: "Small bill", amount: 65, dueDay: dayOfMonth(addDaysIso(todayIsoLondon(), 2)) },
      { name: "Big bill", amount: 1155, dueDay: dayOfMonth(addDaysIso(todayIsoLondon(), 9)) },
    ]);

    await signInAsBrowserUser(page, uid);
    await gotoDashboardChart(page);

    const bar0 = page.locator('[data-testid="waterfall-bar"][data-week-index="0"]');
    const bar1 = page.locator('[data-testid="waterfall-bar"][data-week-index="1"]');
    await expect(bar0).toBeVisible();
    await expect(bar1).toBeVisible();

    expect(await bar0.getAttribute("data-closing-balance")).toBe("1435");
    expect(await bar1.getAttribute("data-closing-balance")).toBe("280");
    expect(await bar0.getAttribute("data-weekly-outflow")).toBe("65");
    expect(await bar1.getAttribute("data-weekly-outflow")).toBe("1155");

    // Both positive bars must sit on (touch) the £0 line, not float away from it
    const zeroLine = page.locator('[data-testid="zero-line"]');
    const zeroY = Number(await zeroLine.getAttribute("y1"));
    for (const bar of [bar0, bar1]) {
      const y = Number(await bar.getAttribute("y"));
      const height = Number(await bar.getAttribute("height"));
      expect(y + height).toBeCloseTo(zeroY, 0);
    }

    // A bigger balance still produces a taller bar than a smaller one
    const height0 = Number(await bar0.getAttribute("height"));
    const height1 = Number(await bar1.getAttribute("height"));
    expect(height0).toBeGreaterThan(height1);
  });

  test("an unchanged balance (no cost that week) renders the same bar height as the week before", async ({ page }) => {
    // Payday lands today (week 1, index 0) so weeks 2 and 3 are unaffected by the income bump
    // and stay directly comparable to each other.
    const payDay = dayOfMonth(todayIsoLondon());
    await seedDashboardState(uid, { currentBalance: 1500, payDay, payAmount: 2200 });
    await setBills([
      { name: "Small bill", amount: 65, dueDay: dayOfMonth(addDaysIso(todayIsoLondon(), 2)) },
      { name: "Big bill", amount: 1155, dueDay: dayOfMonth(addDaysIso(todayIsoLondon(), 9)) },
    ]);

    await signInAsBrowserUser(page, uid);
    await gotoDashboardChart(page);

    // Weeks 2 and 3 close at the same balance (no bill in week 3), so their bars should match
    const bar1 = page.locator('[data-testid="waterfall-bar"][data-week-index="1"]');
    const bar2 = page.locator('[data-testid="waterfall-bar"][data-week-index="2"]');
    const closing1 = await bar1.getAttribute("data-closing-balance");
    expect(await bar2.getAttribute("data-closing-balance")).toBe(closing1);
    expect(await bar2.getAttribute("data-weekly-outflow")).toBe("0");
    const height1 = Number(await bar1.getAttribute("height"));
    const height2 = Number(await bar2.getAttribute("height"));
    expect(height2).toBeCloseTo(height1, 0);

    // Weeks 2-4 are all after the pay date (which fell in week 1), so they should be muted
    const bar3 = page.locator('[data-testid="waterfall-bar"][data-week-index="3"]');
    expect(await bar3.getAttribute("data-muted")).toBe("true");
  });

  test("negative week: the bar hangs below the £0 line, touching it", async ({ page }) => {
    await seedDashboardState(uid, { currentBalance: 300, payDay: dayOfMonth(addDaysIso(todayIsoLondon(), 20)), payAmount: 1800 });
    await setBills([{ name: "Big bill", amount: 420, dueDay: dayOfMonth(addDaysIso(todayIsoLondon(), 2)) }]);

    await signInAsBrowserUser(page, uid);
    await gotoDashboardChart(page);

    const bar0 = page.locator('[data-testid="waterfall-bar"][data-week-index="0"]');
    await expect(bar0).toBeVisible();
    expect(await bar0.getAttribute("data-closing-balance")).toBe("-120");

    const zeroLine = page.locator('[data-testid="zero-line"]');
    const zeroY = Number(await zeroLine.getAttribute("y1"));
    const barY = Number(await bar0.getAttribute("y"));
    const barHeight = Number(await bar0.getAttribute("height"));

    // SVG y grows downward: the bar's bottom edge must sit below (>) the £0 line
    expect(barY + barHeight).toBeGreaterThan(zeroY);
    // ...and its top edge must touch the £0 line, not float above it
    expect(barY).toBeCloseTo(zeroY, 0);
  });

  test("pay date marker sits in the correct WC column", async ({ page }) => {
    const offsetDays = 10; // deliberately mid-range so it lands unambiguously in one week
    const expectedIndex = weekIndexForOffset(offsetDays);
    const payDay = dayOfMonth(addDaysIso(todayIsoLondon(), offsetDays));
    await seedDashboardState(uid, { currentBalance: 800, payDay, payAmount: 1800 });
    await setBills([]);

    await signInAsBrowserUser(page, uid);
    await gotoDashboardChart(page);

    const paydayMarker = page.locator('[data-testid="payday-marker"]');
    await expect(paydayMarker).toBeVisible();
    expect(await paydayMarker.getAttribute("data-week-index")).toBe(String(expectedIndex));

    const weekLabel = page.locator(`[data-testid="week-label"][data-week-index="${expectedIndex}"]`);
    await expect(weekLabel).toContainText("WC");
  });

  test("after payday, the chart shows income coming back in", async ({ page }) => {
    const offsetDays = 10;
    const expectedIndex = weekIndexForOffset(offsetDays);
    const payDay = dayOfMonth(addDaysIso(todayIsoLondon(), offsetDays));
    await seedDashboardState(uid, { currentBalance: 400, payDay, payAmount: 2000 });
    await setBills([]);

    await signInAsBrowserUser(page, uid);
    await gotoDashboardChart(page);

    const incomeText = page.locator(`[data-testid="weekly-income"][data-week-index="${expectedIndex}"]`);
    await expect(incomeText).toBeVisible();
    expect(await incomeText.getAttribute("data-amount")).toBe("2000");
    await expect(incomeText).toContainText("+£2,000");

    const payDateBar = page.locator(`[data-testid="waterfall-bar"][data-week-index="${expectedIndex}"]`);
    expect(await payDateBar.getAttribute("data-closing-balance")).toBe("2400");

    // No bills at all this scenario, so no earlier week should show an income bump
    const earlierIncome = page.locator('[data-testid="weekly-income"]');
    expect(await earlierIncome.count()).toBe(1);
  });

  test("mobile 320px: WC labels, cost labels, and markers do not overlap", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const payDay = dayOfMonth(addDaysIso(todayIsoLondon(), 16));
    await seedDashboardState(uid, { currentBalance: 1500, payDay, payAmount: 2200 });
    await setBills([
      { name: "Small bill", amount: 65, dueDay: dayOfMonth(addDaysIso(todayIsoLondon(), 2)) },
      { name: "Big bill", amount: 1155, dueDay: dayOfMonth(addDaysIso(todayIsoLondon(), 9)) },
    ]);

    await signInAsBrowserUser(page, uid);
    const chart = await gotoDashboardChart(page);
    await chart.scrollIntoViewIfNeeded();

    const boxes = [];
    for (const locator of [
      page.locator('[data-testid="week-label"]'),
      page.locator('[data-testid="weekly-outflow"]'),
    ]) {
      const count = await locator.count();
      for (let i = 0; i < count; i += 1) {
        const box = await locator.nth(i).boundingBox();
        if (box) boxes.push(box);
      }
    }
    for (const locator of [
      page.locator('[data-testid="today-marker"] text'),
      page.locator('[data-testid="payday-marker"] text'),
    ]) {
      const box = await locator.boundingBox();
      if (box) boxes.push(box);
    }

    function overlaps(a, b) {
      return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    }

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(overlaps(boxes[i], boxes[j])).toBe(false);
      }
    }
  });
});
