import { expect, test } from "@playwright/test";
import { calculateSafeSpendingPlan, expandIncomeEvents } from "../../lib/cashflowTimeline.js";
import { calculateLargeCostAffordabilityPlans } from "../../lib/largeCostPlanner.js";
import { buildFourWeekCashflowWaterfall } from "../../lib/billMath.js";

const confirmedIncome = {
  id: "freelance",
  name: "Freelance payment",
  amount: 350,
  expectedDate: "2026-07-15",
  frequency: "one_off",
  confidence: "confirmed",
  status: "scheduled",
  active: true,
};

test("confirmed future income raises the daily amount only after chronological constraints are respected", () => {
  const result = calculateSafeSpendingPlan({
    todayIso: "2026-07-10",
    horizonDate: "2026-07-20",
    currentBalance: 500,
    bills: [
      { id: "early", amount: 400, nextDueDate: "2026-07-12" },
      { id: "late", amount: 250, nextDueDate: "2026-07-18" },
    ],
    additionalIncomeEvents: [confirmedIncome],
  });
  expect(result).toMatchObject({
    confirmedAdditionalIncome: 350,
    projectedClosingBalance: 200,
    safeDailyAmount: 20,
    spendingRoom: 200,
    safeToSpendToday: 100,
  });
});

test("estimated income never affects safe spending", () => {
  const result = calculateSafeSpendingPlan({
    todayIso: "2026-07-10",
    horizonDate: "2026-07-20",
    currentBalance: 500,
    bills: [
      { amount: 400, nextDueDate: "2026-07-12" },
      { amount: 250, nextDueDate: "2026-07-18" },
    ],
    additionalIncomeEvents: [{ ...confirmedIncome, confidence: "estimated" }],
  });
  expect(result.confirmedAdditionalIncome).toBe(0);
  expect(result.projectedClosingBalance).toBe(-150);
  expect(result.safeDailyAmount).toBe(0);
});

test("recurring additional income expands onto its actual dates", () => {
  const occurrences = expandIncomeEvents([
    { ...confirmedIncome, frequency: "fortnightly" },
  ], "2026-07-10", "2026-08-20");
  expect(occurrences.map((item) => item.date)).toEqual(["2026-07-15", "2026-07-29", "2026-08-12"]);
});

test("Large Costs may use confirmed income before the due date", () => {
  const result = calculateLargeCostAffordabilityPlans({
    todayIso: "2026-07-10",
    paydayDate: "2026-07-20",
    currentBalance: 500,
    incomeAmount: 1000,
    bills: [
      { amount: 400, nextDueDate: "2026-07-12", frequency: "one_off" },
      { amount: 250, nextDueDate: "2026-07-18", frequency: "one_off" },
    ],
    additionalIncomeEvents: [{ ...confirmedIncome, amount: 450 }],
    largeCosts: [{ id: "cost", name: "Repair", amount: 200, dueDate: "2026-07-17", fundingStatus: "current_account" }],
  });
  expect(result.plans[0]).toMatchObject({
    state: "affordable_by_due_date",
    currentPeriodAllocation: 0,
    shortfall: 0,
  });
  expect(result.plans[0].futurePeriodAllocations).toEqual([
    expect.objectContaining({ payDate: "2026-07-15", sourceType: "additional_income", sourceLabel: "Freelance payment", amount: 200 }),
  ]);
});

test("Large Costs cannot use income arriving after the due date", () => {
  const result = calculateLargeCostAffordabilityPlans({
    todayIso: "2026-07-10",
    paydayDate: "2026-07-20",
    currentBalance: 500,
    incomeAmount: 1000,
    bills: [{ amount: 400, nextDueDate: "2026-07-12", frequency: "one_off" }],
    additionalIncomeEvents: [{ ...confirmedIncome, amount: 450 }],
    largeCosts: [{ id: "cost", name: "Repair", amount: 200, dueDate: "2026-07-14", fundingStatus: "current_account" }],
  });
  expect(result.plans[0]).toMatchObject({
    state: "unaffordable_by_due_date",
    currentPeriodAllocation: 100,
    shortfall: 100,
  });
});

test("the four-week graph adds additional income in the week it arrives", () => {
  const points = buildFourWeekCashflowWaterfall(
    "2026-07-06",
    "2026-07-20",
    500,
    [],
    [],
    1000,
    [{ ...confirmedIncome, expectedDate: "2026-07-15" }],
  );
  expect(points[1]).toMatchObject({ additionalIncomeReceived: 350, incomeReceived: 350, closingBalance: 850 });
  expect(points[2]).toMatchObject({ primaryIncome: 1000, incomeReceived: 1000, closingBalance: 1850 });
});
