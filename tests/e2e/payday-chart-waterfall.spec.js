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
  test("normal positive waterfall: a large weekly outgoing is visibly larger than a small one", async ({ page }) => {
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

    const height0 = Number(await bar0.getAttribute("height"));
    const height1 = Number(await bar1.getAttribute("height"));

    expect(height1).toBeGreaterThan(height0 * 4);

    const closing0 = Number(await bar0.getAttribute("data-closing-balance"));
    const closing1 = Number(await bar1.getAttribute("data-closing-balance"));
    expect(closing0).toBe(1435);
    expect(closing1).toBe(280);
  });

  test("no-cost week renders as a thin flat line, not a full-height block", async ({ page }) => {
    const payDay = dayOfMonth(addDaysIso(todayIsoLondon(), 16));
    await seedDashboardState(uid, { currentBalance: 1500, payDay, payAmount: 2200 });
    await setBills([
      { name: "Small bill", amount: 65, dueDay: dayOfMonth(addDaysIso(todayIsoLondon(), 2)) },
      { name: "Big bill", amount: 1155, dueDay: dayOfMonth(addDaysIso(todayIsoLondon(), 9)) },
    ]);

    await signInAsBrowserUser(page, uid);
    await gotoDashboardChart(page);

    const bar2 = page.locator('[data-testid="waterfall-bar"][data-week-index="2"]');
    await expect(bar2).toBeVisible();
    const height2 = Number(await bar2.getAttribute("height"));
    expect(height2).toBeLessThanOrEqual(3);
    expect(await bar2.getAttribute("data-weekly-outflow")).toBe("0");

    // Week 4 is after the pay date, so it should be muted
    const bar3 = page.locator('[data-testid="waterfall-bar"][data-week-index="3"]');
    expect(await bar3.getAttribute("data-muted")).toBe("true");
  });

  test("negative week: the bar crosses below the £0 line", async ({ page }) => {
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
