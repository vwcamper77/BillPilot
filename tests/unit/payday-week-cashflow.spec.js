import { expect, test } from "@playwright/test";
import { calculateDashboard, buildFourWeekCashflowWaterfall } from "../../lib/billMath.js";
import { calculateSafeSpendingPlan } from "../../lib/cashflowTimeline.js";

// Reference scenario from the bug report:
// Balance £2,500 on 2026-07-11 (Saturday), payday 2026-07-16 (Thursday, WC 13 Jul),
// £4,000 income, a £17 bill due before payday, and £1,100 rent due after payday
// but within the same week (WC 13 Jul).
const TODAY = "2026-07-11";
const PAYDAY = "2026-07-16";
const BALANCE = 2500;
const INCOME = 4000;

function buildScenario({ smallBillDue = "2026-07-14", rentDue = "2026-07-18" } = {}) {
  const bills = [
    { id: "small-bill", name: "Small bill", amount: 17, dueDay: 14, active: true, nextDueDate: smallBillDue },
    { id: "rent", name: "Rent", amount: 1100, dueDay: 18, active: true, nextDueDate: rentDue },
  ];
  const income = { payDay: 16, amount: INCOME, active: true };
  const account = { currentBalance: BALANCE };
  const dashboard = calculateDashboard(bills, income, account, TODAY);
  const safeSpendingPlan = calculateSafeSpendingPlan({
    todayIso: TODAY,
    horizonDate: dashboard.paydayDate,
    currentBalance: dashboard.currentBalance,
    bills: dashboard.beforePayday,
    largeCostAllocations: [],
    additionalIncomeEvents: [],
  });
  const waterfall = buildFourWeekCashflowWaterfall(
    TODAY,
    dashboard.paydayDate,
    dashboard.currentBalance,
    [...dashboard.beforePayday, ...dashboard.afterPayday],
    [],
    INCOME,
    [],
  );
  return { dashboard, safeSpendingPlan, waterfall };
}

test.describe("payday-week chronological cashflow", () => {
  test("bill before payday reduces both the dashboard total and the safe-spending minimum to £2,483", () => {
    const { dashboard, safeSpendingPlan } = buildScenario();
    expect(dashboard.leftBeforePayday).toBe(2483);
    expect(safeSpendingPlan.minimumProjectedBalance).toBe(2483);
    expect(safeSpendingPlan.spendingRoom).toBe(2483);
  });

  test("safe daily allowance is derived from £2,483 over 5 days, not £2,500", () => {
    const { dashboard, safeSpendingPlan } = buildScenario();
    expect(dashboard.daysTillPayday).toBe(5);
    expect(safeSpendingPlan.safeDailyAmount).toBeCloseTo(2483 / 5, 5);
    expect(safeSpendingPlan.safeDailyAmount).not.toBeCloseTo(2500 / 5, 5);
  });

  test("payday income never counts as available before payday", () => {
    const { waterfall } = buildScenario();
    for (const point of waterfall) {
      if (point.weekEnd < PAYDAY) {
        expect(point.incomeReceived).toBe(0);
      }
    }
  });

  test("the payday week exposes the full chronological bridge: 2500 -> 2483 -> 6483 -> 5383", () => {
    const { waterfall } = buildScenario();
    const paydayWeek = waterfall.find((point) => point.containsPayDate);
    expect(paydayWeek.openingBalance).toBe(2500);
    expect(paydayWeek.prePaydayClosingBalance).toBe(2483);
    expect(paydayWeek.paydayMomentBalance).toBe(6483);
    expect(paydayWeek.postPaydayClosingBalance).toBe(5383);
    expect(paydayWeek.closingBalance).toBe(5383);
  });

  test("the rent stays in WC 13 Jul and is not pushed into WC 20 Jul merely because payday falls midweek", () => {
    const { waterfall } = buildScenario();
    const paydayWeek = waterfall.find((point) => point.containsPayDate);
    const followingWeek = waterfall[waterfall.indexOf(paydayWeek) + 1];
    expect(paydayWeek.weekLabel).toBe("WC 13 Jul");
    expect(paydayWeek.weeklyOutflow).toBe(1117);
    expect(followingWeek.weeklyOutflow).toBe(0);
    expect(followingWeek.closingBalance).toBe(paydayWeek.closingBalance);
  });

  test("every transaction in the payday week is applied exactly once, in date order", () => {
    const { waterfall } = buildScenario();
    const paydayWeek = waterfall.find((point) => point.containsPayDate);
    const dates = paydayWeek.steps.map((step) => step.date);
    const sortedDates = [...dates].sort();
    expect(dates).toEqual(sortedDates);
    expect(paydayWeek.steps).toHaveLength(3);
    expect(paydayWeek.steps.map((step) => step.name)).toEqual(["Small bill", "Pay", "Rent"]);
  });

  test("bill due exactly on payday and income are both applied, with income landing first", () => {
    const bills = [{ id: "same-day", name: "Same-day bill", amount: 200, dueDay: 16, active: true, nextDueDate: PAYDAY }];
    const income = { payDay: 16, amount: INCOME, active: true };
    const dashboard = calculateDashboard(bills, income, { currentBalance: BALANCE }, TODAY);
    const waterfall = buildFourWeekCashflowWaterfall(
      TODAY,
      dashboard.paydayDate,
      BALANCE,
      [...dashboard.beforePayday, ...dashboard.afterPayday],
      [],
      INCOME,
      [],
    );
    const paydayWeek = waterfall.find((point) => point.containsPayDate);
    expect(paydayWeek.steps.map((step) => step.type)).toEqual(["primary_pay", "bill"]);
    expect(paydayWeek.paydayMomentBalance).toBe(BALANCE + INCOME);
    expect(paydayWeek.closingBalance).toBe(BALANCE + INCOME - 200);
  });

  test("multiple bills before payday and after payday in the same week all net out correctly", () => {
    const bills = [
      { id: "b1", name: "Bill A", amount: 10, dueDay: 13, active: true, nextDueDate: "2026-07-13" },
      { id: "b2", name: "Bill B", amount: 7, dueDay: 14, active: true, nextDueDate: "2026-07-14" },
      { id: "b3", name: "Bill C", amount: 600, dueDay: 17, active: true, nextDueDate: "2026-07-17" },
      { id: "b4", name: "Bill D", amount: 500, dueDay: 19, active: true, nextDueDate: "2026-07-19" },
    ];
    const income = { payDay: 16, amount: INCOME, active: true };
    const dashboard = calculateDashboard(bills, income, { currentBalance: BALANCE }, TODAY);
    expect(dashboard.leftBeforePayday).toBe(2500 - 17);
    const waterfall = buildFourWeekCashflowWaterfall(
      TODAY,
      dashboard.paydayDate,
      BALANCE,
      [...dashboard.beforePayday, ...dashboard.afterPayday],
      [],
      INCOME,
      [],
    );
    const paydayWeek = waterfall.find((point) => point.containsPayDate);
    expect(paydayWeek.prePaydayClosingBalance).toBe(2483);
    expect(paydayWeek.paydayMomentBalance).toBe(6483);
    expect(paydayWeek.closingBalance).toBe(6483 - 600 - 500);
    expect(paydayWeek.steps).toHaveLength(5);
  });

  test("a genuine shortfall before payday is reported as a real negative amount, not floored to £0", () => {
    // Balance £1,000, bills £1,185 before payday, £400 confirmed income before
    // payday, £500 of large costs also due before payday — a true £285 shortfall.
    const result = calculateSafeSpendingPlan({
      todayIso: "2026-07-11",
      horizonDate: "2026-07-25",
      currentBalance: 1000,
      bills: [
        { id: "bill-a", amount: 1185, nextDueDate: "2026-07-14" },
      ],
      largeCostAllocations: [
        { id: "cost-a", currentAccountAmount: 500, nextDueDate: "2026-07-20" },
      ],
      additionalIncomeEvents: [{
        id: "gig",
        name: "Side gig",
        amount: 400,
        expectedDate: "2026-07-16",
        frequency: "one_off",
        confidence: "confirmed",
        status: "scheduled",
        active: true,
      }],
    });
    expect(result.minimumProjectedBalance).toBeLessThan(0);
    // The reported shortfall must equal the true worst dip, not a £0 floor.
    expect(result.spendingRoom).toBe(result.minimumProjectedBalance);
    expect(result.spendingRoom).toBeLessThan(0);
  });
});
