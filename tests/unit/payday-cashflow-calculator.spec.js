import { expect, test } from "@playwright/test";
import {
  MAX_MONEY_PENCE,
  calculateCommittedCostsThroughDate,
  calculateConfirmedIncomeBeforeDate,
  calculatePaydayCashflow,
  calendarDaysBetween,
  formatGbp,
  getCalculationPeriod,
  getPacingFigures,
  parseIsoCalendarDate,
  parseMoneyToPence,
} from "../../lib/paydayCashflowCalculator.js";
import { createPaydayCalculatorSchemas } from "../../lib/linkableAssetsSchema.js";

function calculate(overrides = {}) {
  return calculatePaydayCashflow({
    currentBalancePence: 50000,
    confirmedIncomeBeforeDatePence: 10000,
    billsDueBeforeDatePence: 20000,
    oneOffCommittedCostsPence: 5000,
    safetyBufferPence: 2500,
    ...overrides,
  });
}

test("uses the documented calculator formula for a positive result", () => {
  expect(calculate()).toEqual({ clearToSpendPence: 32500, shortfallPence: 0, isShortfall: false });
});

test("returns an exact zero result", () => {
  expect(calculate({ currentBalancePence: 17500 })).toEqual({ clearToSpendPence: 0, shortfallPence: 0, isShortfall: false });
});

test("reports the size of a shortfall rather than negative spending money", () => {
  expect(calculate({ currentBalancePence: 10000, confirmedIncomeBeforeDatePence: 0 })).toEqual({
    clearToSpendPence: -17500,
    shortfallPence: 17500,
    isShortfall: true,
  });
});

test("accepts a negative current balance", () => {
  expect(calculate({ currentBalancePence: -1000, confirmedIncomeBeforeDatePence: 5000, billsDueBeforeDatePence: 0, oneOffCommittedCostsPence: 0, safetyBufferPence: 0 }).clearToSpendPence).toBe(4000);
});

test("parses whole pounds into pence", () => {
  expect(parseMoneyToPence("12")).toBe(1200);
});

test("parses decimal currency as whole pence without floating-point drift", () => {
  expect(parseMoneyToPence("12.34")).toBe(1234);
  expect(parseMoneyToPence("-0.01", { allowNegative: true })).toBe(-1);
});

test("rejects invalid and over-precise monetary input", () => {
  expect(() => parseMoneyToPence("twelve")).toThrow(/pounds and pence/);
  expect(() => parseMoneyToPence("1.234")).toThrow(/two decimal places/);
});

test("rejects negative values unless explicitly allowed", () => {
  expect(() => parseMoneyToPence("-1")).toThrow(/zero or a positive/);
  expect(() => calculate({ billsDueBeforeDatePence: -1 })).toThrow(/cannot be negative/);
});

test("rejects monetary input above the explicit maximum", () => {
  expect(parseMoneyToPence("1000000.00")).toBe(MAX_MONEY_PENCE);
  expect(() => parseMoneyToPence("1000000.01")).toThrow(/no greater than £1,000,000\.00/);
  expect(() => calculate({ currentBalancePence: MAX_MONEY_PENCE + 1 })).toThrow(/cannot be greater/);
});

test("formats whole pence as en-GB GBP", () => {
  expect(formatGbp(1234)).toBe("£12.34");
  expect(formatGbp(-1)).toBe("-£0.01");
});

test("rejects a selected date before today", () => {
  expect(() => getCalculationPeriod("2026-07-17", "2026-07-18")).toThrow(/today or a future date/);
});

test("defines same-day calculations as zero days until income and one pacing day", () => {
  expect(getCalculationPeriod("2026-07-18", "2026-07-18")).toEqual({ daysUntilIncome: 0, planningDays: 1, pacingDays: 1, isSameDay: true });
});

test("counts both today and a future end date in the planning period", () => {
  expect(getCalculationPeriod("2026-07-20", "2026-07-18")).toEqual({ daysUntilIncome: 2, planningDays: 3, pacingDays: 3, isSameDay: false });
});

test("calculates a month boundary", () => {
  expect(calendarDaysBetween("2026-01-31", "2026-02-01")).toBe(1);
});

test("calculates a year boundary", () => {
  expect(calendarDaysBetween("2026-12-31", "2027-01-01")).toBe(1);
});

test("calculates leap-year dates", () => {
  expect(calendarDaysBetween("2028-02-28", "2028-03-01")).toBe(2);
});

test("calendar arithmetic is unchanged across British Summer Time boundaries", () => {
  expect(calendarDaysBetween("2026-03-28", "2026-03-30")).toBe(2);
  expect(calendarDaysBetween("2026-10-24", "2026-10-26")).toBe(2);
});

test("selected YYYY-MM-DD values retain their calendar parts through UTC", () => {
  const parsed = parseIsoCalendarDate("2026-03-29");
  expect(parsed).toMatchObject({ year: 2026, month: 3, day: 29 });
  expect(new Date(parsed.utcTime).toISOString()).toBe("2026-03-29T00:00:00.000Z");
  expect(() => parseIsoCalendarDate("2026-02-30")).toThrow(/valid date/);
});

test("excludes confirmed income arriving on the selected end date", () => {
  expect(calculateConfirmedIncomeBeforeDate([
    { date: "2026-07-19", amountPence: 1000 },
    { date: "2026-07-20", amountPence: 2000 },
    { date: "2026-07-21", amountPence: 4000 },
  ], "2026-07-20")).toBe(1000);
});

test("includes committed costs due on the selected end date", () => {
  expect(calculateCommittedCostsThroughDate([
    { date: "2026-07-19", amountPence: 1000 },
    { date: "2026-07-20", amountPence: 2000 },
    { date: "2026-07-21", amountPence: 4000 },
  ], "2026-07-20")).toBe(3000);
});

test("shows weekly pacing only when at least seven days remain", () => {
  expect(getPacingFigures(14000, 7, 7)).toEqual({ dailyPence: 2000, weeklyPence: 14000 });
  expect(getPacingFigures(12000, 6, 6)).toEqual({ dailyPence: 2000, weeklyPence: null });
  expect(getPacingFigures(-1, 7, 7)).toEqual({ dailyPence: null, weeklyPence: null });
});

test("rounds indicative pacing down to the nearest penny", () => {
  expect(getPacingFigures(1000, 3, 2)).toEqual({ dailyPence: 333, weeklyPence: null });
  expect(getPacingFigures(1000, 8, 7)).toEqual({ dailyPence: 125, weeklyPence: 875 });
});

test("calculator structured data is valid at object level and has no fabricated ratings", () => {
  const schemas = createPaydayCalculatorSchemas();
  expect(schemas.breadcrumb["@type"]).toBe("BreadcrumbList");
  expect(schemas.breadcrumb.itemListElement).toHaveLength(3);
  expect(schemas.breadcrumb.itemListElement.map((item) => item.position)).toEqual([1, 2, 3]);
  expect(schemas.application["@type"]).toBe("WebApplication");
  expect(schemas.application.url).toBe("https://www.cleartill.money/tools/payday-cashflow-calculator");
  expect(schemas.application.offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "GBP" });
  const serialised = JSON.stringify(schemas);
  expect(serialised).not.toMatch(/AggregateRating|ratingValue|review|numberOfUsers/i);
});
