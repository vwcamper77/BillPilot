import { expect, test } from "@playwright/test";
import { buildWeeklySafeSpendingPlan, diffDays } from "../../lib/billMath.js";

test.describe("buildWeeklySafeSpendingPlan", () => {
  test("£7/day with part of the current week remaining is not shown as a full week's worth", () => {
    // Today Sat 2026-07-11 (WC 6 Jul, week ends 07-12), payday 10 days out so
    // the flat safe rate is exactly £70/10 = £7/day.
    const plan = buildWeeklySafeSpendingPlan("2026-07-11", "2026-07-21", 70, [], [], 0, []);
    const currentWeek = plan[0];
    expect(currentWeek.weekLabel).toBe("WC 6 Jul");
    expect(currentWeek.preDailyRate).toBe(7);
    expect(currentWeek.preDays).toBe(2); // 11th and 12th only, not the whole Mon-Sun week
    expect(currentWeek.availableToSpend).toBe(14);
    expect(currentWeek.availableToSpend).not.toBe(49);
  });

  test("a full seven-day week before payday at £7/day shows exactly £49", () => {
    // Today 2026-07-11, payday 17 days out (2026-07-28) so £119/17 = £7/day,
    // and WC 13 Jul is a complete Monday-Sunday week entirely before payday.
    const plan = buildWeeklySafeSpendingPlan("2026-07-11", "2026-07-28", 119, [], [], 0, []);
    const fullWeek = plan.find((point) => point.weekLabel === "WC 13 Jul");
    expect(fullWeek.preDays).toBe(7);
    expect(fullWeek.preDailyRate).toBe(7);
    expect(fullWeek.availableToSpend).toBe(49);
  });

  test("payday partway through a week splits that week's available-to-spend, not the raw balance", () => {
    const bills = [{ id: "b1", name: "Small bill", amount: 17, dueDay: 14, nextDueDate: "2026-07-14" }];
    const largeCosts = [{ id: "rent", name: "Rent", currentAccountAmount: 1100, nextDueDate: "2026-07-18" }];
    const plan = buildWeeklySafeSpendingPlan("2026-07-11", "2026-07-16", 2500, bills, largeCosts, 4000, []);
    const paydayWeek = plan.find((point) => point.containsPayDate);
    expect(paydayWeek.weekLabel).toBe("WC 13 Jul");
    expect(paydayWeek.preDays).toBe(3);
    expect(paydayWeek.postDays).toBe(4);
    // The projected closing balance (a bank balance) must not be reused as
    // the spendable figure — it includes the whole £4,000 payday income.
    expect(paydayWeek.projectedClosingBalance).toBe(5383);
    expect(paydayWeek.availableToSpend).toBeLessThan(paydayWeek.projectedClosingBalance);
  });

  test("bills reduce the safe daily rate but are never folded into available-to-spend directly", () => {
    const bills = [{ id: "big", name: "Big bill", amount: 900, dueDay: 20, nextDueDate: "2026-07-20" }];
    const plan = buildWeeklySafeSpendingPlan("2026-07-11", "2026-07-25", 1000, bills, [], 0, []);
    const billWeek = plan.find((point) => point.billsDue > 0);
    expect(billWeek.billsDue).toBe(900);
    // £1,000 in the account, but a £900 bill is due before payday — available
    // to spend must be capped well below the raw £1,000 balance.
    expect(billWeek.availableToSpend).toBeLessThan(100);
    expect(billWeek.availableToSpend).toBeGreaterThanOrEqual(0);
  });

  test("income and expenditure signs: a Rent bill (outgoing) and a same-named Rent income event (incoming) never cancel or merge", () => {
    const bills = [{ id: "rent-bill", name: "Rent", amount: 400, dueDay: 12, nextDueDate: "2026-07-12" }];
    const additionalIncomeEvents = [{
      id: "rent-income",
      name: "Rent",
      amount: 400,
      expectedDate: "2026-07-12",
      frequency: "one_off",
      confidence: "confirmed",
      status: "scheduled",
      active: true,
    }];
    const plan = buildWeeklySafeSpendingPlan("2026-07-11", "2026-07-25", 500, bills, [], 0, additionalIncomeEvents);
    const week0 = plan[0];
    // The outgoing Rent bill must reduce the balance (never show as +£400),
    // and the incoming Rent income must add to it (never show as -£400) —
    // they land on different days and must not net to zero or duplicate.
    const rentBillStep = week0.steps.find((step) => step.type === "bill" && step.name === "Rent");
    const rentIncomeStep = week0.steps.find((step) => step.type === "additional_income" && step.name === "Rent");
    expect(rentBillStep.amount).toBe(-400);
    expect(rentIncomeStep.amount).toBe(400);
    expect(week0.projectedClosingBalance).toBe(500 - 400 + 400);
    expect(week0.steps.filter((step) => step.name === "Rent")).toHaveLength(2);
  });

  test("no money is counted twice across adjacent weeks: every day in the window is claimed exactly once", () => {
    const plan = buildWeeklySafeSpendingPlan("2026-07-11", "2026-07-16", 2500, [], [], 4000, []);
    const totalDaysClaimed = plan.reduce((total, point) => total + point.preDays + point.postDays, 0);
    const horizonEnd = plan[plan.length - 1].weekEnd;
    const totalDaysInWindow = diffDays("2026-07-11", horizonEnd) + 1;
    expect(totalDaysClaimed).toBe(totalDaysInWindow);
  });

  test("a genuine shortfall before payday reports a negative available-to-spend rather than a misleading £0", () => {
    const bills = [{ id: "big", name: "Big bill", amount: 800, dueDay: 13, nextDueDate: "2026-07-13" }];
    const plan = buildWeeklySafeSpendingPlan("2026-07-11", "2026-07-20", 500, bills, [], 0, []);
    const shortWeek = plan.find((point) => point.isShortfall);
    expect(shortWeek).toBeTruthy();
    expect(shortWeek.availableToSpend).toBeLessThan(0);
  });
});
