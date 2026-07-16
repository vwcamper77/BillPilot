import { expect, test } from "@playwright/test";
import { calculateCashPosition } from "../../lib/cashflowTimeline.js";
import { isBalanceSnapshotStale } from "../../app/dashboard/components/AttentionStrip.jsx";

const TODAY = "2026-07-10";
const HORIZON = "2026-07-25";

function income(overrides = {}) {
  return {
    id: "salary",
    name: "Salary",
    amount: 4400,
    expectedDate: "2026-07-20",
    frequency: "one_off",
    confidence: "confirmed",
    status: "scheduled",
    active: true,
    ...overrides,
  };
}

function position(overrides = {}) {
  return calculateCashPosition({ todayIso: TODAY, horizonDate: HORIZON, currentBalance: 300, bills: [], largeCostAllocations: [], additionalIncomeEvents: [], ...overrides });
}

test.describe("canonical chronological cash position", () => {
  test("regression: £300 now never becomes £4,700 available now and every component reconciles", () => {
    const result = position({
      bills: [
        { id: "rent", name: "Rent", amount: 1100, nextDueDate: "2026-07-15", frequency: "one_off" },
        { id: "other", name: "Other bill", amount: 35, nextDueDate: "2026-07-18", frequency: "one_off" },
      ],
      largeCostAllocations: [
        { id: "large-a", name: "Large-cost funding A", currentAccountAmount: 471, nextDueDate: "2026-07-12", frequency: "one_off" },
        { id: "large-b", name: "Large-cost funding B", currentAccountAmount: 365, nextDueDate: "2026-07-14", frequency: "one_off" },
      ],
      additionalIncomeEvents: [income()],
    });

    expect(result.availableNow).toBe(300);
    expect(result.confirmedIncomeThroughHorizon).toBe(4400);
    expect(result.billOutflowsThroughHorizon).toBe(1135);
    expect(result.protectedOutflowsThroughHorizon).toBe(836);
    expect(result.outflowsThroughHorizon).toBe(1971);
    expect(result.outflowEvents).toHaveLength(4);
    expect(new Set(result.outflowEvents.map((event) => event.occurrenceId)).size).toBe(4);
    expect(result.safeUntilNextIncome).toBe(-1671);
    expect(result.safePerDayUntilNextIncome).toBe(0);
    expect(result.forecastAtHorizon).toBe(2729);
    expect(result.forecastAtHorizon).toBe(result.availableNow + result.confirmedIncomeThroughHorizon - result.outflowsThroughHorizon);
  });

  test("no future income uses the selected horizon as the immediate boundary", () => {
    const result = position({ bills: [{ id: "bill", amount: 50, nextDueDate: "2026-07-12", frequency: "one_off" }] });
    expect(result.nextConfirmedIncome).toBeNull();
    expect(result.safeUntilNextIncome).toBe(250);
    expect(result.forecastAtHorizon).toBe(250);
  });

  test("£471 protected before income is committed, never a bill, and leaves £1,529 safe", () => {
    const result = position({
      currentBalance: 2000,
      bills: [{ id: "later-bill", name: "Later bill", amount: 400, nextDueDate: "2026-07-22", frequency: "one_off" }],
      largeCostAllocations: [{ id: "greece", name: "Greece funding", currentAccountAmount: 471, nextDueDate: "2026-07-12", frequency: "one_off" }],
      additionalIncomeEvents: [income()],
    });

    expect(result.availableNow).toBe(2000);
    expect(result.billsBeforeNextIncomeTotal).toBe(0);
    expect(result.protectedBeforeNextIncomeTotal).toBe(471);
    expect(result.outflowBeforeNextIncomeTotal).toBe(471);
    expect(result.safeUntilNextIncome).toBe(1529);
    expect(result.forecastAtHorizon).toBe(5529);
    expect(result.protectedBeforeNextIncome[0].type).toBe("large_cost");
  });

  test("income tomorrow is excluded from available now and the pre-income daily amount", () => {
    const result = position({ additionalIncomeEvents: [income({ amount: 1000, expectedDate: "2026-07-11" })] });
    expect(result.availableNow).toBe(300);
    expect(result.safeUntilNextIncome).toBe(300);
    expect(result.safePerDayUntilNextIncome).toBe(300);
    expect(result.forecastAtHorizon).toBe(1300);
  });

  test("same-day bills are applied before income and flagged", () => {
    const result = position({
      currentBalance: 300,
      bills: [{ id: "bill", name: "Rent", amount: 500, nextDueDate: "2026-07-12", frequency: "one_off" }],
      additionalIncomeEvents: [income({ amount: 1000, expectedDate: "2026-07-12" })],
    });
    expect(result.events.map((event) => event.type)).toEqual(["bill", "additional_income"]);
    expect(result.events[0].balanceAfter).toBe(-200);
    expect(result.safeUntilNextIncome).toBe(-200);
    expect(result.sameDayDependencies).toEqual(["2026-07-12"]);
  });

  test("bills exceeding cash and a negative starting balance preserve the shortfall", () => {
    expect(position({ bills: [{ id: "bill", amount: 500, nextDueDate: "2026-07-12", frequency: "one_off" }] }).safeUntilNextIncome).toBe(-200);
    const negative = position({ currentBalance: -50 });
    expect(negative.availableNow).toBe(-50);
    expect(negative.safeUntilNextIncome).toBe(-50);
    expect(negative.firstNegativeDate).toBe(TODAY);
  });

  test("savings-funded large costs do not reduce current cash; split costs reduce only the current-funded portion", () => {
    const savingsFunded = position({ largeCostAllocations: [{ id: "saved", amount: 600, currentAccountAmount: 0, nextDueDate: "2026-07-12" }] });
    expect(savingsFunded.protectedOutflowsThroughHorizon).toBe(0);
    expect(savingsFunded.safeUntilNextIncome).toBe(300);
    const split = position({ largeCostAllocations: [{ id: "split", amount: 600, currentAccountAmount: 250, nextDueDate: "2026-07-12" }] });
    expect(split.protectedOutflowsThroughHorizon).toBe(250);
    expect(split.safeUntilNextIncome).toBe(50);
  });

  test("deleted bills and edited balances recalculate without retained state", () => {
    const bill = { id: "bill", amount: 100, nextDueDate: "2026-07-12", frequency: "one_off" };
    expect(position({ bills: [bill] }).safeUntilNextIncome).toBe(200);
    expect(position({ bills: [] }).safeUntilNextIncome).toBe(300);
    expect(position({ currentBalance: 450, bills: [bill] }).availableNow).toBe(450);
    expect(position({ currentBalance: 450, bills: [bill] }).safeUntilNextIncome).toBe(350);
  });

  test("weekly, fortnightly and multiple incomes expand once; income after the horizon is excluded", () => {
    const result = position({
      horizonDate: "2026-08-10",
      additionalIncomeEvents: [
        income({ id: "weekly", amount: 100, expectedDate: "2026-07-11", frequency: "weekly" }),
        income({ id: "fortnightly", amount: 200, expectedDate: "2026-07-12", frequency: "fortnightly" }),
        income({ id: "late", amount: 999, expectedDate: "2026-08-11", frequency: "one_off" }),
      ],
    });
    expect(result.incomeEvents.filter((event) => event.id === "weekly")).toHaveLength(5);
    expect(result.incomeEvents.filter((event) => event.id === "fortnightly")).toHaveLength(3);
    expect(result.incomeEvents.some((event) => event.id === "late")).toBe(false);
    expect(result.confirmedIncomeThroughHorizon).toBe(1100);
  });

  test("a just-edited balance cannot be marked stale", () => {
    expect(isBalanceSnapshotStale({ hasBalanceSnapshot: true, optimisticBalance: 300, balanceSnapshotDate: null, staleBalanceDays: 20 })).toBe(false);
    expect(isBalanceSnapshotStale({ hasBalanceSnapshot: true, optimisticBalance: null, balanceSnapshotDate: new Date(), staleBalanceDays: 7 })).toBe(true);
  });
});
