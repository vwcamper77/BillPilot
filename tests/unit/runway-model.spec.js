import { expect, test } from "@playwright/test";
import { buildWeeklySafeSpendingPlan } from "../../lib/billMath.js";
import { buildSixWeekRunwayRows, calculateSpendTest, deriveRunwayStatus, resolveRunwayIncomeBoundary } from "../../app/dashboard/lib/runwayModel.js";

test.describe("six-week runway UI model", () => {
  test("uses the earliest canonical confirmed income instead of a later legacy payday", () => {
    expect(resolveRunwayIncomeBoundary({ date: "2026-07-20" }, "2026-07-26")).toBe("2026-07-20");
    expect(resolveRunwayIncomeBoundary(null, "2026-07-26")).toBe("2026-07-26");
  });

  test("preserves six calculated weeks without horizontal-card pagination", () => {
    const plan = buildWeeklySafeSpendingPlan("2026-07-16", "2026-07-28", 900, [], [], 0, [], 6);
    const rows = buildSixWeekRunwayRows(plan);

    expect(plan).toHaveLength(6);
    expect(rows).toHaveLength(6);
    expect(rows[0].label).toBe("This week");
    expect(rows[5].label).toBe("Week 6");
    expect(rows.map((row) => row.projectedClosingBalance)).toEqual(plan.map((week) => week.projectedClosingBalance));
  });

  test("uses factual status rules", () => {
    expect(deriveRunwayStatus({ weeklyMinimumBalance: -1, dailyRate: 20 })).toBe("Warning");
    expect(deriveRunwayStatus({ weeklyMinimumBalance: 50, dailyRate: 0 })).toBe("Tight");
    expect(deriveRunwayStatus({ weeklyMinimumBalance: 50, dailyRate: 10 }, true)).toBe("Warning");
    expect(deriveRunwayStatus({ weeklyMinimumBalance: 50, dailyRate: 10 })).toBe("Clear");
  });

  test("shows the three largest outgoing chips and counts the remainder", () => {
    const week = {
      weekStart: "2026-07-13",
      weekEnd: "2026-07-19",
      projectedClosingBalance: 100,
      weeklyMinimumBalance: 100,
      dailyRate: 5,
      steps: [
        { name: "Small", amount: -5, date: "2026-07-13", type: "bill" },
        { name: "Largest", amount: -80, date: "2026-07-14", type: "bill" },
        { name: "Third", amount: -20, date: "2026-07-15", type: "bill" },
        { name: "Second", amount: -40, date: "2026-07-16", type: "large_cost" },
      ],
    };
    const [row] = buildSixWeekRunwayRows([week]);

    expect(row.significantOutgoings.map((item) => item.name)).toEqual(["Largest", "Second", "Third"]);
    expect(row.additionalOutgoingCount).toBe(1);
    expect(row.fixedOutgoings).toBe(145);
  });

  test("does not let payday income inflate the safe rate before that income", () => {
    const today = "2026-07-17";
    const payday = "2026-07-20";
    const plan = buildWeeklySafeSpendingPlan(
      today,
      payday,
      300,
      [],
      [{
        id: "protected-current",
        name: "Protected contribution",
        currentAccountAmount: 271,
        nextDueDate: today,
        frequency: "one_off",
      }],
      0,
      [{
        id: "salary",
        name: "Salary",
        amount: 4000,
        firstPaymentDate: payday,
        frequency: "monthly",
        confidence: "confirmed",
      }],
      6,
    );
    const rows = buildSixWeekRunwayRows(plan);

    expect(rows[0].fixedOutgoings).toBe(271);
    expect(rows[0].projectedClosingBalance).toBe(29);
    expect(rows[0].dailyRates).toHaveLength(1);
    expect(rows[0].dailyRates[0]).toBeCloseTo(29 / 3, 8);
    expect(rows[1].dailyRates[0]).toBeGreaterThan(rows[0].dailyRates[0]);
  });

  test("keeps payday-funded protected contributions in week 2", () => {
    const today = "2026-07-17";
    const payday = "2026-07-20";
    const plan = buildWeeklySafeSpendingPlan(
      today,
      payday,
      200,
      [],
      [
        { id: "greece", name: "Greece funding", currentAccountAmount: 136, nextDueDate: payday, frequency: "one_off" },
        { id: "car", name: "Car funding", currentAccountAmount: 135, nextDueDate: payday, frequency: "one_off" },
      ],
      0,
      [{ id: "salary", name: "Salary", amount: 4000, firstPaymentDate: payday, frequency: "monthly", confidence: "confirmed" }],
      6,
    );
    const rows = buildSixWeekRunwayRows(plan);

    expect(rows[0].fixedOutgoings).toBe(0);
    expect(rows[0].projectedClosingBalance).toBe(200);
    expect(rows[0].dailyRates).toHaveLength(1);
    expect(rows[0].dailyRates[0]).toBeCloseTo(200 / 3, 8);
    expect(rows[1].fixedOutgoings).toBe(271);
    expect(rows[1].significantOutgoings.map((item) => item.name)).toEqual(["Greece funding", "Car funding"]);
  });
});
test.describe("test a spend", () => {
  test("is a non-clamped local scenario", () => {
    const result = calculateSpendTest({ safeUntilNextIncome: 100, daysUntilNextIncome: 5, amount: 125 });
    expect(result.currentAmount).toBe(100);
    expect(result.revisedAmount).toBe(-25);
    expect(result.revisedSafePerDay).toBe(-5);
    expect(result.difference).toBe(-125);
    expect(result.createsShortfall).toBe(true);
  });
});
