import { expect, test } from "@playwright/test";
import { expandIncomeEvents, calculateSafeSpendingPlan } from "../../lib/cashflowTimeline.js";
import { buildWeeklySafeSpendingPlan } from "../../lib/billMath.js";
import { legacySalaryToIncomeSource, mergeLegacySalary } from "../../lib/incomeSchedule.js";

const source = (overrides = {}) => ({
  id: "income-1",
  name: "Income",
  amount: 100,
  firstPaymentDate: "2028-01-07",
  frequency: "one_off",
  confidence: "confirmed",
  active: true,
  ...overrides,
});

test("existing monthly salary migrates once without losing amount or payday intent", () => {
  const migrated = legacySalaryToIncomeSource({ amount: 2400, payDay: 31, active: true }, "2028-02-01");
  expect(migrated).toMatchObject({ id: "regular-salary", name: "Regular salary", amount: 2400, firstPaymentDate: "2028-02-29", frequency: "monthly", confidence: "confirmed", active: true });
  expect(mergeLegacySalary([migrated], { amount: 2400, payDay: 31 }, "2028-02-01")).toHaveLength(1);
});

test("salary-only and salary plus another source use the generic occurrence engine", () => {
  const salary = source({ id: "salary", name: "Regular salary", amount: 2000, firstPaymentDate: "2028-01-31", frequency: "monthly" });
  expect(expandIncomeEvents([salary], "2028-01-01", "2028-03-31").map(({ date, amount }) => ({ date, amount }))).toEqual([
    { date: "2028-01-31", amount: 2000 }, { date: "2028-02-29", amount: 2000 }, { date: "2028-03-31", amount: 2000 },
  ]);
  const combined = expandIncomeEvents([salary, source({ id: "invoice", amount: 350, firstPaymentDate: "2028-02-10" })], "2028-02-01", "2028-02-29");
  expect(combined.reduce((total, item) => total + item.amount, 0)).toBe(2350);
});

test("one-off income works without salary on a rolling four-week horizon", () => {
  const plan = buildWeeklySafeSpendingPlan("2028-01-03", null, 280, [], [], 0, [source({ firstPaymentDate: "2028-01-10", amount: 140 })]);
  expect(plan).toHaveLength(4);
  expect(plan[1].incomeReceived).toBe(140);
  expect(plan.some((week) => week.availableToSpend > 0)).toBe(true);
});

test("weekly Friday, fortnightly and four-weekly wages recur on exact intervals", () => {
  const through = "2028-03-10";
  expect(expandIncomeEvents([source({ frequency: "weekly" })], "2028-01-01", "2028-01-31").map((item) => item.date)).toEqual(["2028-01-07", "2028-01-14", "2028-01-21", "2028-01-28"]);
  expect(expandIncomeEvents([source({ frequency: "fortnightly" })], "2028-01-01", through).map((item) => item.date).slice(0, 3)).toEqual(["2028-01-07", "2028-01-21", "2028-02-04"]);
  expect(expandIncomeEvents([source({ frequency: "four_weekly" })], "2028-01-01", through).map((item) => item.date)).toEqual(["2028-01-07", "2028-02-04", "2028-03-03"]);
});

test("estimated, overdue, received and skipped occurrences are excluded from safe spending", () => {
  const base = { todayIso: "2028-01-01", horizonDate: "2028-01-20", currentBalance: 100, bills: [{ amount: 150, nextDueDate: "2028-01-15" }] };
  expect(calculateSafeSpendingPlan({ ...base, additionalIncomeEvents: [source({ confidence: "estimated" })] }).confirmedAdditionalIncome).toBe(0);
  for (const status of ["received", "skipped"]) {
    const result = calculateSafeSpendingPlan({ ...base, additionalIncomeEvents: [source({ occurrenceStatuses: { "2028-01-07": status } })] });
    expect(result.confirmedAdditionalIncome).toBe(0);
    expect(result.projectedClosingBalance).toBe(-50);
  }
  expect(expandIncomeEvents([source({ firstPaymentDate: "2027-12-31" })], "2027-12-31", "2028-01-01", { includeNonForecast: true, asOfIso: "2028-01-01" })[0].status).toBe("overdue_unconfirmed");
});

test("end dates stop recurrence and month ends handle 29th, 30th, 31st and leap February", () => {
  expect(expandIncomeEvents([source({ frequency: "weekly", endDate: "2028-01-21" })], "2028-01-01", "2028-02-20").map((item) => item.date)).toEqual(["2028-01-07", "2028-01-14", "2028-01-21"]);
  for (const [day, expectedFebruary] of [[29, "2028-02-29"], [30, "2028-02-29"], [31, "2028-02-29"]]) {
    const dates = expandIncomeEvents([source({ firstPaymentDate: `2028-01-${day}`, frequency: "monthly" })], "2028-01-01", "2028-03-31").map((item) => item.date);
    expect(dates).toEqual([`2028-01-${day}`, expectedFebruary, `2028-03-${day}`]);
  }
  expect(expandIncomeEvents([source({ firstPaymentDate: "2027-01-31", frequency: "monthly" })], "2027-02-01", "2027-02-28").map((item) => item.date)).toEqual(["2027-02-28"]);
});
