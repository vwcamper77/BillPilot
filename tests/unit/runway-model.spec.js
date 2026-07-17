import { expect, test } from "@playwright/test";
import { buildWeeklySafeSpendingPlan } from "../../lib/billMath.js";
import { buildSixWeekRunwayRows, calculateSpendTest, deriveRunwayStatus } from "../../app/dashboard/lib/runwayModel.js";

test.describe("six-week runway UI model", () => {
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
