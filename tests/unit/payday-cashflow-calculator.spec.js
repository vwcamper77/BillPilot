import { expect, test } from "@playwright/test";
import {
  MAX_MONEY_PENCE,
  calculatePaydayCashflow,
  calendarDaysBetween,
  formatGbp,
  getCalculationPeriod,
  getPacingFigures,
  parseIsoCalendarDate,
  parseMoneyToPence,
} from "../../lib/paydayCashflowCalculator.js";
import { createPaydayCalculatorSchemas } from "../../lib/linkableAssetsSchema.js";

test("uses only cash available now", () => {
  expect(calculatePaydayCashflow({ availableCashPence: 30000 })).toEqual({ availableCashPence: 30000 });
});

test("accepts an exact zero amount", () => {
  expect(calculatePaydayCashflow({ availableCashPence: 0 })).toEqual({ availableCashPence: 0 });
});

test("rejects negative available cash", () => {
  expect(() => calculatePaydayCashflow({ availableCashPence: -1 })).toThrow(/cannot be negative/);
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
  expect(() => calculatePaydayCashflow({ availableCashPence: -1 })).toThrow(/cannot be negative/);
});

test("rejects monetary input above the explicit maximum", () => {
  expect(parseMoneyToPence("1000000.00")).toBe(MAX_MONEY_PENCE);
  expect(() => parseMoneyToPence("1000000.01")).toThrow(/no greater than £1,000,000\.00/);
  expect(() => calculatePaydayCashflow({ availableCashPence: MAX_MONEY_PENCE + 1 })).toThrow(/cannot be greater/);
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

test("divides available cash by the planning days", () => {
  expect(getPacingFigures(30000, 12)).toEqual({ dailyPence: 2500 });
});

test("rounds indicative pacing down to the nearest penny", () => {
  expect(getPacingFigures(1000, 3)).toEqual({ dailyPence: 333 });
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
