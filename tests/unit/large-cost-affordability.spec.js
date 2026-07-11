import { expect, test } from "@playwright/test";
import { calculateLargeCostAffordabilityPlans } from "../../lib/largeCostPlanner.js";

const BASE = {
  todayIso: "2026-07-10",
  paydayDate: "2026-07-20",
  currentBalance: 1000,
  incomeAmount: 1000,
  bills: [],
  savingsAvailable: 1000,
};

function currentCost(overrides = {}) {
  return {
    id: "cost-a",
    name: "Large cost",
    amount: 600,
    dueDate: "2026-07-15",
    fundingStatus: "current_account",
    ...overrides,
  };
}

function plan(overrides = {}) {
  return calculateLargeCostAffordabilityPlans({
    ...BASE,
    largeCosts: [currentCost()],
    ...overrides,
  });
}

test("1. £600 before payday is fully protected from current balance", () => {
  const result = plan();
  expect(result.plans[0].state).toBe("affordable_now");
  expect(result.plans[0].currentPeriodAllocation).toBe(600);
  expect(result.plans[0].periods[0]).toMatchObject({
    openingAvailableBalance: 1000,
    normalBills: 0,
    protectedAmount: 600,
    resultingSafeSpendingRoom: 400,
    safeDailyAfter: 40,
  });
});

test("2. £600 after payday keeps savings separate and takes no current-period money unnecessarily", () => {
  const result = plan({
    largeCosts: [currentCost({
      dueDate: "2026-08-02",
      fundingStatus: "split",
      savingsContribution: 200,
      currentBalanceContribution: 400,
    })],
  });
  expect(result.plans[0]).toMatchObject({
    savingsContribution: 200,
    currentBalanceContribution: 400,
    currentPeriodAllocation: 0,
    shortfall: 0,
  });
  expect(result.summary.savingsBeingUsed).toBe(200);
  expect(result.summary.currentPeriodProtected).toBe(0);
  expect(result.summary.futurePeriodsPlanned).toBe(400);
});

test("3. a cost after payday protects only the amount future pay cannot cover", () => {
  const result = plan({
    currentBalance: 140,
    incomeAmount: 460,
    largeCosts: [currentCost({ dueDate: "2026-08-02" })],
  });
  expect(result.plans[0].state).toBe("affordable_by_due_date");
  expect(result.plans[0].currentPeriodAllocation).toBe(140);
  expect(result.plans[0].futurePeriodAllocations).toEqual([
    { payDate: "2026-07-20", sourceType: "primary_pay", sourceLabel: "Pay", periodStart: "2026-07-20", periodEnd: "2026-08-19", amount: 460 },
  ]);
});

test("4. no current-period capacity produces a £0 now / wait-until-payday plan", () => {
  const result = plan({
    currentBalance: 100,
    bills: [{ id: "bill-a", amount: 100, nextDueDate: "2026-07-15", frequency: "one_off" }],
    largeCosts: [currentCost({ dueDate: "2026-08-02" })],
  });
  expect(result.plans[0].state).toBe("wait_until_payday");
  expect(result.plans[0].currentPeriodAllocation).toBe(0);
  expect(result.plans[0].futurePeriodAllocations[0].amount).toBe(600);
});

test("5. insufficient funds by the due date exposes the exact shortfall", () => {
  const result = plan({
    currentBalance: 100,
    incomeAmount: 500,
    bills: [
      { id: "bill-a", amount: 100, nextDueDate: "2026-07-15", frequency: "one_off" },
      { id: "bill-b", amount: 200, nextDueDate: "2026-07-25", frequency: "one_off" },
    ],
    largeCosts: [currentCost({ dueDate: "2026-08-02" })],
  });
  expect(result.plans[0].state).toBe("unaffordable_by_due_date");
  expect(result.plans[0].shortfall).toBe(300);
  expect(result.plans[0].deterministicExplanation).toContain("short by £300");
});

test("6. a £2,500 cost spans three pay periods as £500 + £1,000 + £1,000", () => {
  const result = plan({
    currentBalance: 500,
    largeCosts: [currentCost({ amount: 2500, dueDate: "2026-09-02" })],
  });
  expect(result.plans[0].periods.map((period) => period.protectedAmount)).toEqual([500, 1000, 1000]);
  expect(result.plans[0].shortfall).toBe(0);
});

test("7. earlier Large Costs consume shared future capacity first", () => {
  const result = plan({
    currentBalance: 0,
    largeCosts: [
      currentCost({ id: "a", amount: 700, dueDate: "2026-08-02" }),
      currentCost({ id: "b", amount: 500, dueDate: "2026-08-02" }),
    ],
  });
  expect(result.plans.find((entry) => entry.costId === "a").shortfall).toBe(0);
  expect(result.plans.find((entry) => entry.costId === "b").shortfall).toBe(200);
  expect(result.periods[1].committedLargeCosts).toBe(1000);
});

test("8. editing the amount recalculates every allocation", () => {
  const before = plan({ currentBalance: 500, incomeAmount: 400, largeCosts: [currentCost({ dueDate: "2026-08-02" })] });
  const after = plan({ currentBalance: 500, incomeAmount: 400, largeCosts: [currentCost({ amount: 700, dueDate: "2026-08-02" })] });
  expect(before.plans[0].periods.map((period) => period.protectedAmount)).toEqual([200, 400]);
  expect(after.plans[0].periods.map((period) => period.protectedAmount)).toEqual([300, 400]);
});

test("9. editing the due date moves funding into the newly available period", () => {
  const before = plan({ currentBalance: 0, incomeAmount: 400, largeCosts: [currentCost({ amount: 700, dueDate: "2026-08-02" })] });
  const after = plan({ currentBalance: 0, incomeAmount: 400, largeCosts: [currentCost({ amount: 700, dueDate: "2026-09-02" })] });
  expect(before.plans[0].shortfall).toBe(300);
  expect(after.plans[0].periods.map((period) => period.protectedAmount)).toEqual([0, 300, 400]);
  expect(after.plans[0].shortfall).toBe(0);
});

test("10. deleting a competing cost restores runway immediately on recalculation", () => {
  const withBoth = plan({
    currentBalance: 500,
    largeCosts: [currentCost({ id: "a", amount: 400 }), currentCost({ id: "b", amount: 300 })],
  });
  const afterDelete = plan({ currentBalance: 500, largeCosts: [currentCost({ id: "b", amount: 300 })] });
  expect(withBoth.summary.currentPeriodProtected).toBe(500);
  expect(withBoth.plans.find((entry) => entry.costId === "b").shortfall).toBe(200);
  expect(afterDelete.summary.currentPeriodProtected).toBe(300);
  expect(afterDelete.periods[0].resultingSafeSpendingRoom).toBe(200);
});

test("11. legacy split costs without explicit contribution fields remain compatible", () => {
  const result = plan({
    largeCosts: [currentCost({ fundingStatus: "split", amountAlreadySaved: 200 })],
  });
  expect(result.plans[0]).toMatchObject({
    savingsContribution: 200,
    currentBalanceContribution: 400,
    shortfall: 0,
  });
});

test("12. the deterministic explanation remains available without AI", () => {
  const result = plan();
  expect(result.plans[0].deterministicExplanation).toBe(
    "You can afford this now. Protect £600 before payday. This leaves approximately £40.00 per day until payday.",
  );
});

test("13. production screenshot scenario waits for payday instead of protecting the whole £2,000 now", () => {
  const result = plan({
    currentBalance: 6500,
    incomeAmount: 2000,
    largeCosts: [currentCost({ name: "Greece", amount: 2000, dueDate: "2026-08-01" })],
  });
  expect(result.plans[0]).toMatchObject({
    state: "wait_until_payday",
    currentPeriodAllocation: 0,
    safeDailyAmountAfter: 650,
    shortfall: 0,
  });
  expect(result.plans[0].futurePeriodAllocations).toEqual([
    { payDate: "2026-07-20", sourceType: "primary_pay", sourceLabel: "Pay", periodStart: "2026-07-20", periodEnd: "2026-08-19", amount: 2000 },
  ]);
  expect(result.plans[0].deterministicExplanation).toBe(
    "Wait until payday. You do not need to take money from your current balance yet. Fund £2,000 from your pay on 20 July.",
  );
});

test("14. bills later in the future pay cycle remain reserved before allocating a Large Cost", () => {
  const result = plan({
    currentBalance: 500,
    incomeAmount: 1000,
    bills: [{ id: "bill-after-cost", amount: 700, nextDueDate: "2026-08-10", frequency: "one_off" }],
    largeCosts: [currentCost({ dueDate: "2026-08-02" })],
  });
  expect(result.plans[0].periods.map((period) => period.protectedAmount)).toEqual([300, 300]);
  expect(result.plans[0].state).toBe("affordable_by_due_date");
  expect(result.plans[0].safeDailyAmountAfter).toBe(20);
});
