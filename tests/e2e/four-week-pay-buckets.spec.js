import { test, expect } from "@playwright/test";
import { getFourWeekPayBuckets, buildFourWeekCashflowWaterfall } from "../../lib/billMath.js";

// Reference calendar: Mon 2026-07-06, Mon 2026-07-13, Mon 2026-07-20, Mon 2026-07-27, Thu 2026-07-09.

test.describe("getFourWeekPayBuckets", () => {
  test("today is Monday: week 1 starts today", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-06", 500, 20);
    expect(buckets).toHaveLength(4);
    expect(buckets[0].weekStart).toBe("2026-07-06");
    expect(buckets[0].weekLabel).toBe("WC 6 Jul");
    expect(buckets[1].weekStart).toBe("2026-07-13");
    expect(buckets[2].weekStart).toBe("2026-07-20");
    expect(buckets[3].weekStart).toBe("2026-07-27");
  });

  test("today is mid-week: WC still starts on the preceding Monday", () => {
    // Thursday 9 July -> week commencing Monday 6 July
    const buckets = getFourWeekPayBuckets("2026-07-09", "2026-07-27", 500, 20);
    expect(buckets[0].weekStart).toBe("2026-07-06");
    expect(buckets[0].weekLabel).toBe("WC 6 Jul");
    expect(buckets[1].weekStart).toBe("2026-07-13");
    expect(buckets[1].weekLabel).toBe("WC 13 Jul");
    expect(buckets[2].weekStart).toBe("2026-07-20");
    expect(buckets[3].weekStart).toBe("2026-07-27");
  });

  test("pay date in week 1", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-10", 500, 20);
    expect(buckets[0].containsPayDate).toBe(true);
    expect(buckets[1].containsPayDate).toBe(false);
    expect(buckets[2].containsPayDate).toBe(false);
    expect(buckets[3].containsPayDate).toBe(false);
  });

  test("pay date in week 2", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-15", 500, 20);
    expect(buckets[0].containsPayDate).toBe(false);
    expect(buckets[1].containsPayDate).toBe(true);
    expect(buckets[1].weekLabel).toBe("WC 13 Jul");
    expect(buckets[2].containsPayDate).toBe(false);
    expect(buckets[3].containsPayDate).toBe(false);
  });

  test("pay date in week 3", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-21", 500, 20);
    expect(buckets[0].containsPayDate).toBe(false);
    expect(buckets[1].containsPayDate).toBe(false);
    expect(buckets[2].containsPayDate).toBe(true);
    expect(buckets[2].weekLabel).toBe("WC 20 Jul");
    expect(buckets[3].containsPayDate).toBe(false);
  });

  test("pay date in week 4", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-28", 500, 20);
    expect(buckets[0].containsPayDate).toBe(false);
    expect(buckets[1].containsPayDate).toBe(false);
    expect(buckets[2].containsPayDate).toBe(false);
    expect(buckets[3].containsPayDate).toBe(true);
    expect(buckets[3].weekLabel).toBe("WC 27 Jul");
  });

  test("weeks after the pay date are marked as after the pay cycle and muted", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-10", 500, 20);
    expect(buckets[0].isAfterPayCycle).toBe(false);
    expect(buckets[1].isAfterPayCycle).toBe(true);
    expect(buckets[1].muted).toBe(true);
    expect(buckets[2].isAfterPayCycle).toBe(true);
    expect(buckets[3].isAfterPayCycle).toBe(true);
  });

  test("marker label uses 'Pay date', not 'Paid date'", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-20", 500, 20);
    const payDateBucket = buckets.find((bucket) => bucket.containsPayDate);
    expect(payDateBucket.payDateLabel).toBe("Pay date 20 Jul");
    expect(payDateBucket.payDateLabel).not.toContain("Paid date");
  });
});

test.describe("buildFourWeekCashflowWaterfall", () => {
  test("spec example: opening/outflow/closing cascade across the 4 weeks", () => {
    const bills = [
      { nextDueDate: "2026-07-08", amount: 65 },
      { nextDueDate: "2026-07-14", amount: 1155 },
    ];
    const points = buildFourWeekCashflowWaterfall("2026-07-06", "2026-07-22", 1500, bills, []);

    expect(points).toHaveLength(4);

    expect(points[0].openingBalance).toBe(1500);
    expect(points[0].weeklyOutflow).toBe(65);
    expect(points[0].closingBalance).toBe(1435);

    expect(points[1].openingBalance).toBe(1435);
    expect(points[1].weeklyOutflow).toBe(1155);
    expect(points[1].closingBalance).toBe(280);

    // No cost this week: opening carries straight through to closing (thin flat line)
    expect(points[2].openingBalance).toBe(280);
    expect(points[2].weeklyOutflow).toBe(0);
    expect(points[2].closingBalance).toBe(280);
    expect(points[2].containsPayDate).toBe(true);
    expect(points[2].isAfterPayCycle).toBe(false);

    // Week 4 is after the pay date, so it's muted
    expect(points[3].openingBalance).toBe(280);
    expect(points[3].closingBalance).toBe(280);
    expect(points[3].isAfterPayCycle).toBe(true);
  });

  test("a large weekly outgoing produces a much bigger drop than a small one", () => {
    const bills = [
      { nextDueDate: "2026-07-08", amount: 65 },
      { nextDueDate: "2026-07-14", amount: 1155 },
    ];
    const points = buildFourWeekCashflowWaterfall("2026-07-06", "2026-07-22", 1500, bills, []);
    const week1Drop = points[0].openingBalance - points[0].closingBalance;
    const week2Drop = points[1].openingBalance - points[1].closingBalance;

    expect(week1Drop).toBe(65);
    expect(week2Drop).toBe(1155);
    expect(week2Drop).toBeGreaterThan(week1Drop * 10);
  });

  test("closing balance crosses below £0 when the weekly cost exceeds the opening balance", () => {
    const bills = [{ nextDueDate: "2026-07-08", amount: 420 }];
    const points = buildFourWeekCashflowWaterfall("2026-07-06", "2026-07-25", 300, bills, []);

    expect(points[0].openingBalance).toBe(300);
    expect(points[0].weeklyOutflow).toBe(420);
    expect(points[0].closingBalance).toBe(-120);
  });

  test("large costs due before payday also count toward weeklyOutflow", () => {
    const largeCosts = [{ nextDueDate: "2026-07-09", currentAccountAmount: 200 }];
    const points = buildFourWeekCashflowWaterfall("2026-07-06", "2026-07-25", 500, [], largeCosts);

    expect(points[0].weeklyOutflow).toBe(200);
    expect(points[0].closingBalance).toBe(300);
  });

  test("pay date label on the waterfall point reads 'Pay date DD Mon'", () => {
    const points = buildFourWeekCashflowWaterfall("2026-07-06", "2026-07-20", 1000, [], []);
    const payDatePoint = points.find((point) => point.containsPayDate);
    expect(payDatePoint.payDateLabel).toBe("Pay date 20 Jul");
  });

  test("income lands in the week containing the pay date, so money comes back in", () => {
    const bills = [
      { nextDueDate: "2026-07-08", amount: 65 },
      { nextDueDate: "2026-07-14", amount: 1155 },
    ];
    const points = buildFourWeekCashflowWaterfall("2026-07-06", "2026-07-22", 1500, bills, [], 2200);

    // Weeks before the pay date get no income
    expect(points[0].incomeReceived).toBe(0);
    expect(points[1].incomeReceived).toBe(0);

    // Pay date falls in week 3 (WC 20 Jul): closing balance jumps up by the income amount
    expect(points[2].containsPayDate).toBe(true);
    expect(points[2].incomeReceived).toBe(2200);
    expect(points[2].openingBalance).toBe(280);
    expect(points[2].weeklyOutflow).toBe(0);
    expect(points[2].closingBalance).toBe(2480);

    // The boosted balance carries forward into the following (muted) week
    expect(points[3].openingBalance).toBe(2480);
    expect(points[3].isAfterPayCycle).toBe(true);
  });

  test("a bill due after payday in the same week is deducted from the payday balance", () => {
    const bills = [{ nextDueDate: "2026-07-26", amount: 1100 }];
    const points = buildFourWeekCashflowWaterfall("2026-07-06", "2026-07-20", 500, bills, [], 4500);

    expect(points[2].containsPayDate).toBe(true);
    expect(points[2].openingBalance).toBe(500);
    expect(points[2].incomeReceived).toBe(4500);
    expect(points[2].weeklyOutflow).toBe(1100);
    expect(points[2].closingBalance).toBe(3900);
  });

  test("with no income amount set, closing balance is unaffected", () => {
    const points = buildFourWeekCashflowWaterfall("2026-07-06", "2026-07-22", 1500, [], [], 0);
    const payDatePoint = points.find((point) => point.containsPayDate);
    expect(payDatePoint.incomeReceived).toBe(0);
    expect(payDatePoint.closingBalance).toBe(payDatePoint.openingBalance);
  });

  test("allocations beyond the four-week window are not duplicated into week four", () => {
    const largeCosts = [{ nextDueDate: "2026-09-01", currentAccountAmount: 600 }];
    const points = buildFourWeekCashflowWaterfall("2026-07-06", "2026-07-20", 1000, [], largeCosts, 2000);
    expect(points.map((point) => point.weeklyOutflow)).toEqual([0, 0, 0, 0]);
  });
});
