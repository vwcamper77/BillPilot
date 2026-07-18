import { expect, test } from "@playwright/test";
import { calculateCashPosition, expandIncomeEvents, calculateSafeSpendingPlan, resolveNextConfirmedIncome } from "../../lib/cashflowTimeline.js";
import { buildWeeklySafeSpendingPlan } from "../../lib/billMath.js";
import { classifyIncomeSource, legacySalaryToIncomeSource, mergeLegacySalary, normaliseIncomeSource, upsertIncomeSource } from "../../lib/incomeSchedule.js";
import { localDateIso } from "../../lib/reminders/timezone.js";

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

test("regression: editing confirmed monthly salary from 20 July to 8 August keeps every dashboard calculation consistent", () => {
  const todayIso = "2026-07-19";
  const original = source({
    id: "salary",
    name: "Regular salary",
    amount: 4000,
    firstPaymentDate: "2026-07-20",
    frequency: "monthly",
    occurrenceStatuses: { "2026-07-20": "scheduled" },
  });
  const edited = upsertIncomeSource([original], { ...original, firstPaymentDate: "2026-08-08", expectedDate: "2026-08-08" });
  const nextIncome = resolveNextConfirmedIncome(edited, todayIso);
  const position = calculateCashPosition({
    todayIso,
    horizonDate: nextIncome.date,
    currentBalance: 500,
    bills: [{ id: "bill", name: "Bill", amount: 100, nextDueDate: "2026-07-25", frequency: "one_off" }],
    additionalIncomeEvents: edited,
  });
  const runway = buildWeeklySafeSpendingPlan(todayIso, nextIncome.date, 500, [], [], 0, edited, 6);

  expect(edited[0]).toMatchObject({ firstPaymentDate: "2026-08-08", confidence: "confirmed", classification: "confirmed" });
  expect(expandIncomeEvents(edited, todayIso, "2026-08-31").map((item) => item.date)).toEqual(["2026-08-08"]);
  expect(nextIncome).toMatchObject({ date: "2026-08-08", amount: 4000, classification: "confirmed" });
  expect(position.nextConfirmedIncome.date).toBe("2026-08-08");
  expect(position.safeUntilNextIncome).toBe(400);
  expect(position.forecastAtHorizon).toBe(4400);
  expect(runway.flatMap((week) => week.steps).find((item) => item.date === "2026-08-08")).toMatchObject({ amount: 4000, classification: "confirmed" });
});

test("immediate edit reducer preserves confirmation for date, amount and description-only changes", () => {
  const original = source({ id: "salary", name: "Regular salary", amount: 4000, firstPaymentDate: "2026-07-20", frequency: "monthly" });
  const dateEdit = upsertIncomeSource([original], { ...original, firstPaymentDate: "2026-08-08" })[0];
  const amountEdit = upsertIncomeSource([dateEdit], { ...dateEdit, amount: 4100 })[0];
  const nameEdit = upsertIncomeSource([amountEdit], { ...amountEdit, name: "Main salary" })[0];

  expect(dateEdit.confidence).toBe("confirmed");
  expect(amountEdit).toMatchObject({ amount: 4100, confidence: "confirmed" });
  expect(nameEdit).toMatchObject({ name: "Main salary", confidence: "confirmed" });
  expect(resolveNextConfirmedIncome([nameEdit], "2026-07-19").date).toBe("2026-08-08");
});

test("confirmed, estimated, paused and excluded classifications are deterministic and legacy-safe", () => {
  expect(classifyIncomeSource(source())).toBe("confirmed");
  expect(classifyIncomeSource(source({ confidence: "estimated" }))).toBe("estimated");
  expect(classifyIncomeSource(source({ active: false }))).toBe("paused");
  expect(classifyIncomeSource(source({ status: "cancelled" }))).toBe("excluded");
  expect(normaliseIncomeSource({ ...source(), confidence: undefined })).toMatchObject({ confidence: "confirmed", classification: "confirmed" });
  expect(resolveNextConfirmedIncome([source({ confidence: "estimated" }), source({ id: "paused", active: false })], "2028-01-01")).toBeNull();
});

test("date-only London handling keeps 8 August stable across offsets and monthly boundaries", () => {
  const salary = source({ firstPaymentDate: "2026-08-08", frequency: "monthly" });
  expect(expandIncomeEvents([salary], "2026-08-01", "2026-10-31").map((item) => item.date)).toEqual([
    "2026-08-08", "2026-09-08", "2026-10-08",
  ]);
  expect(localDateIso(new Date("2026-08-07T23:30:00Z"), "Europe/London")).toBe("2026-08-08");
  expect(localDateIso(new Date("2026-08-08T22:30:00Z"), "Europe/London")).toBe("2026-08-08");
});
